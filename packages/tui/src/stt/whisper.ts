/**
 * Local Whisper CLI transcription for the TUI.
 *
 * Environment variables:
 *   OPENCODE_STT_WHISPER_BIN    – path to whisper binary (default: "whisper")
 *   OPENCODE_STT_WHISPER_MODEL  – model name (default: "base")
 *   OPENCODE_STT_LANGUAGE       – language code (e.g. "en", "fr") or omitted for auto (default: "auto", treated as omit)
 */

import { spawn } from "node:child_process"
import { readFile, unlink, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

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
 * Transcribe a WAV audio file using the local Whisper CLI.
 * Returns the transcription text.
 * Deletes the temporary output file after reading.
 *
 * @param audioPath - Path to WAV audio file
 * @param language - Optional language override (empty string = use env var or auto-detect)
 */
export async function transcribeFile(audioPath: string, language?: string): Promise<string> {
  const bin = getWhisperBin()
  const model = getModel()
  const lang = language || getLanguage()
  const id = randomUUID()
  const outputDir = join(tmpdir(), `opencode-stt-out-${id}`)

  try {
    await mkdir(outputDir, { recursive: true })

    // whisper audio.wav --model base [--language en] --output_dir /tmp --output_format txt
    // Note: --language is only passed when not "auto" because the whisper CLI
    // does not accept "auto" as a value; omitting it lets Whisper auto-detect.
    const args = [audioPath, "--model", model, "--output_dir", outputDir, "--output_format", "txt"]
    if (lang !== "auto") {
      args.push("--language", lang)
    }

    const text = await runWhisper(bin, args, audioPath, outputDir)
    return text
  } finally {
    // Clean up the output directory
    const baseName = stripExt(basename(audioPath))
    await unlink(join(outputDir, `${baseName}.txt`)).catch(() => undefined)
    await unlink(outputDir).catch(() => undefined)
  }
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/")
  return idx >= 0 ? p.slice(idx + 1) : p
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf(".")
  return idx > 0 ? name.slice(0, idx) : name
}

function runWhisper(
  bin: string,
  args: string[],
  audioPath: string,
  outputDir: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""
    child.stdout?.on("data", () => {
      // stdout is progress output, ignore
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
      const baseName = stripExt(basename(audioPath))
      const outPath = join(outputDir, `${baseName}.txt`)
      try {
        const text = await readFile(outPath, "utf-8")
        resolve(text.trim())
      } catch {
        reject(new Error(`Whisper output file not found: ${outPath}`))
      }
    })

    child.on("error", (err) => {
      reject(new Error(`Failed to start whisper: ${err.message}`))
    })
  })
}
