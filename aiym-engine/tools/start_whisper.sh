#!/usr/bin/env bash
# Whisper на видеокарте (http://localhost:8000/v1). Модель: WHISPER_MODEL=large-v3 ./tools/start_whisper.sh
cd "$(dirname "$0")/.."
. tools/common.sh
ls .venv/lib/python*/site-packages/nvidia/cublas >/dev/null 2>&1 || .venv/bin/pip install -q --upgrade nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
cuda_libs
WHISPER_MODEL="${WHISPER_MODEL:-large-v3-turbo}" exec .venv/bin/python tools/whisper_server.py
