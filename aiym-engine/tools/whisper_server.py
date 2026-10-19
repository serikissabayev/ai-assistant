#!/usr/bin/env python3
"""Локальное распознавание речи (Whisper) для модуля «Слух»: OpenAI-совместимый API.

  python tools/whisper_server.py            # http://localhost:8000/v1
Переменные: WHISPER_MODEL (small | medium | large-v3 | large-v3-turbo, по умолчанию small),
            WHISPER_PORT (8000), WHISPER_DEVICE (auto | cpu | cuda).
Казахский (kk), русский (ru) и английский (en) Whisper понимает; для казахского лучше medium и выше.
"""
import collections, io, json, os, sys, threading, traceback
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get('WHISPER_MODEL', 'small')
PORT = int(os.environ.get('WHISPER_PORT', '8000'))
DEVICE = os.environ.get('WHISPER_DEVICE', 'auto')
STUB = os.environ.get('WHISPER_STUB') == '1'        # для проверки без модели
_lock = threading.Lock(); _model = None
LOG = collections.deque(maxlen=60)                  # последние строки журнала — отдаются в отчёт диагностики (GET /v1/log)
_print = print
def print(*a, **k):  # noqa: A001
    LOG.append(' '.join(str(x) for x in a)); _print(*a, **k)

def model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print(f'Загружаю модель {MODEL} (первый раз скачивается)…', flush=True)
        _model = WhisperModel(MODEL, device=DEVICE, compute_type='auto')
        print('Модель готова.', flush=True)
    return _model

def wav_to_array(data):
    """WAV (PCM 16 бит) → float32 моно 16 кГц, без PyAV. Не WAV — None (тогда отдаём как есть)."""
    import wave
    import numpy as np
    try:
        with wave.open(io.BytesIO(data)) as w:
            ch, rate, width, raw = w.getnchannels(), w.getframerate(), w.getsampwidth(), w.readframes(w.getnframes())
    except Exception:
        return None
    if width != 2: return None
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1: a = a.reshape(-1, ch).mean(axis=1)
    if rate != 16000 and len(a): a = np.interp(np.linspace(0, len(a) - 1, int(len(a) * 16000 / rate)), np.arange(len(a)), a).astype(np.float32)
    return a

def transcribe(data, language):
    if STUB: return 'проверка связи'
    audio = wav_to_array(data)
    with _lock:
        segs, _ = model().transcribe(audio if audio is not None else io.BytesIO(data), language=language or None, vad_filter=True, beam_size=1, condition_on_previous_text=False)
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
        if self.path.rstrip('/').endswith('/log'): return self._send(200, {'model': MODEL, 'log': list(LOG)})
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
            LOG.append(traceback.format_exc()[-600:]); traceback.print_exc(); print('ОШИБКА:', repr(e), flush=True); self._send(500, {'error': f'{type(e).__name__}: {e}'[:300]})

if __name__ == '__main__':
    if not STUB:
        try: model()
        except ImportError: sys.exit('Нет faster-whisper. Установите: tools/install_whisper.bat (Windows) или pip install faster-whisper')
    print(f'Whisper → http://localhost:{PORT}/v1   (Ctrl+C — остановить)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
