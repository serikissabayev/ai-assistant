// Имена персонажей. У каждого имени — написание под каждый язык, чтобы голос произносил его правильно.
// «display» — как имя показано в интерфейсе (его можно менять в настройках).
export const NAME_TABLE = {
  female: { display: 'Адина', kk: 'Әдина', ru: 'Адина', en: 'Adina', aliases: ['адина', 'адына', 'адіна', 'одина', 'одына', 'адена', 'одена', 'идина'] },
  male: { display: 'Нұртуған', kk: 'Нұртуған', ru: 'Нуртуган', en: 'Nurtogee', aliases: ['нуртуган', 'уртуган', 'нуртукан', 'нуртаган', 'нартуган', 'нуртугань', 'нуртогее', 'нуртоги', 'нуртоджи', 'нуртогей'] },
};
export const DEFAULT_DISPLAY = { female: NAME_TABLE.female.display, male: NAME_TABLE.male.display };
export const LEGACY_DISPLAY = ['Айым', 'Адиль'];          // прежние имена по умолчанию — заменяются на новые

const KK = { ә: 'а', і: 'и', ң: 'н', ғ: 'г', ү: 'у', ұ: 'у', қ: 'к', ө: 'о', һ: 'х', ё: 'е', й: 'и', ы: 'и', э: 'е' };
const LAT = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з' };
/** Привести слово к «каркасу»: казахские буквы → русские, латиница → кириллица, без знаков. */
export const norm = (s) => [...String(s).toLowerCase()].map((ch) => KK[ch] ?? LAT[ch] ?? ch).join('').replace(/[^а-я]/g, '');

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/** Все написания имени персонажа (для распознавания обращения и исправления в ответах). */
export function variants(gender, custom) {
  const t = NAME_TABLE[gender] ?? NAME_TABLE.female;
  return [...new Set([t.display, t.kk, t.ru, t.en, ...t.aliases, ...(custom ? [custom] : [])])];      // + типичные искажения — их тоже заменяем в ответах
}

/** Звучит ли в тексте обращение по имени (с допуском на ошибки распознавания). */
export function mentions(text, gender, custom, lead = Infinity) {
  const t = NAME_TABLE[gender];
  const targets = [...new Set([...variants(gender, custom).map(norm), ...(t?.aliases ?? [])])].filter((x) => x.length >= 4);
  const words = String(text).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).slice(0, lead).map(norm).filter(Boolean);      // lead — смотреть только первые N слов (обращение стоит в начале)
  const grams = [...words, ...words.slice(1).map((w, i) => words[i] + w)];      // «нур туган» → «нуртуган»
  return grams.some((g) => targets.some((n) => g === n || (g.length >= 6 && lev(g, n) <= (n.length >= 8 ? 2 : 1))));
}

/** Написание имени для языка ответа (по умолчанию из таблицы; своё имя — как есть). */
export function spoken(gender, display, lang) {
  const t = NAME_TABLE[gender] ?? NAME_TABLE.female;
  return display === t.display || !display ? (t[lang] ?? t.ru) : display;
}

// ───────── «Позови …»: вызов персонажа голосом на казахском, русском и английском ─────────
// Нужен глагол вызова И имя в одной короткой фразе. Просто назвать имя («Нуртуган, как дела?») — не вызов, чтобы смена не срабатывала случайно.
const SUMMON_STEMS = [
  // русский
  'позов', 'позв', 'зови', 'зовите', 'вызов', 'вызв', 'пригласи', 'приглас', 'покаж', 'верни', 'смени', 'замени', 'поменя', 'включи', 'дай', 'давай', 'позвон', 'поговор', 'пообща', 'пусть', 'хочу', 'приход', 'прид', 'выйд', 'выход', 'появ',
  // қазақша
  'шақыр', 'келсін', 'келші', 'шықсын', 'шық', 'көрсет', 'ауыстыр', 'алмастыр', 'сөйлес', 'сөйле', 'қосыңыз', 'қос',
  // English
  'call', 'summon', 'bring', 'get', 'show', 'switch', 'swap', 'change', 'put', 'let', 'talk', 'speak', 'come', 'send', 'invite', 'want',
].map(norm);
const NEG_BEFORE = new Set(['не', 'донт', 'нот', 'невер', 'ненадо', 'нельзя'].map(norm));
const NEG_SUFFIX = ['ма', 'ме', 'ба', 'бе', 'па', 'пе'];

/** Кого зовут голосом: 'female' | 'male' | null. */
export function summons(text, names) {
  const words = String(text).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map(norm).filter(Boolean);
  if (!words.length || words.length > 12) return null;
  let verb = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], st = SUMMON_STEMS.find((s) => w.startsWith(s));
    if (!st) continue;
    const rest = w.slice(st.length);
    if (/^(ма|ме|ба|бе|па|пе)/.test(rest) && w.startsWith(norm('шақыр'))) continue;      // «шақырма» — не зови
    if ([words[i - 1], words[i - 2]].some((p) => p && NEG_BEFORE.has(p))) continue;
    verb = true; break;
  }
  if (!verb) return null;
  const hit = (g) => {
    const stems = [...new Set([...variants(g, names?.[g]).map(norm), ...(NAME_TABLE[g]?.aliases ?? []).map(norm)])].filter((x) => x.length >= 4);
    const grams = [...words, ...words.slice(1).map((w, i) => (words[i].length <= 3 ? words[i] + w : ''))];      // «нур туган», «әді наны»: склеиваем, только если первая часть — обрывок
    return grams.findIndex((w) => stems.some((n) => (w.length >= n.length && w.length <= n.length + 3 && w.startsWith(n.length <= 5 ? n.slice(0, -1) : n.slice(0, -2))) || (w.length >= 5 && w.length <= n.length + 3 && lev(w.slice(0, n.length), n) <= (n.length >= 7 ? 2 : 1))));
  };
  const f = hit('female'), m = hit('male');
  if (f < 0 && m < 0) return null;
  return f < 0 ? 'male' : m < 0 ? 'female' : f < m ? 'female' : 'male';
}
