import { writeFile, unlink } from "node:fs/promises"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"

function getWhisperBin(): string {
  return process.env.OPENCODE_STT_WHISPER_BIN ?? "whisper"
}

function getModel(): string {
  return process.env.OPENCODE_STT_WHISPER_MODEL ?? "base"
}

function getLanguage(): string {
  return process.env.OPENCODE_STT_LANGUAGE ?? "auto"
}

/**
 * Transcribe audio data using a local Whisper CLI binary.
 *
 * Accepts an ArrayBuffer of audio data (webm from MediaRecorder).
 * Writes it to a temp file, invokes whisper, reads the result,
 * deletes the temp files, and returns the transcription text.
 *
 * @param audioBuffer - Raw audio data from MediaRecorder
 * @param language - Optional language override (empty string = use env var or auto-detect)
 *
 * Environment variables:
 *   OPENCODE_STT_WHISPER_BIN    – path to whisper binary (default: "whisper")
 *   OPENCODE_STT_WHISPER_MODEL  – model name (default: "base")
 *   OPENCODE_STT_LANGUAGE       – language code (e.g. "en", "fr") or omitted for auto (default: "auto", treated as omit)
 */
export async function transcribe(audioBuffer: ArrayBuffer, language?: string): Promise<string> {
  const bin = getWhisperBin()
  const model = getModel()
  // If a language was explicitly provided, use it; otherwise fall back to env var
  const lang = language || getLanguage()
  const id = randomUUID()
  const audioPath = join(tmpdir(), `opencode-stt-${id}.webm`)
  const outputDir = join(tmpdir(), `opencode-stt-out-${id}`)

  try {
    // Write the audio blob to a temp file
    await writeFile(audioPath, Buffer.from(audioBuffer))

    // Run whisper CLI
    const text = await runWhisper(bin, audioPath, model, lang, outputDir)
    return text
  } finally {
    // Clean up temp files
    await unlink(audioPath).catch(() => undefined)
    const cleanName = stripExt(pathBasename(audioPath))
    await unlink(join(outputDir, `${cleanName}.txt`)).catch(() => undefined)
    // Remove the output directory if empty
    await unlink(outputDir).catch(() => undefined)
  }
}

function pathBasename(p: string): string {
  const idx = p.lastIndexOf("/")
  return idx >= 0 ? p.slice(idx + 1) : p
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf(".")
  return idx > 0 ? name.slice(0, idx) : name
}

function runWhisper(
  bin: string,
  audioPath: string,
  model: string,
  language: string,
  outputDir: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // whisper audio.wav --model base [--language en] --output_dir /tmp --output_format txt
    // Note: --language is only passed when not "auto" because the whisper CLI
    // does not accept "auto" as a value; omitting it lets Whisper auto-detect.
    const args = [audioPath, "--model", model, "--output_dir", outputDir, "--output_format", "txt"]
    if (language !== "auto") {
      args.push("--language", language)
    }

    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""
    child.stdout?.on("data", () => {
      // stdout is the progress output, we don't need it
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper exited with code ${code}: ${stderr}`))
        return
      }

      // Read the output file
      const baseName = stripExt(pathBasename(audioPath))
      const outPath = join(outputDir, `${baseName}.txt`)
      try {
        const { readFile } = await import("node:fs/promises")
        const text = await readFile(outPath, "utf-8")
        resolve(text.trim())
      } catch {
        // If .txt isn't found, try with just the basename directly
        const { readFile } = await import("node:fs/promises")
        const altPath = join(outputDir, `${baseName}`)
        try {
          const text = await readFile(altPath, "utf-8")
          resolve(text.trim())
        } catch {
          reject(new Error(`Whisper output file not found: ${outPath}`))
        }
      }
    })

    child.on("error", (err) => {
      reject(new Error(`Failed to start whisper: ${err.message}`))
    })
  })
}
