#!/usr/bin/env bash
#
# setup-mac.sh — Install and configure OpenCode with Whisper STT + Voicebox TTS
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/lovegold120221-dot/special-invention/main/setup-mac.sh | bash
#
# Or locally:
#   chmod +x setup-mac.sh && ./setup-mac.sh
#
# What this does:
#   1. Installs Homebrew (if missing)
#   2. Installs Bun (if missing)
#   3. Installs pipx + openai-whisper (if missing)
#   4. Installs ffmpeg + sox via Homebrew (if missing)
#   5. Clones the special-invention repo
#   6. Runs bun install
#   7. Sources env vars in ~/.zshrc
#   8. Opens the Voicebox download page for manual install
#   9. Launches the desktop app in dev mode
#

set -euo pipefail

REPO_URL="https://github.com/lovegold120221-dot/special-invention.git"
CLONE_DIR="$HOME/special-invention"
VOICEBOX_DIR="$CLONE_DIR/voicebox"
WHISPER_MODEL="base"
VOICEBOX_PORT=17493
PYTHON="${PYTHON:-python3}"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
NC="\033[0m"

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✘${NC} $*"; }
step()  { echo; echo -e "${BOLD}── $* ──${NC}"; }

# ─── Preflight ───────────────────────────────────────────────────────

step "1. Checking prerequisites"

if ! command -v brew &>/dev/null; then
  info "Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
  ok "Homebrew installed"
else
  ok "Homebrew $(brew --version | head -1)"
fi

if ! command -v bun &>/dev/null; then
  info "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  ok "Bun $(bun --version) installed"
else
  ok "Bun $(bun --version)"
fi

if ! command -v pipx &>/dev/null; then
  info "pipx not found — installing..."
  brew install pipx
  pipx ensurepath
  export PATH="$HOME/.local/bin:$PATH"
  ok "pipx installed"
else
  ok "pipx $(pipx --version)"
fi

# ─── Recording Tools ────────────────────────────────────────────────

step "2. Installing recording tools (ffmpeg, sox)"

if ! command -v ffmpeg &>/dev/null; then
  brew install ffmpeg
  ok "ffmpeg installed"
else
  ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | sed 's/ffmpeg version //;s/ Copyright.*//')"
fi

if ! command -v sox &>/dev/null; then
  brew install sox
  ok "sox installed"
else
  ok "sox $(sox --version 2>&1 | head -1)"
fi

# ─── Whisper (STT) ──────────────────────────────────────────────────

step "3. Installing Whisper (speech-to-text)"

if command -v whisper &>/dev/null; then
  ok "whisper already installed at $(which whisper)"
else
  pipx install openai-whisper
  ok "whisper installed via pipx"
fi

# ─── Clone Repo + Submodules ───────────────────────────────────────

step "4. Cloning repository (with voicebox submodule)"

if [ -d "$CLONE_DIR" ]; then
  info "Directory $CLONE_DIR already exists — pulling latest..."
  cd "$CLONE_DIR"
  git pull
  git submodule update --init --recursive
else
  git clone --recurse-submodules "$REPO_URL" "$CLONE_DIR"
  cd "$CLONE_DIR"
fi
ok "Repository at $CLONE_DIR ($(git rev-parse --short HEAD))"
ok "Voicebox submodule at $VOICEBOX_DIR"

# ─── Install Dependencies ───────────────────────────────────────────

step "5. Installing project dependencies"

cd "$CLONE_DIR"
bun install
ok "bun install complete"

# ─── Shell Environment ──────────────────────────────────────────────

step "6. Configuring shell environment"

ENV_BLOCK=$(cat <<'EOF'

# OpenCode STT / TTS Configuration
export OPENCODE_STT_WHISPER_BIN=whisper
export OPENCODE_STT_WHISPER_MODEL=base
export OPENCODE_STT_LANGUAGE=auto
EOF
)

ZSHRC="$HOME/.zshrc"
if grep -q "OPENCODE_STT_WHISPER_BIN" "$ZSHRC" 2>/dev/null; then
  ok "STT env vars already present in $ZSHRC"
else
  echo "$ENV_BLOCK" >> "$ZSHRC"
  ok "Added STT env vars to $ZSHRC (run 'source ~/.zshrc' after install)"
fi

# ─── Voicebox Submodule Setup ──────────────────────────────────────

step "7. Installing Voicebox backend (text-to-speech)"

VOICEBOX_VENV="$VOICEBOX_DIR/.venv"

if curl -sf http://127.0.0.1:$VOICEBOX_PORT/health &>/dev/null; then
  ok "Voicebox is already running on port $VOICEBOX_PORT"
