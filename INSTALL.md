# OpenCode — STT + TTS Setup

This guide walks you through setting up a fully local, offline-capable OpenCode with **Whisper speech-to-text** and **Voicebox text-to-speech** — exactly as configured on the development machine.

## Prerequisites

| Tool | Minimum | Check |
|------|---------|-------|
| **macOS** | 14.x (Sonoma) | `sw_vers -productVersion` |
| **Bun** | 1.3.x | `bun --version` |
| **Homebrew** | latest | `brew --version` |
| **pipx** | latest | `pipx --version` |
| **ffmpeg** | (optional, TUI) | `ffmpeg -version` |
| **sox** | (optional, TUI) | `sox --version` |

Install everything:

```bash
# Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Bun
curl -fsSL https://bun.sh/install | bash

# pipx
brew install pipx
pipx ensurepath

# Recording tools (TUI only)
brew install ffmpeg sox
```

## Step 1 — Clone the Repository

```bash
git clone --recurse-submodules https://github.com/lovegold120221-dot/special-invention.git
cd special-invention

# If you already cloned without --recurse-submodules:
# git submodule update --init --recursive
```

## Step 2 — Install Dependencies

```bash
bun install
```

This installs all workspace packages including the desktop (Electron) and TUI apps.

## Step 3 — Install Whisper (Speech-to-Text)

```bash
pipx install openai-whisper
```

This installs the `whisper` CLI. The default model (`base`) downloads on first use (~150 MB). To use a different model size, set `OPENCODE_STT_WHISPER_MODEL` (see Step 6).

Verify it works:

```bash
whisper --help
```

## Step 4 — Install Voicebox (Text-to-Speech)

### Option A — Via Submodule (Recommended for this fork)

The Voicebox Python backend is included as a git submodule at `voicebox/`.

```bash
# Navigate to the repo
cd special-invention

# Install Python dependencies
./voicebox-server.sh setup

# Start the server
./voicebox-server.sh start
```

The server starts on `http://127.0.0.1:17493`.

**Management commands:**

| Command | What it does |
|---------|-------------|
| `./voicebox-server.sh start` | Start the server in background |
| `./voicebox-server.sh stop` | Stop the server |
| `./voicebox-server.sh status` | Check if running |
| `./voicebox-server.sh log` | Follow server logs |
| `./voicebox-server.sh setup` | Install/reinstall Python deps |

### Option B — macOS App (Standalone)

Download the latest release from https://voicebox.sh and install the `.app`.

It auto-starts on login and serves the API on port 17493.

### Option C — Docker

```bash
docker run -d \
  --name voicebox \
  --restart unless-stopped \
  -p 17493:17493 \
  voicebox/voicebox-server
```

### Verify Voicebox is running:

```bash
curl http://127.0.0.1:17493/health
```

Expected response:

```json
{"status":"healthy","model_loaded":false,"model_downloaded":true,"gpu_available":true,"gpu_type":"MPS (Apple Silicon)","backend_type":"mlx"}
```

## Step 5 — Configure Environment (Optional)

All env vars have sensible defaults. Set them only if you need to override:

```bash
# Path to the whisper CLI binary (default: "whisper")
export OPENCODE_STT_WHISPER_BIN=whisper

# Whisper model size (default: "base")
export OPENCODE_STT_WHISPER_MODEL=base

# Language code for STT (default: "auto" → auto-detect, omit the --language flag)
export OPENCODE_STT_LANGUAGE=auto
```

Add these to your `~/.zshrc` or `~/.bashrc` to persist:

```bash
cat >> ~/.zshrc << 'EOF'

# OpenCode STT / TTS
export OPENCODE_STT_WHISPER_BIN=whisper
export OPENCODE_STT_WHISPER_MODEL=base
export OPENCODE_STT_LANGUAGE=auto
EOF
source ~/.zshrc
```

## Step 6 — Launch the Desktop App

### Development Mode (with hot-reload):

```bash
cd packages/desktop
bun run dev
```

### Production Build:

```bash
cd packages/desktop
bun run build
bun run preview
```

The app opens an Electron window. The first launch may take a moment to compile.

## Step 7 — Launch the TUI (Terminal App)

```bash
cd packages/tui
bun run dev
```

The TUI detects available recording tools: `ffmpeg` → `sox`/`rec` (macOS) → `arecord` (Linux).

## Verification Checklist

| Feature | How to test | Expected result |
|---------|-------------|-----------------|
| **Mic button** | Look in prompt input area | 🎤 icon visible |
| **Mic keybind** | Press `Alt+M` | Starts recording (Desktop or TUI) |
| **Audio visualizer** | Click mic button | 5 animated frequency bars appear |
| **Language dropdown** | Click language selector next to mic | 160+ language list |
| **Transcription** | Speak, stop recording | Text appears in prompt input |
| **Speaker icon** | Look in header bar | 🔈 toggle visible |
| **TTS voice dropdown** | Click voice selector next to speaker | Lists fetched Voicebox profiles |
| **TTS engine dropdown** | Click engine selector | Engine options (LuxTTS, Qwen, etc.) |
| **Auto-read** | Let assistant finish a response | TTS reads it aloud automatically |

