#!/usr/bin/env python3
"""Локальное распознавание речи (Whisper) для модуля «Слух»: OpenAI-совместимый API.

  python tools/whisper_server.py            # http://localhost:8000/v1
Переменные: WHISPER_MODEL (small | medium | large-v3 | large-v3-turbo, по умолчанию small),
            WHISPER_PORT (8000), WHISPER_DEVICE (auto | cpu | cuda).
Казахский (kk), русский (ru) и английский (en) Whisper понимает; для казахского лучше medium и выше.
"""
import io, json, os, sys, threading
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get('WHISPER_MODEL', 'small')
PORT = int(os.environ.get('WHISPER_PORT', '8000'))
DEVICE = os.environ.get('WHISPER_DEVICE', 'auto')
STUB = os.environ.get('WHISPER_STUB') == '1'        # для проверки без модели
_lock = threading.Lock(); _model = None

def model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print(f'Загружаю модель {MODEL} (первый раз скачивается)…', flush=True)
        _model = WhisperModel(MODEL, device=DEVICE, compute_type='auto')
        print('Модель готова.', flush=True)
    return _model

def transcribe(data, language):
    if STUB: return 'проверка связи'
    with _lock:
        segs, _ = model().transcribe(io.BytesIO(data), language=language or None, vad_filter=True, beam_size=1, condition_on_previous_text=False)
        return ' '.join(s.text.strip() for s in segs).strip()

def parse_multipart(ctype, body):
    msg = BytesParser(policy=email_policy).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
    out = {}
    for part in msg.iter_parts():
        name = part.get_param('name', header='content-disposition')
        out[name] = part.get_payload(decode=True)
    return out

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in (('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Headers', '*'), ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')): self.send_header(k, v)
        self.end_headers()
    def do_GET(self):
        if self.path.rstrip('/').endswith('/models'): return self._send(200, {'data': [{'id': MODEL}]})
        self._send(200, {'status': 'ok', 'model': MODEL})
    def do_POST(self):
        if not self.path.split('?')[0].rstrip('/').endswith('/audio/transcriptions'): return self._send(404, {'error': 'not found'})
        try:
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            f = parse_multipart(self.headers.get('Content-Type', ''), body)
            lang = (f.get('language') or b'').decode() or None
            text = transcribe(f['file'], lang)
            print(f'[{lang}] {text}', flush=True)
            self._send(200, {'text': text})
        except Exception as e:
            print('ОШИБКА:', e, flush=True); self._send(500, {'error': str(e)})

if __name__ == '__main__':
    if not STUB:
        try: model()
        except ImportError: sys.exit('Нет faster-whisper. Установите: tools/install_whisper.bat (Windows) или pip install faster-whisper')
    print(f'Whisper → http://localhost:{PORT}/v1   (Ctrl+C — остановить)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
