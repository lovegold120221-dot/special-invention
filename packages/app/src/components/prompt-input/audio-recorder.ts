/**
 * Desktop audio recorder using the browser MediaRecorder API.
 *
 * Records from the user's microphone and returns a Blob.
 * This module uses navigator.mediaDevices.getUserMedia which is
 * only available in the Electron renderer (Desktop), not the TUI.
 *
 * Also provides real-time audio level data (0-1) via the onAudioLevel
 * callback, driven by an AnalyserNode connected to the media stream.
 */

export type RecorderState = "idle" | "recording" | "transcribing"

export type AudioRecorder = {
  state: RecorderState
  start: () => Promise<void>
  stop: () => Promise<Blob>
  abort: () => void
  /** Callback fired ~30fps during recording with a 0-1 audio level value */
  onAudioLevel: ((level: number) => void) | null
}

export function createAudioRecorder(): AudioRecorder {
  let mediaRecorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let state: RecorderState = "idle"
  let onAudioLevel: ((level: number) => void) | null = null

  // Audio analysis
  let audioContext: AudioContext | null = null
  let analyserNode: AnalyserNode | null = null
  let animationId: number | null = null
  const frequencyBins = 64

  function startAnalysis(mediaStream: MediaStream) {
    try {
      audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(mediaStream)
      analyserNode = audioContext.createAnalyser()
      analyserNode.fftSize = frequencyBins * 2
      source.connect(analyserNode)
      // Not connecting to destination — no audio feedback

      const dataArray = new Uint8Array(analyserNode.frequencyBinCount)

      function tick() {
        if (!analyserNode) return
        analyserNode.getByteFrequencyData(dataArray)

        // Compute average frequency level and normalize to 0-1
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        const normalized = Math.min(avg / 255, 1)

        onAudioLevel?.(normalized)
        animationId = requestAnimationFrame(tick)
      }

      animationId = requestAnimationFrame(tick)
    } catch {
      // AudioContext or AnalyserNode not supported — visualizer just won't animate
    }
  }

  function stopAnalysis() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    if (audioContext) {
      audioContext.close().catch(() => undefined)
      audioContext = null
    }
    analyserNode = null
    onAudioLevel?.(0) // Reset the visualizer
  }

  let resolveStop: ((blob: Blob) => void) | null = null
  let rejectStop: ((err: Error) => void) | null = null
  let stopPromise: Promise<Blob> | null = null

  return {
    get state() {
      return state
    },

    set onAudioLevel(cb: ((level: number) => void) | null) {
      onAudioLevel = cb
    },

    async start() {
      if (state !== "idle") throw new Error("Recorder is not idle")

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        throw new Error(
          `Microphone access denied: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      chunks = []
      state = "recording"

      // Start audio analysis for visualizer
      startAnalysis(stream)

      // Use a commonly supported mime type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"

      mediaRecorder = new MediaRecorder(stream, { mimeType })

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }

      stopPromise = new Promise<Blob>((resolve, reject) => {
        resolveStop = resolve
        rejectStop = reject

        if (!mediaRecorder) return

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType })
          state = "idle"
          // Release the microphone
          stream?.getTracks().forEach((t) => t.stop())
          stream = null
          mediaRecorder = null
          stopAnalysis()
          resolve(blob)
        }

        mediaRecorder.onerror = () => {
          state = "idle"
          stream?.getTracks().forEach((t) => t.stop())
          stream = null
          mediaRecorder = null
          stopAnalysis()
          reject(new Error("MediaRecorder error"))
        }
      })

      mediaRecorder.start(250) // Collect data every 250ms
    },

    async stop() {
      if (state !== "recording" || !mediaRecorder) {
        throw new Error("Recorder is not recording")
      }
      mediaRecorder.stop()
      state = "transcribing"
      const blob = await stopPromise!
      return blob
    },

    abort() {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.onstop = null
        mediaRecorder.onerror = null
        mediaRecorder.stop()
      }
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      mediaRecorder = null
      chunks = []
      state = "idle"
      stopAnalysis()
      if (rejectStop) {
        rejectStop(new Error("Recording aborted"))
        rejectStop = null
      }
    },
  }
}
