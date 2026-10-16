#!/usr/bin/env bash
# Локальный сервер для движка (ES-модули не работают с file://).
# Киоск:  chromium --kiosk --app=http://localhost:8080 --use-fake-ui-for-media-stream
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "Айым → http://localhost:${PORT}"
exec python3 serve.py "$PORT"