else
  # Create virtual environment if needed
  if [ ! -d "$VOICEBOX_VENV" ]; then
    info "Creating Python virtual environment for Voicebox..."
    "$PYTHON" -m venv "$VOICEBOX_VENV"
    ok "Virtual env created"
  fi

  # Install backend dependencies
  info "Installing Voicebox Python dependencies..."
  "$VOICEBOX_VENV/bin/pip" install --quiet --upgrade pip setuptools wheel
  "$VOICEBOX_VENV/bin/pip" install --quiet -r "$VOICEBOX_DIR/backend/requirements.txt"

  # Install MLX deps on Apple Silicon
  if [ "$(uname -m)" = "arm64" ]; then
    info "Apple Silicon detected — installing MLX dependencies..."
    "$VOICEBOX_VENV/bin/pip" install --quiet -r "$VOICEBOX_DIR/backend/requirements-mlx.txt"
    "$VOICEBOX_VENV/bin/pip" install --quiet --no-deps mlx-audio==0.4.1 2>/dev/null || true
  fi
  ok "Voicebox dependencies installed"

  # Launch Voicebox server in background
  info "Starting Voicebox server on port $VOICEBOX_PORT..."
  cd "$VOICEBOX_DIR"
  nohup "$VOICEBOX_VENV/bin/python" -m backend.main \
    --host 0.0.0.0 \
    --port "$VOICEBOX_PORT" \
    --data-dir "$VOICEBOX_DIR/data" \
    > "$VOICEBOX_DIR/server.log" 2>&1 &
  VOICEBOX_PID=$!
  echo "$VOICEBOX_PID" > "$VOICEBOX_DIR/server.pid"
  ok "Voicebox server starting (PID: $VOICEBOX_PID)"

  # Wait for it to come up
  info "Waiting for Voicebox to be ready..."
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:$VOICEBOX_PORT/health &>/dev/null; then
      ok "Voicebox is ready!"
      break
    fi
    sleep 2
  done
  if ! curl -sf http://127.0.0.1:$VOICEBOX_PORT/health &>/dev/null; then
    warn "Voicebox did not start within 60s — check $VOICEBOX_DIR/server.log"
  fi
fi

# ─── Verify ─────────────────────────────────────────────────────────

step "8. Verification"

echo ""
printf "  %-25s %s\n" "Tool" "Status"
printf "  %-25s %s\n" "────" "──────"

for cmd in brew bun pipx whisper ffmpeg sox; do
  if command -v "$cmd" &>/dev/null; then
    printf "  ${GREEN}%-25s ✓${NC}\n" "$cmd"
  else
    printf "  ${RED}%-25s ✘${NC}\n" "$cmd"
  fi
done

if curl -sf http://127.0.0.1:$VOICEBOX_PORT/health &>/dev/null; then
  printf "  ${GREEN}%-25s ✓${NC}\n" "voicebox (port $VOICEBOX_PORT)"
else
  printf "  ${YELLOW}%-25s ⚠ (not running)${NC}\n" "voicebox (port $VOICEBOX_PORT)"
fi

# ─── Done ───────────────────────────────────────────────────────────

step "9. Launch!"

echo ""
echo "  ${BOLD}All dependencies installed.${NC}"
echo ""
echo "  To start the Desktop app (development mode with hot-reload):"
echo ""
echo "    cd $CLONE_DIR/packages/desktop"
echo "    bun run dev"
echo ""
echo "  To start the TUI (terminal) app:"
echo ""
echo "    cd $CLONE_DIR/packages/tui"
echo "    bun run dev"
  echo "  To stop/start Voicebox server:"
  echo ""
  echo "    $CLONE_DIR/voicebox-server.sh stop"
  echo "    $CLONE_DIR/voicebox-server.sh start"
  echo "    $CLONE_DIR/voicebox-server.sh log"
  echo ""
  echo "  Keybind: ${BOLD}Alt+M${NC} to toggle microphone"
  echo "  TTS:     Speaker icon in header bar"
  echo ""

# Auto-launch desktop if on macOS with GUI
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ] || pgrep -q "Dock"; then
  info "Launching desktop app..."
  cd "$CLONE_DIR/packages/desktop"
  bun run dev &
  DESKTOP_PID=$!
  ok "Desktop app started (PID: $DESKTOP_PID)"
  echo ""
  warn "Keep this terminal open — closing it will stop the app."
  warn "Alternatively, run 'bun run dev' in a new terminal."
  wait $DESKTOP_PID 2>/dev/null
else
  info "No GUI detected — skipping desktop launch."
  echo "  You can run the TUI app instead:"
  echo "    cd $CLONE_DIR/packages/tui && bun run dev"
fi

echo ""
ok "Setup complete!"
