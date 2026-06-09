import { Audio, type AudioErrorContext, type AudioPlayOptions, type AudioSound, type AudioVoice } from "@opentui/core"
import { readFile, unlink } from "node:fs/promises"
import { createAudioRecorder as createTuiRecorder, type AudioRecorder, type RecorderState } from "./stt/recorder"
import { transcribeFile } from "./stt/whisper"

let audio: Audio | null | undefined
const sounds = new Map<string, Promise<AudioSound | null>>()

function getAudio() {
  if (audio !== undefined) return audio
  try {
    const next = Audio.create({ autoStart: false })
    next.on("error", (error: Error, context: AudioErrorContext) => {
      console.debug("tui audio error", { error, context })
    })
    audio = next
    return next
  } catch (error) {
    console.debug("failed to create tui audio", { error })
    audio = null
    return null
  }
}

export function loadSoundFile(file: string) {
  const current = getAudio()
  if (!current) return Promise.resolve(null)
  const cached = sounds.get(file)
  if (cached) return cached
  const task = readFile(file)
    .then((bytes) => current.loadSound(bytes))
    .catch((error) => {
      console.debug("failed to load tui sound", { file, error })
      return null
    })
  sounds.set(file, task)
  return task
}

export function play(sound: AudioSound, options?: AudioPlayOptions) {
  const current = getAudio()
  if (!current) return null
  if (!current.isStarted() && !current.start()) return null
  return current.play(sound, options)
}

export function stopVoice(voice: AudioVoice) {
  return audio?.stopVoice(voice) ?? false
}

export function dispose() {
  audio?.dispose()
  audio = undefined
  sounds.clear()
}

// ---------------------------------------------------------------------------
// Voice recording & transcription (STT)
// ---------------------------------------------------------------------------

let sttRecorder: AudioRecorder | null = null

/**
 * Current STT recorder state.
 * "idle" | "recording" | "transcribing"
 */
export function getSttState(): RecorderState {
  return sttRecorder?.state ?? "idle"
}

/**
 * Start recording from the microphone.
 * Resolves once recording has begun.
 * Throws if the recorder tool is not found or mic access fails.
 */
export async function startSttRecording(): Promise<void> {
  if (sttRecorder && sttRecorder.state !== "idle") {
    throw new Error("Recording already in progress")
  }
  sttRecorder = await createTuiRecorder()
  await sttRecorder.start()
}

/**
 * Stop recording and transcribe the captured audio.
 * Returns the transcription text.
 * Cleans up the temporary audio file after transcription.
 */
export async function stopSttAndTranscribe(language?: string): Promise<string> {
  if (!sttRecorder || sttRecorder.state === "idle") {
    throw new Error("No recording in progress")
  }
  try {
    const audioPath = await sttRecorder.stop()
    const text = await transcribeFile(audioPath, language)
    return text
  } finally {
    // Clean up the temp audio file
    if (sttRecorder) {
      unlink(sttRecorder.outputPath).catch(() => undefined)
    }
    sttRecorder = null
  }
}

/**
 * Abort an in-progress STT recording without transcribing.
 */
export function abortSttRecording(): void {
  sttRecorder?.abort()
  sttRecorder = null
}
