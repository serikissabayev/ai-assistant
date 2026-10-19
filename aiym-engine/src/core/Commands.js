// Голосовые команды-«тормоза»: «стоп», «остановись», «хватит», «тоқта», "stop"… (STOP — замолчать и ничего не отвечать)
// и поправки «не то», «не о том», «олай емес», "that's wrong" (REDIRECT — прервать и уточнить, что нужно).
const KK = { ә: 'а', і: 'и', ң: 'н', ғ: 'г', ү: 'у', ұ: 'у', қ: 'к', ө: 'о', һ: 'х', ё: 'е', й: 'и' };
const clean = (s) => [...String(s).toLowerCase()].map((c) => KK[c] ?? c).join('').replace(/[^a-zа-я\s']/g, ' ').replace(/\s+/g, ' ').trim();

const STOP_WORDS = new Set([
  // русский
  'стоп', 'стой', 'стойте', 'остановись', 'остановитесь', 'остановить', 'хватит', 'довольно', 'достаточно', 'замолчи', 'замолчите', 'помолчи', 'помолчите', 'молчи', 'тихо', 'прекрати', 'прекратите', 'перестань', 'перестаньте', 'отставить', 'отмена',
  // қазақша (после замены ә→а, қ→к …)
  'токта', 'токтат', 'токтан', 'токтаныз', 'токтап', 'болды', 'жеткилики', 'жеткиликти', 'унсиз', 'тыныш', 'айтпа', 'токтатыныз',
  // English
  'stop', 'enough', 'quiet', 'cancel', 'silence', 'halt',
]);
const STOP_PHRASES = ['shut up', 'be quiet', 'that is enough', "that's enough", 'не надо', 'не нужно', 'болды кои', 'кои болды'];
const WEAK = new Set(['кои', 'все', 'всё']);            // «қой», «всё» — только вместе с другим стоп-словом или совсем коротко

// границы слов: \b в JavaScript не понимает кириллицу
const W = (src) => new RegExp(`(?<![а-яa-z'])(?:${src})(?![а-яa-z'])`);
const REDIRECT = [
  // русский
  'не то', 'не о том', 'не об этом', 'не туда', 'не так', 'не в ту', 'ты не по(?:ня|нял|нима)[а-я]*', 'неправильно', 'неверно', 'ерунда', 'бред', 'чушь', 'я не об этом', 'я не это', 'ты ошибаешься', 'не права', 'нет нет', 'нет не', 'не понимаешь',
  // қазақша (после замены ә→а, қ→к …)
  'олаи емес', 'ол емес', 'дурыс емес', 'тусинбеди[а-я]*', 'ол турал[а-я]* емес', 'шатаспа', 'бекер',
  // English
  'not that', "that's wrong", 'that is wrong', 'wrong', "you don't understand", 'not what i', 'no no', 'nonsense',
].map(W);

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const isStopToken = (w) => STOP_WORDS.has(w) || (w.length >= 7 && [...STOP_WORDS].some((s) => s.length >= 7 && lev(w, s) <= 1));     // «остановися», «токтаныз»

/** 'stop' | 'redirect' | null. Короткая реплика со стоп-словом → stop; короткая поправка → redirect. Длинные фразы — обычный вопрос. */
export function commandOf(text) {
  const t = clean(text); if (!t) return null;
  const words = t.split(' ');
  if (words.length <= 5) {
    if (words.some(isStopToken) || STOP_PHRASES.some((p) => t.includes(p))) return 'stop';
    if (words.length <= 2 && words.some((w) => WEAK.has(w))) return 'stop';
  }
  if (words.length <= 9 && REDIRECT.some((re) => re.test(t))) return 'redirect';
  return null;
}

/** Подпись при остановке (без озвучки), с учётом языка и пола. */
export function stopAck(lang, gender) {
  if (lang === 'kk') return 'Тоқтадым.';
  if (lang === 'en') return 'Okay, stopping.';
  return gender === 'male' ? 'Остановился.' : 'Остановилась.';
}
