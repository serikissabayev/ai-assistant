#!/usr/bin/env bash
# Linux/macOS: ставит faster-whisper и запускает сервер  ->  ./tools/install_whisper.sh && ./tools/start_whisper.sh
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip faster-whisper
echo "Готово. Запуск: ./tools/start_whisper.sh"
