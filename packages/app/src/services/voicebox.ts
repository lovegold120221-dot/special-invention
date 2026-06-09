/**
 * Voicebox TTS service — speaks text via the local Voicebox REST API.
 *
 * Voicebox runs at http://127.0.0.1:17493
 *
 * Flow:
 *   POST /speak  → returns generation `id` (status: "generating")
 *   Poll history until status is "completed"
 *   Fetch audio via GET /audio/{id}
 *   Play via HTMLAudioElement
 */

const VOICEBOX_URL = "http://127.0.0.1:17493"

export interface VoiceboxProfile {
  id: string
  name: string
  language: string
  default_engine: string | null
}

export interface VoiceboxEngine {
  id: string
  name: string
}

/** Available TTS engines on this Voicebox instance */
export const ENGINES: VoiceboxEngine[] = [
  { id: "luxtts", name: "LuxTTS" },
  { id: "qwen", name: "Qwen TTS" },
  { id: "qwen_custom_voice", name: "Qwen CustomVoice" },
  { id: "chatterbox", name: "Chatterbox" },
  { id: "chatterbox_turbo", name: "Chatterbox Turbo" },
  { id: "tada", name: "TADA" },
  { id: "kokoro", name: "Kokoro" },
]

/** Fetch all voice profiles from Voicebox */
export async function fetchProfiles(): Promise<VoiceboxProfile[]> {
  try {
    const res = await fetch(`${VOICEBOX_URL}/profiles`)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

/** Speak text via Voicebox, returns the generation ID */
export async function speak(
  text: string,
  profile?: string,
  engine?: string,
): Promise<string> {
  const body: Record<string, unknown> = { text, language: "en" }
  if (profile) body.profile = profile
  if (engine) body.engine = engine

  const res = await fetch(`${VOICEBOX_URL}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Voicebox speak failed: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return data.id as string
}

/**
 * Poll the /history endpoint until a generation completes or times out.
 * Returns the audio URL to play.
 */
async function waitForGeneration(
  generationId: string,
  timeoutMs = 120_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${VOICEBOX_URL}/history?limit=100`)
      if (res.ok) {
        const data = (await res.json()) as { items?: Array<{ id: string; status: string; audio_path?: string }> }
        const item = data.items?.find((i) => i.id === generationId)
        if (item?.status === "completed" && item.audio_path) {
          return `${VOICEBOX_URL}/${item.audio_path}`
        }
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Voicebox generation timed out after ${timeoutMs}ms`)
}

/**
 * Speak a text, wait for completion, and play the audio.
 * Returns the Audio element so the caller can pause/stop it.
 */
export async function speakAndPlay(
  text: string,
  profile?: string,
  engine?: string,
): Promise<HTMLAudioElement> {
  const genId = await speak(text, profile, engine)
  const audioUrl = await waitForGeneration(genId)
  const audio = new Audio(audioUrl)
  audio.play().catch(() => {
    // autoplay may be blocked; fail silently
  })
  return audio
}
