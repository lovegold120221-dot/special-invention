/**
 * Platform-specific audio recorder for the TUI.
 *
 * Records from the microphone to a temporary WAV file using
 * available system tools:
 *   - macOS: ffmpeg (preferred), then sox/rec
 *   - Linux: ffmpeg (preferred), then arecord
 *   - Windows: ffmpeg
 */

import { spawn, type ChildProcess } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { unlink } from "node:fs/promises"

export type RecorderState = "idle" | "recording" | "transcribing"

export type AudioRecorder = {
  state: RecorderState
  outputPath: string
  start: () => Promise<void>
  stop: () => Promise<string>
  abort: () => void
}

async function findTool(names: string[]): Promise<string | null> {
  for (const name of names) {
    try {
      const code = await new Promise<number>((resolve) => {
        const child = spawn(name, ["--version"], {
          stdio: ["ignore", "ignore", "ignore"],
        })
        child.on("close", (code) => resolve(code ?? 1))
        child.on("error", () => resolve(1))
      })
      if (code === 0) return name
    } catch {
      continue
    }
  }
  return null
}

const PLATFORM = process.platform

function ffmpegArgs(outputPath: string): string[] {
  return [
    "-f",
    PLATFORM === "darwin" ? "avfoundation" : PLATFORM === "win32" ? "dshow" : "alsa",
    "-i",
    PLATFORM === "darwin" ? ":default" : PLATFORM === "win32" ? "audio=Microphone" : "default",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    outputPath,
  ]
}

function soxArgs(outputPath: string): string[] {
  return ["-d", "-r", "16000", "-b", "16", "-c", "1", outputPath]
}

function arecordArgs(outputPath: string): string[] {
  return ["-d", "-r", "16000", "-f", "S16_LE", "-c", "1", outputPath]
}

export async function createAudioRecorder(): Promise<AudioRecorder> {
  const outputPath = join(tmpdir(), `opencode-stt-${randomUUID()}.wav`)
  let child: ChildProcess | null = null
  let state: RecorderState = "idle"
  let tool: string | null = null

  const start = async () => {
    if (state !== "idle") throw new Error("Recorder is not idle")

    // Detect available tool
    if (PLATFORM === "darwin") {
      tool = await findTool(["ffmpeg", "sox", "rec"])
    } else if (PLATFORM === "linux") {
      tool = await findTool(["ffmpeg", "arecord"])
    } else if (PLATFORM === "win32") {
      tool = await findTool(["ffmpeg"])
    }

    if (!tool) {
      const hint =
        PLATFORM === "darwin"
          ? "Install ffmpeg (`brew install ffmpeg`) or sox (`brew install sox`)"
          : PLATFORM === "linux"
            ? "Install ffmpeg (`apt install ffmpeg`) or alsa-utils (`apt install alsa-utils`)"
            : "Install ffmpeg from https://ffmpeg.org/"
      throw new Error(`No recording tool found. ${hint}`)
    }

    let args: string[]
    if (tool === "ffmpeg") {
      args = ffmpegArgs(outputPath)
    } else if (tool === "sox" || tool === "rec") {
      args = soxArgs(outputPath)
    } else {
      // arecord
      args = arecordArgs(outputPath)
    }

    state = "recording"

    child = spawn(tool, args, {
      stdio: ["ignore", "ignore", "pipe"],
    })

    // Capture stderr for error reporting
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    return new Promise<void>((resolve, reject) => {
      if (!child) return reject(new Error("Failed to spawn recorder"))

      // Give the recorder a moment to start
      const timeout = setTimeout(() => {
        // If the process is still running after 500ms, consider it started
        if (child?.exitCode === null) {
          resolve()
        }
      }, 500)

      child.on("error", (err) => {
        clearTimeout(timeout)
        state = "idle"
        reject(new Error(`Failed to start ${tool}: ${err.message}`))
      })

      child.on("close", (code) => {
        clearTimeout(timeout)
        if (code && code !== 0 && code !== null) {
          state = "idle"
          reject(new Error(`${tool} exited with code ${code}: ${stderr}`))
        }
      })
    })
  }

  const stop = async (): Promise<string> => {
    if (state !== "recording" || !child) {
      throw new Error("Recorder is not recording")
    }

    state = "transcribing"

    return new Promise<string>((resolve, reject) => {
      child!.on("close", async (code) => {
        if (code && code !== 0) {
          state = "idle"
          reject(new Error(`Recorder exited with code ${code}`))
          return
        }
        state = "idle"
        resolve(outputPath)
      })

      // Send SIGTERM to gracefully stop recording
      child!.kill("SIGTERM")

      // Fallback: if process doesn't close within 3 seconds, force kill
      setTimeout(() => {
        if (child && !child.killed) {
          child.kill("SIGKILL")
        }
      }, 3000)
    })
  }

  const abort = () => {
    if (child && !child.killed) {
      child.removeAllListeners()
      child.kill("SIGKILL")
    }
    child = null
    state = "idle"
    // Clean up the temp file
    unlink(outputPath).catch(() => undefined)
  }

  return {
    get state() {
      return state
    },
    outputPath,
    start,
    stop,
    abort,
  }
}
