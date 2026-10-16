#!/usr/bin/env python3
"""Локальный сервер без кэша: правки модулей видны сразу после перезагрузки страницы."""
import sys, json, pathlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def do_GET(self):
        if self.path.split('?')[0].rstrip('/') == '/api/modules':
            mods = []
            for mj in sorted(pathlib.Path('modules').glob('*/module.json')):
                try:
                    m = json.loads(mj.read_text(encoding='utf-8')); m['id'] = mj.parent.name; mods.append(m)
                except Exception:
                    pass
            body = json.dumps(mods, ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()
    def log_message(self, *a): pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
