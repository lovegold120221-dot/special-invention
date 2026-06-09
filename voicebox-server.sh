#!/usr/bin/env bash
#
# voicebox-server.sh — Manage the Voicebox TTS backend server
#
# Usage:
#   ./voicebox-server.sh start    Start the server (daemon)
#   ./voicebox-server.sh stop     Stop the server
#   ./voicebox-server.sh restart  Restart the server
#   ./voicebox-server.sh status   Check if running
#   ./voicebox-server.sh log      Follow server logs
#   ./voicebox-server.sh setup    Install Python dependencies
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICEBOX_DIR="$SCRIPT_DIR/voicebox"
VOICEBOX_VENV="$VOICEBOX_DIR/.venv"
VOICEBOX_PORT=17493
PID_FILE="$VOICEBOX_DIR/server.pid"
LOG_FILE="$VOICEBOX_DIR/server.log"
PYTHON="${PYTHON:-python3}"
HEALTH_URL="http://127.0.0.1:$VOICEBOX_PORT/health"

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

ensure_venv() {
  if [ ! -d "$VOICEBOX_VENV" ]; then
    info "Creating virtual environment..."
    "$PYTHON" -m venv "$VOICEBOX_VENV"
  fi
}

cmd_status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo -e "${GREEN}Voicebox is running${NC} (PID: $(cat "$PID_FILE"))"
    return 0
  elif curl -sf "$HEALTH_URL" &>/dev/null; then
    echo -e "${GREEN}Voicebox is running${NC} (no PID file)"
    return 0
  else
    echo -e "${YELLOW}Voicebox is NOT running${NC}"
    return 1
  fi
}

cmd_start() {
  if cmd_status &>/dev/null; then
    warn "Voicebox is already running."
    return 0
  fi

  ensure_venv

  if [ ! -f "$VOICEBOX_DIR/backend/main.py" ]; then
    err "Voicebox backend not found at $VOICEBOX_DIR/backend"
    err "Did you run 'git submodule update --init --recursive'?"
    exit 1
  fi

  info "Starting Voicebox server on port $VOICEBOX_PORT..."
  cd "$VOICEBOX_DIR"
  nohup "$VOICEBOX_VENV/bin/python" -m backend.main \
    --host 0.0.0.0 \
    --port "$VOICEBOX_PORT" \
    --data-dir "$VOICEBOX_DIR/data" \
    > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  ok "Voicebox server starting (PID: $!)"

  # Wait for it to come up
  for i in $(seq 1 30); do
    if curl -sf "$HEALTH_URL" &>/dev/null; then
      ok "Voicebox is ready!"
      return 0
    fi
    sleep 2
  done

  warn "Timed out waiting for Voicebox — check $LOG_FILE"
  return 1
}

cmd_stop() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      info "Stopping Voicebox (PID: $PID)..."
      kill "$PID" 2>/dev/null || true
      sleep 2
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" 2>/dev/null || true
      fi
      ok "Voicebox stopped"
    fi
    rm -f "$PID_FILE"
  else
    # Try to find and kill the process
    PID=$(pgrep -f "backend.main" 2>/dev/null || true)
    if [ -n "$PID" ]; then
      info "Stopping Voicebox (PID: $PID)..."
      kill "$PID" 2>/dev/null || true
      ok "Voicebox stopped"
    else
      warn "Voicebox is not running"
    fi
  fi
}

cmd_setup() {
  ensure_venv
  info "Installing Voicebox Python dependencies..."
  "$VOICEBOX_VENV/bin/pip" install --quiet --upgrade pip setuptools wheel
  "$VOICEBOX_VENV/bin/pip" install --quiet -r "$VOICEBOX_DIR/backend/requirements.txt"
  if [ "$(uname -m)" = "arm64" ]; then
    info "Apple Silicon detected — installing MLX dependencies..."
    "$VOICEBOX_VENV/bin/pip" install --quiet -r "$VOICEBOX_DIR/backend/requirements-mlx.txt"
    "$VOICEBOX_VENV/bin/pip" install --quiet --no-deps mlx-audio==0.4.1 2>/dev/null || true
  fi
  ok "Voicebox dependencies installed"
}

cmd_log() {
  if [ -f "$LOG_FILE" ]; then
    tail -f "$LOG_FILE"
  else
    warn "No log file found at $LOG_FILE"
  fi
}

# ─── Main ───────────────────────────────────────────────────────────

case "${1:-status}" in
  start)
    cmd_start
    ;;
  stop)
    cmd_stop
    ;;
  restart)
    cmd_stop
    sleep 1
    cmd_start
    ;;
  status)
    cmd_status
    ;;
  log)
    cmd_log
    ;;
  setup)
    cmd_setup
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|log|setup}"
    exit 1
    ;;
esac
