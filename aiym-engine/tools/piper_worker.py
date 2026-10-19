#!/usr/bin/env python3
"""Постоянный процесс Piper: голос загружается один раз, дальше фразы синтезируются быстро.
Запускается из serve.py внутри .venv. Протокол: строка JSON на входе {"model","text","out"} → строка JSON {"ok":true} или {"error":...}.
Текст идёт через JSON (ASCII), поэтому кодировка консоли Windows не портит русские и казахские буквы."""
import json, sys, traceback, wave

out_stream = sys.stdout
sys.stdout = sys.stderr            # любые print() библиотек — в stderr, чтобы не ломать протокол
voices = {}

def gpu_ready():
    """Голос — на видеокарте: onnxruntime-gpu + библиотеки CUDA из pip-пакетов nvidia-* (tools/install_whisper_gpu.bat)."""
    import glob, os
    for d in glob.glob(os.path.join(sys.prefix, 'Lib', 'site-packages', 'nvidia', '*', 'bin')) + glob.glob(os.path.join(sys.prefix, 'lib', 'python*', 'site-packages', 'nvidia', '*', 'lib')):
        os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')
        if hasattr(os, 'add_dll_directory'):
            try: os.add_dll_directory(d)
            except OSError: pass
    try:
        import onnxruntime as ort
        if hasattr(ort, 'preload_dlls'):
            try: ort.preload_dlls()
            except Exception: pass
        return 'CUDAExecutionProvider' in ort.get_available_providers()
    except Exception:
        return False

GPU = gpu_ready()
print('Piper:', 'видеокарта (CUDA)' if GPU else 'ВНИМАНИЕ: onnxruntime-gpu не найден — голос на процессоре. Запустите tools\\install_whisper_gpu.bat')

def load(path):
    if path not in voices:
        from piper import PiperVoice
        try: voices[path] = PiperVoice.load(path, use_cuda=GPU)
        except TypeError: voices[path] = PiperVoice.load(path)             # очень старый piper без use_cuda
    return voices[path]

def say(voice, text, out, speaker=None):
    with wave.open(out, 'wb') as wf:
        if hasattr(voice, 'synthesize_wav'):                                          # piper-tts 1.3+
            cfg = None
            if speaker is not None:
                try:
                    from piper import SynthesisConfig
                    cfg = SynthesisConfig(speaker_id=int(speaker))                    # номер говорящего у многоголосых моделей
                except Exception: cfg = None
            voice.synthesize_wav(text, wf, syn_config=cfg) if cfg else voice.synthesize_wav(text, wf)
        else: voice.synthesize(text, wf)                                           # старые версии

for line in sys.stdin:
    try:
        req = json.loads(line)
        if req.get('info'):
            out_stream.write(json.dumps({'ok': True, 'gpu': GPU}) + '\n'); out_stream.flush(); continue
        say(load(req['model']), req['text'], req['out'], req.get('speaker'))
        resp = {'ok': True}
    except Exception as e:
        resp = {'error': f'{type(e).__name__}: {e}', 'trace': traceback.format_exc()[-500:]}
    out_stream.write(json.dumps(resp) + '\n'); out_stream.flush()
