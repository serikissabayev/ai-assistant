#!/usr/bin/env python3
"""Постоянный процесс Piper: голос загружается один раз, дальше фразы синтезируются быстро.
Запускается из serve.py внутри .venv. Протокол: строка JSON на входе {"model","text","out"} → строка JSON {"ok":true} или {"error":...}.
Текст идёт через JSON (ASCII), поэтому кодировка консоли Windows не портит русские и казахские буквы."""
import json, sys, traceback, wave

out_stream = sys.stdout
sys.stdout = sys.stderr            # любые print() библиотек — в stderr, чтобы не ломать протокол
voices = {}

def load(path):
    if path not in voices:
        from piper import PiperVoice
        voices[path] = PiperVoice.load(path)
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
        say(load(req['model']), req['text'], req['out'], req.get('speaker'))
        resp = {'ok': True}
    except Exception as e:
        resp = {'error': f'{type(e).__name__}: {e}', 'trace': traceback.format_exc()[-500:]}
    out_stream.write(json.dumps(resp) + '\n'); out_stream.flush()
