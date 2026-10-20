"""Печатает адрес Whisper из config/local.json, если он на другом компьютере (иначе ничего) — для start_all."""
import json, pathlib, sys
try:
    u = json.loads(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'config/local.json').read_text('utf-8'))['modules']['hearing']['config']['sttUrl']
    if not any(h in u for h in ('//localhost', '//127.0.0.1')): print(u)
except Exception: pass
