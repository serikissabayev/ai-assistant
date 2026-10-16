// Стенд аватара: проверка «разъёмов» лица без микрофона/камеры/TTS.
// Здесь же видно, как модули будут им управлять: только через ctx.avatar.
export default function create() {
  let timeline = null;

  return {
    async start(ctx) {
      const av = ctx.avatar, h = ctx.ui.h;

      const speak = (text) => {
        const { events, duration } = ctx.util.lipsync.textToVisemes(text, { speed: 1 });
        timeline = { events, duration, t0: performance.now() / 1000, i: 0, text };
        av.setSpeaking(1);
        ctx.ui.setCaption(text, { role: 'assistant', hold: 0 });
      };

      ctx.onFrame((_, t) => {
        if (!timeline) return;
        const el = t - timeline.t0;
        if (el > timeline.duration + 0.15) {
          av.endSpeech(); timeline = null; ctx.ui.setCaption('', {}); return;
        }
        const ev = timeline.events.find((e) => el >= e.at && el < e.at + e.dur);
        if (ev) av.setViseme(ev.v, (ev.weight ?? 1) * 0.95);
        else av.setVisemes({});
      });

      ctx.ui.addPanel({
        tab: 'avatar', title: 'Стенд аватара',
        render(el) {
          const btn = (label, fn, cls = '') => h('button', { class: `btn sm ${cls}`, onclick: fn }, label);
          const emo = ['neutral', 'happy', 'surprised', 'sad', 'thinking'];
          const emoNames = { neutral: 'Спокойно', happy: 'Радость', surprised: 'Удивление', sad: 'Грусть', thinking: 'Думает' };

          const pad = h('div', { class: 'pad' }, h('i', {}));
          const dot = pad.firstChild;
          const aim = (e) => {
            const r = pad.getBoundingClientRect();
            const x = Math.min(Math.max(((e.clientX - r.left) / r.width) * 2 - 1, -1), 1);
            const y = Math.min(Math.max(1 - ((e.clientY - r.top) / r.height) * 2, -1), 1);
            dot.style.left = `${(x + 1) * 50}%`; dot.style.top = `${(1 - y) * 50}%`;
            av.lookAtNormalized(x, y);
          };
          pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); aim(e); pad.onpointermove = aim; });
          pad.addEventListener('pointerup', () => { pad.onpointermove = null; });

          const input = h('input', { class: 'text-input', value: 'Сәлеметсіз бе! Добро пожаловать в наш IT-хаб. Чем могу помочь?' });
          el.append(
            h('div', { class: 'row-text' }, h('b', {}, 'Эмоция')),
            h('div', { class: 'chiprow' }, emo.map((e) => btn(emoNames[e], () => av.setEmotion(e)))),
            h('div', { class: 'row-text' }, h('b', {}, 'Взгляд'), h('small', {}, 'Ведите по полю — глаза идут первыми, голова следом')),
            pad,
            h('div', { class: 'chiprow' }, btn('Отпустить взгляд', () => { av.releaseLook(); dot.style.left = dot.style.top = '50%'; })),
            h('div', { class: 'row-text' }, h('b', {}, 'Жесты')),
            h('div', { class: 'chiprow' }, ['nod', 'shake', 'tilt', 'blink', 'wave', 'like', 'peace'].map((g) => btn({ nod: 'Кивок', shake: 'Нет', tilt: 'Наклон', blink: 'Моргнуть', wave: 'Помахать', like: 'Лайк', peace: 'Peace' }[g], () => av.trigger(g)))),
            h('div', { class: 'row-text' }, h('b', {}, 'Виземы (форма рта)'), h('small', {}, 'Клик — удерживает 0.6 с')),
            h('div', { class: 'chiprow' }, av.visemeNames.map((v) => btn(v, () => { av.setViseme(v); setTimeout(() => av.setVisemes({}), 600); }))),
            h('div', { class: 'row-text' }, h('b', {}, 'Фраза')),
            h('div', { class: 'say' }, input, btn('Сказать', () => speak(input.value), 'primary')),
          );
        },
      });
      ctx.defer(() => { av.endSpeech(); av.releaseLook(); av.setEmotion('neutral'); });
      ctx.log('стенд аватара подключён');
    },
    async stop() { timeline = null; },
  };
}
