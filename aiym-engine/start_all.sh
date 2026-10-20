#!/usr/bin/env bash
# Запуск всего на Linux: Whisper (видеокарта) + движок + браузер.  Ctrl+C — остановить всё.
# Сервер ИИ (LM Studio) — отдельно; адрес: ./tools/set_llm_url.sh
cd "$(dirname "$0")"
. tools/common.sh
cuda_libs
mkdir -p logs
pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null; exit 0; }
trap cleanup INT TERM
if .venv/bin/python -c 'import faster_whisper' >/dev/null 2>&1; then
  ./tools/start_whisper.sh > logs/whisper.log 2>&1 & pids+=($!)
  echo "Whisper запущен (журнал: logs/whisper.log)"
else echo "Whisper не установлен — запустите ./install_all.sh (без него ассистент не слышит)"; fi
python3 serve.py 8080 > logs/engine.log 2>&1 & pids+=($!)
sleep 3
URL=http://localhost:8080
for b in microsoft-edge microsoft-edge-stable google-chrome google-chrome-stable chromium chromium-browser; do
  command -v "$b" >/dev/null && { "$b" --new-window "$URL" >/dev/null 2>&1 & break; }
done || xdg-open "$URL" >/dev/null 2>&1 &
echo "Адина → $URL   (Ctrl+C — остановить всё)"
touch logs/whisper.log; tail -n +1 -f logs/whisper.log logs/engine.log & pids+=($!)
wait
