#!/usr/bin/env bash
# Где распознавать речь (Whisper) → config/local.json.   ./tools/set_stt_url.sh [адрес]
# Enter — на этом компьютере (нужна NVIDIA). Адрес сервера — Whisper в локальной сети (на сервере: ./tools/start_whisper_server.sh).
cd "$(dirname "$0")/.."
URL="$1"
if [ -z "$URL" ]; then
  read -r -p "Адрес Whisper (Enter — на этом компьютере; на сервере, например 192.168.1.50:8000): " URL
fi
URL="${URL:-http://localhost:8000/v1}"
case "$URL" in http://*|https://*) ;; *) URL="http://$URL";; esac
case "$URL" in */v1) ;; *) URL="${URL%/}/v1";; esac
python3 - "$URL" <<'PY'
import json, pathlib, sys
p = pathlib.Path('config/local.json'); d = json.loads(p.read_text('utf-8')) if p.exists() else {}
c = d.setdefault('modules', {}).setdefault('hearing', {}).setdefault('config', {}); c['sttUrl'] = sys.argv[1]; c['sttMode'] = 'server'
p.write_text(json.dumps(d, ensure_ascii=False, indent=1), 'utf-8'); print('Whisper:', sys.argv[1], '→ config/local.json')
PY
