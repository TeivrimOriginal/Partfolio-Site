// Правило «вакансия просит больше опыта, чем есть».
//
// Почему отдельный модуль. За один день это правило пришлось переписать
// четыре раза, и каждый раз находился новый пропуск:
//   1. «от 2х лет» и «от 18 месяцев» проскочили;
//   2. потерялось «от 2–3 лет» с типографской чертой;
//   3. потерялось «от двух лет» и «от одного года» — числа, написанные словами;
//   4. первая версия модуля висела на тексте hh: вложенные \s* с необязательными
//      группами посередине дают экспоненциальный бэктрекинг, а в описаниях
//      вакансий длинные пробелы есть всегда.
// Здесь оно одно, линейное, покрыто тестом на настоящих фразах hh и может
// быть прогнано по всему шорт-листу целиком.
//
// ВАЖНО, если правишь регулярки: никаких вложенных \s*. Только [ \t]* и \d+.
// Иначе вместо «не поймал вакансию» получишь «виснет на третьей вакансии».
//
// Порог: у него нет ни одного оплачиваемого рабочего дня. Поэтому любой
// явно названный минимум от 12 месяцев — это пункт, который он не закроет.
// «от 6 месяцев» пропускаем: полгода учебных проектов он предъявить может.

const MONTHS_WORD = {
  'одного': 1, 'одну': 1, 'один': 1, 'полгода': 6, 'шести': 6, 'шесть': 6,
  'двенадцати': 12, 'двенадцать': 12,
  'шестнадцати': 16, 'восемнадцати': 18, 'восемнадцать': 18, 'двадцати': 20,
};

const YEARS_WORD = {
  'один': 1, 'одного': 1, 'одну': 1, 'два': 2, 'двух': 2, 'два-три': 2,
  'три': 3, 'трех': 3, 'трёх': 3, 'четыре': 4, 'четырех': 4, 'четырёх': 4,
  'пять': 5, 'пяти': 5, 'шесть': 6, 'полутора': 1.5,
};

// Числительные приведены к одному виду. После группы может стоять «х» или «-х»
// («от 2х лет», «от 2-х лет»), а дальше диапазон: «от 1–3 лет», «от 1,5 лет»,
// «от 1 до 3 лет».
const NUM = String.raw`(\d+|один|одного|одну|два|двух|два-три|три|трех|трёх|четыре|четырех|четырёх|пять|пяти|шесть|полутора)`;
const NUM_MID = String.raw`[ \t]*(?:[-–—][ \t]*)?(?:х[ \t]*)?`;
const NUM_TAIL = String.raw`(?:(?:до[ \t]*)?(?:[-–—,][ \t]*)?\d+(?:[ \t]*(?:до[ \t]*|[-–—][ \t]*)\d+)?)?`;

// Границы слов — НЕ \b и НЕ \w. В JavaScript и \w, и \b работают только по
// ASCII, кириллица к word-символам не относится. Из-за этого:
//   \bот не срабатывает нигде — и перед словом, и внутри «работы» границы
//   нет, потому что с обеих сторон не word-символы;
//   «коммерческ\w*» обрывается на «коммерческ» и не доходит до
//   «ических предложений», поэтому разрешённый случай не срабатывал.
// Обе ошибки найдены на реальных фразах hh и обе молча давали неверный ответ.
// Границы задаются руками, как уже сделано в hh-target.js.
const L = '(?<![а-яёa-z0-9])';
const R = '(?![а-яёa-z0-9])';
const LETTERS = '[а-яёa-z0-9]';

// «от N лет», «от 2х лет», «от 1–3 лет», «от 1,5 лет», «от 1 до 3 лет».
const RE_YEARS = new RegExp(L + String.raw`от[ \t]*` + NUM + NUM_MID + NUM_TAIL + String.raw`[ \t]*(?:лет|года|год)` + R, 'gi');
// «от N месяцев», «от восемнадцати месяцев».
const RE_MONTHS = new RegExp(L + String.raw`от[ \t]*(\d+|один|одного|полгода|шести|шесть|двенадцати|двенадцать|шестнадцати|восемнадцати|восемнадцать|двадцати)[ \t]*месяц` + LETTERS + '*', 'gi');
// «более 1 года», «не менее 2 лет».
const RE_MORE = new RegExp(L + String.raw`(?:более|больше|минимум|не[ \t]менее)[ \t]*(\d+)[ \t]*(?:лет|года|год|месяц` + LETTERS + `*)`, 'gi');
// «1–3 года опыта», «2 года опыта» — без предлога «от».
const RE_RANGE = /(\d+)[ \t]*(?:-|–|—)[ \t]*(\d+)[ \t]*(?:лет|года|год)?[ \t]*опыта/gi;
const RE_SINGLE = /(\d+)[ \t]*(?:лет|года|год)[ \t]*опыта/gi;

