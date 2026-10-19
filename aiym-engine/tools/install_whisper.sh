#!/usr/bin/env bash
# Linux: faster-whisper + библиотеки CUDA (видеокарта).  Обычно не нужен — всё ставит ./install_all.sh
set -e
cd "$(dirname "$0")/.."
. tools/common.sh
PY=$(pick_python) || { echo "Нужен Python 3.10–3.12"; exit 1; }
[ -x .venv/bin/python ] || $PY -m venv .venv
.venv/bin/pip install --upgrade pip faster-whisper nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
echo "Готово. Запуск: ./tools/start_whisper.sh"
