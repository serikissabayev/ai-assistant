#!/usr/bin/env python3
"""Локальный сервер без кэша: правки модулей видны сразу после перезагрузки страницы."""
import sys, json, pathlib, os, re, shutil, subprocess, tempfile, threading, urllib.request, urllib.error
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

# Жёсткая привязка голосов: пол персонажа + язык текста → голос.
VOICE_MAP = {
    'female': {'kk': 'kk_KZ-raya-x_low', 'ru': 'ru_RU-irina-medium', 'en': 'en_US-lessac-medium'},
    'male': {'kk': 'kk_KZ-issai-high', 'ru': 'ru_RU-denis-medium', 'en': 'en_US-ryan-medium'},
}

def text_lang(text, hint=None):
    """Язык ответа по тексту: казахские буквы → kk; кириллица → подсказка (kk/ru) или ru; латиница → en."""
    if re.search('[әіңғүұқөһӘІҢҒҮҰҚӨҺ]', text): return 'kk'
    if re.search('[а-яёА-ЯЁ]', text): return hint if hint in ('kk', 'ru') else 'ru'
    if re.search('[A-Za-z]', text): return 'en'
    return hint or 'ru'

def pick_voice(want, text, gender='female', hint=None):
    vs = list_voices()
    if want and want != 'auto' and want in vs: return want                       # явный выбор пользователя
    lang = text_lang(text, hint)
    g = gender if gender in VOICE_MAP else 'female'
    v = VOICE_MAP[g].get(lang)
    if v in vs: return v
    for l in (lang, 'ru', 'kk'):                                                  # нужного файла нет — голос того же пола на другом языке
        if VOICE_MAP[g].get(l) in vs: return VOICE_MAP[g][l]
    cand = [x for x in vs if x.startswith(lang)] or vs
    return cand[0] if cand else None

def piper_python():
    """Python из .venv (там стоит piper-tts) или PIPER_PYTHON."""
    for c in (os.environ.get('PIPER_PYTHON'), str(ROOT / '.venv/Scripts/python.exe'), str(ROOT / '.venv/bin/python')):
        if c and pathlib.Path(c).exists(): return c
    return None

_worker = None
_wlock = threading.Lock()

def _worker_call(req):
    """Один постоянный процесс Piper; при падении перезапускаем один раз."""
    global _worker
    for attempt in (1, 2):
        try:
            if _worker is None or _worker.poll() is not None:
                _worker = subprocess.Popen([piper_python(), str(ROOT / 'tools/piper_worker.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=subprocess.DEVNULL, text=True, encoding='utf-8', bufsize=1)
            _worker.stdin.write(json.dumps(req) + '\n'); _worker.stdin.flush()
            line = _worker.stdout.readline()
            if not line: raise RuntimeError('процесс Piper завершился')
            return json.loads(line)
        except Exception as e:
            try: _worker.kill()
            except Exception: pass
            _worker = None
            if attempt == 2: return {'error': f'Piper не запустился: {e}'}

def synth(text, voice, gender='female', speaker=None, hint=None):
    py, pb = piper_python(), piper_bin()
    if not py and not pb: raise RuntimeError('Piper не установлен: запустите tools/install_piper.bat (Windows) или tools/install_piper.sh')
    v = pick_voice(voice, text, gender, hint)
    if not v: raise RuntimeError('Нет голосов в aiym-engine/voices/ (tools/install_piper)')
    with tempfile.TemporaryDirectory() as d:
        out = pathlib.Path(d) / 'o.wav'
        if py:
            with _wlock: r = _worker_call({'model': str(VOICES / (v + '.onnx')), 'text': text, 'out': str(out), 'speaker': speaker})
            if 'error' in r: raise RuntimeError(f"Piper ({v}): {r['error']} | текст: {text[:60]!r}")
        else:
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
    def _proxy(self):
        """Мини-прокси к серверу модели (если браузер блокирует прямой запрос из-за CORS). Адрес — в заголовке X-Target-Url."""
        url = self.headers.get('X-Target-Url', '')
        if not url.startswith(('http://', 'https://')): return self._json(400, {'error': 'нет X-Target-Url'})
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))) if self.command == 'POST' else None
        req = urllib.request.Request(url, data=body, method=self.command)
        for k in ('Content-Type', 'Authorization'):
            if self.headers.get(k): req.add_header(k, self.headers[k])
        try: resp = urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e: resp = e
        except Exception as e: return self._json(502, {'error': str(e)})
        self.send_response(resp.status if hasattr(resp, 'status') else resp.code)
        self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json')); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        try:
            while True:
                chunk = resp.read1(4096) if hasattr(resp, 'read1') else resp.read(4096)
                if not chunk: break
                self.wfile.write(chunk); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):        # клиент оборвал поток («стоп») — это нормально
            resp.close()
    def do_POST(self):
        if self.path.split('?')[0] == '/api/proxy': return self._proxy()
        if self.path.split('?')[0] != '/api/tts': return self._json(404, {'error': 'not found'})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            text = str(data.get('text', '')).strip()[:2000]
            if not text: return self._json(400, {'error': 'пустой текст'})
            wav, v = synth(text, data.get('voice'), data.get('gender', 'female'), data.get('speaker'), data.get('lang'))
            self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(wav))); self.send_header('X-Voice', v); self.end_headers(); self.wfile.write(wav)
        except Exception as e:
            self._json(500, {'error': str(e)})
    def do_GET(self):
        if self.path.split('?')[0] == '/api/proxy': return self._proxy()
        if self.path.split('?')[0].rstrip('/') == '/api/voices':
            return self._json(200, {'piper': bool(piper_bin() or piper_python()), 'voices': list_voices()})
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