## Troubleshooting

### "Permission denied" for microphone (Desktop)

In earlier versions, the Electron renderer may block `getUserMedia`. Ensure the renderer
permissions include `"media"`. This is fixed in this fork in `packages/desktop/src/main/windows.ts`.

### Whisper CLI fails with "auto" language

The Whisper CLI (`openai-whisper`) does **not** accept `auto` as a `--language` value.
When `OPENCODE_STT_LANGUAGE=auto` (the default), the `--language` flag is omitted entirely,
which triggers Whisper's built-in auto-detection. This is handled in both the Desktop and TUI
code paths.

### Voicebox not responding

```bash
curl http://127.0.0.1:17493/health
```

If this fails, check:

- Is the server running? `./voicebox-server.sh status`
- Check the logs: `./voicebox-server.sh log`
- Are the dependencies installed? Run `./voicebox-server.sh setup`
- Try the standalone macOS app from https://voicebox.sh
- Or run via Docker: `docker run -d --name voicebox -p 17493:17493 voicebox/voicebox-server`

### Voicebox submodule not found

If the `voicebox/` directory is empty, you cloned without submodules:

```bash
git submodule update --init --recursive
```

### TUI recording fails

Ensure at least one recording tool is installed:

```bash
which ffmpeg sox rec arecord
```

macOS: `ffmpeg` or `sox` (which provides `rec`).
Linux: `arecord` (from `alsa-utils`).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Desktop (Electron)                      │
│                                                             │
│  Renderer ──MediaRecorder──► Audio Blob ──IPC──► Main      │
│    │                                                    │   │
│    │  🎤 Mic button      Temp WAV ◄── whisper CLI       │   │
│    │  🌐 Language select  Text ──IPC──► Renderer        │   │
│    │  📊 Freq bars                                      │   │
│    │                                                    │   │
│  Header ──🔈 Speaker toggle                             │   │
│          ──🗣️ Voice profile dropdown                    │   │
│          ──⚙️ Engine dropdown                           │   │
│          ── Auto-read on session.idle                   │   │
│                                                             │
│  TTS ────► Voicebox API (http://127.0.0.1:17493)           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    TUI (Terminal)                           │
│                                                             │
│  Recorder ──ffmpeg/sox/arecord──► Temp WAV                  │
│       │                                                    │
│  whisper CLI ◄── Transcribe ──► Text in prompt             │
│                                                             │
│  Footer: [● Mic] / [⋯ Transcribing]                        │
│  Keybind: Alt+M                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Source Files

| File | Purpose |
|------|---------|
| `packages/desktop/src/main/stt-whisper.ts` | Desktop Whisper CLI runner |
| `packages/desktop/src/main/ipc.ts` | IPC handler for stt-transcribe |
| `packages/desktop/src/preload/` | Preload bridge (types + index) |
| `packages/desktop/src/renderer/index.tsx` | Platform bridge |
| `packages/app/src/components/prompt-input.tsx` | Mic button, language dropdown, freq bars |
| `packages/app/src/components/prompt-input/audio-recorder.ts` | MediaRecorder + AnalyserNode |
| `packages/app/src/components/prompt-input/languages.ts` | 160+ language → Whisper code map |
| `packages/app/src/components/session/session-header.tsx` | Speaker toggle, voice/engine dropdowns, auto-read |
| `packages/app/src/services/voicebox.ts` | Voicebox TTS API client |
| `packages/app/src/context/notification.tsx` | Auto-read event dispatch on session.idle |
| `packages/tui/src/stt/whisper.ts` | TUI Whisper CLI runner |
| `packages/tui/src/stt/recorder.ts` | TUI audio recorder (ffmpeg/sox/arecord) |
| `packages/tui/src/audio.ts` | TUI STT orchestration |
| `packages/tui/src/component/prompt/index.tsx` | TUI mic toggle + state indicator |
| `packages/ui/src/v2/components/icon.tsx` | Speaker/speaker-muted icons |
| `packages/ui/src/components/icon.tsx` | Mic/stop icons |
| `voicebox/` | Voicebox TTS server submodule ([jamiepine/voicebox](https://github.com/jamiepine/voicebox)) |
| `voicebox-server.sh` | Manage script for the Voicebox submodule backend |
| `setup-mac.sh` | Full automated macOS setup script |
| `INSTALL.md` | This install guide |
| `.env.example` | Environment variable template |

## Persistent Settings

These are stored in the Electron app's data directory
(`~/Library/Application Support/ai.opencode.desktop.dev/`):

| Key | Default | Description |
|-----|---------|-------------|
| `tts.enabled` | `true` | Enable/disable TTS auto-read |
| `tts.profileId` | `""` | Selected Voicebox voice profile UUID |
| `tts.engine` | `"luxtts"` | TTS engine (luxtts, qwen, chatterbox, etc.) |
| `sttLanguage` | `"auto"` | Whisper language code for transcription |
