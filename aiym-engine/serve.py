#!/usr/bin/env python3
"""Локальный сервер без кэша: правки модулей видны сразу после перезагрузки страницы."""
import sys, json, pathlib, os, re, shutil, subprocess, tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent
VOICES = ROOT / 'voices'

def piper_bin():
    """Ищем Piper: PIPER_BIN, затем .venv рядом, затем PATH."""
    for c in (os.environ.get('PIPER_BIN'), str(ROOT / '.venv/bin/piper'), str(ROOT / '.venv/Scripts/piper.exe'), shutil.which('piper')):
        if c and pathlib.Path(c).exists(): return c
    return None

def list_voices():
    return sorted(p.stem for p in VOICES.glob('*.onnx') if (p.parent / (p.name + '.json')).exists())

def pick_voice(want, text):
    vs = list_voices()
    if want and want != 'auto' and want in vs: return want
    lang = 'kk' if re.search('[әіңғүұқөһӘІҢҒҮҰҚӨҺ]', text) else 'ru' if re.search('[а-яёА-ЯЁ]', text) else 'en'
    for pref in (lang, 'kk' if lang == 'ru' else 'ru', ''):
        for v in vs:
            if v.startswith(pref): return v
    return None

def synth(text, voice):
    pb = piper_bin()
    if not pb: raise RuntimeError('Piper не установлен: запустите tools/install_piper.sh')
    v = pick_voice(voice, text)
    if not v: raise RuntimeError('Нет голосов в aiym-engine/voices/ (tools/install_piper.sh)')
    with tempfile.TemporaryDirectory() as d:
        out = pathlib.Path(d) / 'o.wav'
        r = subprocess.run([pb, '-m', str(VOICES / (v + '.onnx')), '-f', str(out)], input=text.encode('utf-8'), capture_output=True, timeout=120)
        if r.returncode or not out.exists(): raise RuntimeError('Piper: ' + r.stderr.decode('utf-8', 'ignore')[-300:])
        return out.read_bytes(), v

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        if self.path.split('?')[0] != '/api/tts': return self._json(404, {'error': 'not found'})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            text = str(data.get('text', '')).strip()[:2000]
            if not text: return self._json(400, {'error': 'пустой текст'})
            wav, v = synth(text, data.get('voice'))
            self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(wav))); self.send_header('X-Voice', v); self.end_headers(); self.wfile.write(wav)
        except Exception as e:
            self._json(500, {'error': str(e)})
    def do_GET(self):
        if self.path.split('?')[0].rstrip('/') == '/api/voices':
            return self._json(200, {'piper': bool(piper_bin()), 'voices': list_voices()})
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
