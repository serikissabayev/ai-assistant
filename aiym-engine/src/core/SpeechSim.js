// «Немая речь»: пока нет модуля «Речь» (голоса), движок сам двигает губами по тексту,
// чтобы ассистент не молчал «с закрытым ртом». Как только модуль «Речь» включён, этот запасной вариант отключается.
export class SpeechSim {
  #queue = []; #cur = null;

  constructor(engine) {
    this.engine = engine;
    engine.bus.on('speech.say', ({ text }) => {
      if (engine.modules?.entries.get('speech')?.state === 'on') return;      // говорит настоящий модуль
      if (text?.trim()) this.#queue.push(text.trim());
    });
    engine.onFrame((dt, t) => this.#tick(t));
  }

  #tick(t) {
    const { avatar, ui, bus, util } = this.engine;
    if (!this.#cur && this.#queue.length) {
      const text = this.#queue.shift();
      const { events, duration } = util.lipsync.textToVisemes(text);
      this.#cur = { events, duration, t0: t };
      avatar.setSpeaking(1); bus.emit('speech.start', { text, simulated: true });
      ui.setCaption(text, { role: 'assistant', hold: duration + 2 });
    }
    const c = this.#cur; if (!c) return;
    const el = t - c.t0;
    if (el > c.duration + 0.2) { this.#cur = null; avatar.endSpeech(); bus.emit('speech.end', { simulated: true }); return; }
    const ev = c.events.find((e) => el >= e.at && el < e.at + e.dur);
    if (ev && ev.v !== 'sil') avatar.setViseme(ev.v, (ev.weight ?? 1) * 0.95); else avatar.setVisemes({});
  }
}
