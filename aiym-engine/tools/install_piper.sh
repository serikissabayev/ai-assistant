#!/usr/bin/env bash
# Ставит Piper (локальный нейро-TTS) и скачивает голоса в aiym-engine/voices/.
# Запуск на сервере:  ./tools/install_piper.sh
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip piper-tts
mkdir -p voices
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main
# lang/family/voice/quality — при ошибке 404 посмотрите список: https://huggingface.co/rhasspy/piper-voices/tree/main
for v in "ru/ru_RU/irina/medium" "ru/ru_RU/denis/medium" "kk/kk_KZ/issai/high" "kk/kk_KZ/raya/x_low" "kk/kk_KZ/iseke/x_low"; do
  IFS=/ read -r l f n q <<<"$v"; id="${f}-${n}-${q}"
  [ -f "voices/$id.onnx" ] && continue
  if curl -fsSL -o "voices/$id.onnx" "$BASE/$l/$f/$n/$q/$id.onnx" && curl -fsSL -o "voices/$id.onnx.json" "$BASE/$l/$f/$n/$q/$id.onnx.json"; then echo "ok  $id"
  else echo "ПРОПУЩЕН $id (нет такого файла)"; rm -f "voices/$id.onnx" "voices/$id.onnx.json"; fi
done
echo "Готово. Голоса: $(ls voices/*.onnx 2>/dev/null | wc -l)"
