#!/usr/bin/env bash
# Адрес сервера ИИ (LM Studio) для этого компьютера → config/local.json.   ./tools/set_llm_url.sh [адрес]
cd "$(dirname "$0")/.."
URL="$1"
if [ -z "$URL" ]; then
  read -r -p "Адрес сервера ИИ (Enter — http://localhost:1235/v1; по сети, например http://192.168.1.50:1235/v1): " URL
fi
URL="${URL:-http://localhost:1235/v1}"
case "$URL" in http://*|https://*) ;; *) URL="http://$URL";; esac
case "$URL" in */v1) ;; *) URL="${URL%/}/v1";; esac
python3 - "$URL" <<'PY'
import json, pathlib, sys
p = pathlib.Path('config/local.json'); d = json.loads(p.read_text('utf-8')) if p.exists() else {}
d.setdefault('modules', {}).setdefault('brain', {}).setdefault('config', {})['url'] = sys.argv[1]
p.write_text(json.dumps(d, ensure_ascii=False, indent=1), 'utf-8'); print('Сервер ИИ:', sys.argv[1], '→ config/local.json')
PY
