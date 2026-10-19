#!/usr/bin/env bash
cd "$(dirname "$0")/.."
if [ -z "$WHISPER_MODEL" ]; then if ls .venv/lib/python*/site-packages/nvidia/cublas >/dev/null 2>&1; then WHISPER_MODEL=large-v3-turbo; else WHISPER_MODEL=small; fi; fi
WHISPER_MODEL="$WHISPER_MODEL" exec .venv/bin/python tools/whisper_server.py