const RE_MIDDLE = /middle-?разработчик|уровн[ея]+\s*middle|senior-?разработчик|senior[ \t]/i;
// «хочет вырасти до уровня Middle» — это перспектива роста, а не требование.
const RE_MIDDLE_ALLOWED = /выраст|расти|дораст|перспектив|дойти до|стать |перейти на/i;
const RE_EDU = new RegExp('высшее[ \\t]+образован', 'i');
// «коммерческ» ловим только рядом со словом про опыт или работу. Иначе под
// правило попадают «коммерческие боты, црм-ки, сайты» — это продукт,
// приносящий деньги, а не требование опыта.
const RE_COMMERCIAL = new RegExp('коммерческ[ \\t]*' + LETTERS + '*[ \\t]+(?:опыт|разработк|работ)', 'gi');
// «коммерческие предложения» — это про продукт, а не про опыт.
const RE_COMMERCIAL_ALLOWED = new RegExp('коммерческ' + LETTERS + '*[ \\t]+(?:предложен|выручк|сделк|заказчик|услов)', 'i');
// «pet-проекты … коммерческий опыт также подойдут» — прямое разрешение.
const RE_ACCEPTS_PET = new RegExp('pet-?проект|учебн' + LETTERS + '+|портфолио', 'i');
// «Подойдёт кандидат без коммерческого опыта» и «возможность получить
// коммерческий опыт» — это отсутствие требования или обещание, а не требование.
const RE_COMMERCIAL_NEGATED = /(?:без|получит|получить|набрать|отсутств|не[ \t]требу)[ \t]*$/i;

// Требование опыта без числа. «Мы ожидаем опыт работы с Ansible», «требуется
// опыт в Linux» — числа здесь нет, поэтому monthsFloor такое не видит, а отклик
// уходит к тому, у кого этого опыта нет.
//
// Осторожность в трёх местах. Первое: на агрегаторах есть служебная подпись
// «Требуемый опыт работы: Не указан», и она означает ровно обратное — опыт не
// нужен. С словом «требуемый» в триггерах правило сработало бы на 44 вакансии
// из 48, то есть почти на всю выдачу. Поэтому «требуемый» убран, а «не указан»
// добавлен в разрешённые слова как страховка. Второе: «Будет плюсом опыт
// работы с X» — пожелание, а не требование. Третье: «опыт не требуется»
// содержит то же слово «требуется», поэтому отрицание проверяется по тексту
// ПЕРЕД совпадением, как и в правиле про коммерческий опыт.
const RE_EXPERIENCE_STATED = new RegExp(
  '(?:ожидаем|ожидается|ожидающий|требуем|требуется|необходим|необходимо|нужен|нужна|обязател' + LETTERS + '*' + LETTERS + '{0,3})' +
  '[^.]{0,40}?[ \\t]*опыт',
  'gi'
);
// «Будет плюсом опыт», «опыт приветствуется», «опыт не обязателен», а также
// служебное «Требуемый опыт работы: Не указан».
const RE_EXPERIENCE_ALLOWED = new RegExp(
  'плюс|желател|приветств|по[ \\t]желани|будет[ \\t]+хорошо|будет[ \\t]+плюсом|не[ \\t]+требу|не[ \\t]+обязател|не[ \\t]?указан|без[ \\t]+опыта|можно[ \\t]+без|опыт[ \\t]+не[ \\t]+нуж',
  'i'
);
// Отрицание перед совпадением: «не требуется опыт», «не нужен опыт».
const RE_EXPERIENCE_NEGATED = /(?:не|без)[ \t]*$/i;

function num(word) {
  if (word == null) return NaN;
  const w = String(word).toLowerCase().trim();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  if (Object.prototype.hasOwnProperty.call(MONTHS_WORD, w)) return MONTHS_WORD[w];
  if (Object.prototype.hasOwnProperty.call(YEARS_WORD, w)) return YEARS_WORD[w];
  return NaN;
}

function monthsOfYearToken(token) {
  const n = num(token);
  if (n !== n) return NaN;
  return n * 12;
}

