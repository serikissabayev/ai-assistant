#!/usr/bin/env bash
# Whisper как сервер для локальной сети (на машине с NVIDIA, например рядом с LM Studio). Установка: ./tools/install_whisper.sh
cd "$(dirname "$0")/.."
WHISPER_HOST=0.0.0.0 exec ./tools/start_whisper.sh
