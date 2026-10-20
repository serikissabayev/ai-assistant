#!/usr/bin/env python3
"""Локальное распознавание речи (Whisper) для модуля «Слух»: OpenAI-совместимый API.

  python tools/whisper_server.py            # http://localhost:8000/v1
Переменные: WHISPER_MODEL (small | medium | large-v3 | large-v3-turbo, по умолчанию small),
            WHISPER_PORT (8000), WHISPER_DEVICE (cuda по умолчанию — только видеокарта; cpu — только если явно попросить).
Казахский (kk), русский (ru) и английский (en) Whisper понимает; для казахского лучше medium и выше.
"""
import collections, io, json, os, re, sys, threading, traceback
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get('WHISPER_MODEL', 'small')
PORT = int(os.environ.get('WHISPER_PORT', '8000'))
HOST = os.environ.get('WHISPER_HOST', '127.0.0.1')        # 0.0.0.0 — принимать запросы из локальной сети (Whisper на сервере для нескольких ассистентов)
DEVICE = os.environ.get('WHISPER_DEVICE', 'cuda')          # только видеокарта: на процессоре каждая фраза распознаётся секундами
THREADS = int(os.environ.get('WHISPER_THREADS', max(4, (os.cpu_count() or 8) // 2)))     # на процессоре используем много ядер
# подсказка модели: имя ассистента и тематика — меньше «Зайыметсі збер», точнее «Адина»
PROMPTS = {'kk': 'Сәлеметсіз бе. Қазақстандағы ақпараттық технологиялар және жасанды зерде орталығы.', 'ru': 'Здравствуйте. Центр информационных технологий и искусственного интеллекта.', 'en': 'Hello.'}          # имён персонажей здесь нет намеренно
KK_BOOST = float(os.environ.get('WHISPER_KK_BOOST', '4'))      # во сколько раз поднять вероятность казахского при автоопределении
LANGS = [x.strip() for x in os.environ.get('WHISPER_LANGS', 'kk,ru,en').split(',') if x.strip()]      # из каких языков выбирать при автоопределении
STUB = os.environ.get('WHISPER_STUB') == '1'        # для проверки без модели
_lock = threading.Lock(); _model = None
LOG = collections.deque(maxlen=60)                  # последние строки журнала — отдаются в отчёт диагностики (GET /v1/log)
_print = print
def print(*a, **k):  # noqa: A001
    LOG.append(' '.join(str(x) for x in a)); _print(*a, **k)

def add_nvidia_dlls():
    """Если поставлены pip-пакеты nvidia-cublas-cu12 / nvidia-cudnn-cu12 (tools/install_whisper_gpu.bat) — подключаем их DLL."""
    import glob
    for base in {os.path.join(sys.prefix, 'Lib', 'site-packages'), *glob.glob(os.path.join(sys.prefix, 'lib', 'python*', 'site-packages'))}:
        for d in glob.glob(os.path.join(base, 'nvidia', '*', 'bin')) + glob.glob(os.path.join(base, 'nvidia', '*', 'lib')):
            os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')
            if hasattr(os, 'add_dll_directory'):
                try: os.add_dll_directory(d)
                except OSError: pass

def model():
    global _model
    if _model is None:
        add_nvidia_dlls()
        from faster_whisper import WhisperModel
        if DEVICE == 'cuda':
            import ctranslate2
            if ctranslate2.get_cuda_device_count() < 1:
                raise RuntimeError('Видеокарта NVIDIA не найдена для Whisper (нет драйвера/CUDA). Запустите tools\\install_whisper_gpu.bat')
        print(f'Загружаю модель {MODEL} на {"видеокарту (CUDA, float16)" if DEVICE == "cuda" else DEVICE}…', flush=True)
        _model = WhisperModel(MODEL, device=DEVICE, compute_type='float16' if DEVICE == 'cuda' else 'int8', cpu_threads=THREADS)
        print('Модель готова.', flush=True)
    return _model

def warmup():
    """Первый проход на видеокарте медленный (инициализация CUDA) — делаем его сразу, а не на первой фразе пользователя."""
    import numpy as np, time
    t = time.time()
    list(model().transcribe(np.zeros(16000, dtype=np.float32), language='kk', beam_size=1)[0])
    print(f'Прогрев GPU: {time.time() - t:.1f} с', flush=True)

def gpu_error(e):
    return RuntimeError(f'Whisper не может работать на видеокарте: {str(e)[:160]}. Запустите tools\\install_whisper_gpu.bat и перезапустите start_all.bat')

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

KK_RE = re.compile('[әіңғүұқөһӘІҢҒҮҰҚӨҺ]')

def detect_language(audio):
    """Автоопределение среди kk / ru / en (общий детектор Whisper часто путает похожие языки)."""
    if audio is None or len(audio) < 1600: return None
    try:
        _, _, probs = model().detect_language(audio)
        best = max(((p * (KK_BOOST if l == 'kk' else 1), l) for l, p in probs if l in LANGS), default=None)      # казахский Whisper недооценивает — подтягиваем
        return best[1] if best else None
    except Exception as e:
        print('определение языка не удалось:', repr(e)[:120], flush=True); return None

def transcribe(data, language):
    """→ (текст, язык)"""
    if STUB: return 'проверка связи', language or 'kk'
    audio = wav_to_array(data)
    if not language: language = detect_language(audio)
    src = audio if audio is not None else io.BytesIO(data)
    with _lock:
        try:
            segs, _ = model().transcribe(src, language=language or None, vad_filter=True, beam_size=1, condition_on_previous_text=False, initial_prompt=PROMPTS.get(language or ''))
            text = ' '.join(s.text.strip() for s in segs).strip()
        except RuntimeError as e:
            if DEVICE == 'cuda' and any(w in str(e).lower() for w in ('cublas', 'cudnn', 'cuda', 'dll')): raise gpu_error(e)        # на процессор не уходим — только GPU
            raise
        if language != 'kk' and KK_RE.search(text): language = 'kk'          # в тексте казахские буквы — значит казахский
        return text, language

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
        if self.path.rstrip('/').endswith('/log'): return self._send(200, {'model': MODEL, 'device': DEVICE, 'log': list(LOG)})
        if self.path.rstrip('/').endswith('/models'): return self._send(200, {'data': [{'id': MODEL}]})
        self._send(200, {'status': 'ok', 'model': MODEL})
    def do_POST(self):
        if not self.path.split('?')[0].rstrip('/').endswith('/audio/transcriptions'): return self._send(404, {'error': 'not found'})
        try:
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            f = parse_multipart(self.headers.get('Content-Type', ''), body)
            lang = (f.get('language') or b'').decode() or None
            text, lang = transcribe(f['file'], lang)
            print(f'[{lang}] {text}', flush=True)
            self._send(200, {'text': text, 'language': lang})
        except Exception as e:
            LOG.append(traceback.format_exc()[-600:]); traceback.print_exc(); print('ОШИБКА:', repr(e), flush=True); self._send(500, {'error': f'{type(e).__name__}: {e}'[:300]})

if __name__ == '__main__':
    if not STUB:
        try: model(); warmup()
        except ImportError: sys.exit('Нет faster-whisper. Установите: tools/install_whisper.bat (Windows) или pip install faster-whisper')
        except Exception as e:
            print('ОШИБКА:', gpu_error(e), flush=True)
            sys.exit(1)
    if HOST in ('0.0.0.0', '::'):
        import socket
        try:                                           # адрес в локальной сети (пакет никуда не уходит — только выбор интерфейса)
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as so: so.connect(('10.255.255.255', 1)); ip = so.getsockname()[0]
        except Exception: ip = 'IP-этого-сервера'
        print(f'Whisper для локальной сети → http://{ip}:{PORT}/v1   (на ассистентах: tools/set_stt_url — этот адрес; порт {PORT} откройте в брандмауэре)', flush=True)
    print(f'Whisper → http://localhost:{PORT}/v1   (Ctrl+C — остановить)', flush=True)
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
