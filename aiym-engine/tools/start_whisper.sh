#!/usr/bin/env bash
cd "$(dirname "$0")/.."
WHISPER_MODEL="${WHISPER_MODEL:-small}" exec .venv/bin/python tools/whisper_server.py
