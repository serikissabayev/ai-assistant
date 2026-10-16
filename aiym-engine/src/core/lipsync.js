// Грубая синхронизация губ по тексту (ru / kk / en). Запасной вариант для модуля речи,
// пока нет фонемных меток от TTS. Возвращает [{ v: 'aa', at: секунды, dur: секунды }].
const MAP = {
  aa: 'аяaäә', E: 'эеeє', I: 'иыіiйy', O: 'оёoө', U: 'уюuүұw',
  MBP: 'мбпmbp', FV: 'фвfv', SS: 'сзшщжчцхsz',
};
const LOOKUP = new Map();
for (const [viseme, letters] of Object.entries(MAP)) for (const ch of letters) LOOKUP.set(ch, viseme);
const VOWELS = new Set(['aa', 'E', 'I', 'O', 'U']);

export function textToVisemes(text, { speed = 1 } = {}) {
  const out = [];
  let t = 0;
  for (const raw of text.toLowerCase()) {
    if (/[\s,.;:!?…—-]/.test(raw)) {
      const pause = /[,;:]/.test(raw) ? 0.14 : /[.!?…]/.test(raw) ? 0.28 : 0.05;
      out.push({ v: 'sil', at: t, dur: pause / speed });
      t += pause / speed;
      continue;
    }
    const v = LOOKUP.get(raw) ?? 'E';
    const dur = (VOWELS.has(v) ? 0.115 : v === 'E' && !LOOKUP.has(raw) ? 0.06 : 0.075) / speed;
    out.push({ v, at: t, dur, weight: v === 'E' && !LOOKUP.has(raw) ? 0.35 : 1 });
    t += dur;
  }
  return { events: out, duration: t };
}