// Минимальный опыт в месяцах, явно названный в тексте. 0 — не назван.
function monthsFloor(text) {
  let best = 0;
  let m;
  const n = (v) => { const x = v === undefined ? NaN : v; return x === x ? x : 0; };
  RE_YEARS.lastIndex = 0;
  while ((m = RE_YEARS.exec(text)) !== null) best = Math.max(best, monthsOfYearToken(m[1]));
  RE_MONTHS.lastIndex = 0;
  while ((m = RE_MONTHS.exec(text)) !== null) best = Math.max(best, n(num(m[1])));
  RE_MORE.lastIndex = 0;
  while ((m = RE_MORE.exec(text)) !== null) {
    // «Мы на рынке уже более 10 лет» и «компания работает более 30 лет» —
    // это возраст компании, а не требование опыта. Отличается тем, что после
    // этих чисел нет слова про опыт. Без проверки отсеивались вакансии
    // Эдди Сервис и Агротек, у которых ни одного реального порога не было.
    const after = text.slice(m.index, m.index + m[0].length + 60);
    if (!/опыт|работ|разработ|стаж|коммерческ/i.test(after)) continue;
    best = Math.max(best, /месяц/i.test(m[0]) ? n(parseInt(m[1], 10)) : n(parseInt(m[1], 10) * 12));
  }
  RE_RANGE.lastIndex = 0;
  while ((m = RE_RANGE.exec(text)) !== null) best = Math.max(best, parseInt(m[1], 10) * 12);
  RE_SINGLE.lastIndex = 0;
  while ((m = RE_SINGLE.exec(text)) !== null) best = Math.max(best, parseInt(m[1], 10) * 12);
  return best;
}

function around(t, index, size) {
  const w = size || 180;
  return t.slice(Math.max(0, index - 60), Math.min(t.length, index + w));
}

// Причина отказа по тексту описания. null — отказа нет.
function reasonIn(text) {
  const t = String(text == null ? '' : text);

  const edu = RE_EDU.exec(t);
  if (edu) return { rule: 'education', matched: edu[0], context: around(t, edu.index, edu[0].length) };

  // «уровень Middle» встречается и в требовании, и в перспективе роста:
  // «Знания на уровне middle-разработчика» против «вырасти до уровня Middle».
  // Различаем по глаголу в окне, а не по самим словам.
  const mid = RE_MIDDLE.exec(t);
  if (mid) {
    const win = around(t, mid.index, 240);
    if (!RE_MIDDLE_ALLOWED.test(win)) return { rule: 'level', matched: mid[0], context: win };
  }

  // «Коммерческий опыт»: ловится только рядом со словом про опыт или работу.
  // Отдельно пропускаем случаи, где требования нет вовсе: «без коммерческого
  // опыта» и «возможность получить коммерческий опыт».
  let cm;
  RE_COMMERCIAL.lastIndex = 0;
  while ((cm = RE_COMMERCIAL.exec(t)) !== null) {
    const before = t.slice(Math.max(0, cm.index - 40), cm.index);
    if (RE_COMMERCIAL_NEGATED.test(before)) continue;
    const win = around(t, cm.index, 240);
    if (RE_COMMERCIAL_ALLOWED.test(win)) continue;
    if (RE_ACCEPTS_PET.test(win)) continue;
    return { rule: 'commercial', matched: cm[0], context: win };
  }

  // Явное требование опыта без числового порога. Проверяется после вакансий с
  // числами, но до них: у вакансии «ожидаем опыт работы с Ansible, от двух лет»
  // важнее сообщить о числе — так понятнее, что именно не подходит.
  let es;
  RE_EXPERIENCE_STATED.lastIndex = 0;
  while ((es = RE_EXPERIENCE_STATED.exec(t)) !== null) {
    const before = t.slice(Math.max(0, es.index - 40), es.index);
    if (RE_EXPERIENCE_NEGATED.test(before)) continue;
    const win = around(t, es.index, 240);
    if (RE_EXPERIENCE_ALLOWED.test(win)) continue;
    return { rule: 'experience-stated', matched: es[0], context: win };
  }

  const months = monthsFloor(t);
  if (months >= MONTH_THRESHOLD) {
    const first = new RegExp(RE_YEARS.source, 'i').exec(t) || new RegExp(RE_RANGE.source, 'i').exec(t) || new RegExp(RE_MONTHS.source, 'i').exec(t) || new RegExp(RE_MORE.source, 'i').exec(t);
    return {
      rule: 'floor',
      months: months,
      matched: first ? first[0] : months + ' мес',
      context: first ? around(t, first.index, first[0].length) : '',
    };
  }
  return null;
}

const MONTH_THRESHOLD = 12;

module.exports = {
  MONTH_THRESHOLD: MONTH_THRESHOLD,
  monthsFloor: monthsFloor,
  reasonIn: reasonIn,
  tooExperienced: function (text) {
    return reasonIn(text) !== null;
  },
};