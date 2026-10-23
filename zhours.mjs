// Разбор поля «Рабочие часы» hh в число часов.
//
// Формат поля на самом деле такой: «Рабочие часы: 4, 5 или 6»,
// «Рабочие часы: 8, 9, 10, 11 или 12», «Рабочие часы: по договорённости»,
// «Рабочие часы: Вечерние или ночные смены , 12».
//
// Первая версия парсера искала число С СУФФИКСОМ «ч»/«час» и поэтому нашла
// ноль смен по 8 часов и меньше — при том, что в выборке их десятки.
// Правило: сперва отрезать префикс «Рабочие часы:», потом взять все числа
// из остатка, но число 24 трактовать как сутки, а не как смену.
export function parseHours(hours) {
  const raw = String(hours || '').trim();
  if (!raw) return { min: null, max: null, byDuty: false, night: false, raw };
  let s = raw.replace(/^Рабочие часы\s*:\s*/i, '').trim();
  const night = /вечерн|ночн/i.test(s);
  const byDuty = /договор/i.test(s);
  s = s.replace(/[^0-9,.\s-]/g, ' ').trim();
  const nums = (s.match(/\d+/g) || []).map(Number).filter(n => n > 0 && n <= 24);
  const real = nums.filter(n => n !== 24);
  if (!real.length) return { min: null, max: null, byDuty, night, raw, fullDay: nums.includes(24) };
  return { min: Math.min(...real), max: Math.max(...real), byDuty, night, raw, fullDay: nums.includes(24) };
}

// Насколько вакансия совмещается с парами.
// Возвращает метки, которые видно в таблице.
export function studyMarks(v) {
  const text = [v.desc, v.schedule, v.hours, v.employmentType, v.title].filter(Boolean).join(' ');
  const marks = [];
  const h = parseHours(v.hours);
  if (h.max !== null && h.max <= 6) marks.push(`смена до ${h.max} ч`);
  else if (h.max !== null && h.max <= 8) marks.push(`смена ${h.max} ч`);
  if (h.min !== null && h.min <= 6 && (h.max === null || h.max > 8)) marks.push(`есть смена от ${h.min} ч`);
  if (/свободн|гибк|flexible/i.test(text)) marks.push('свободный график');
  if (/частичная|part-time|неполный день/i.test(text)) marks.push('частичная занятость');
  if (/2\/2|через день|сутки/i.test(text)) marks.push('сменный 2/2');
  if (/студент/i.test(text)) marks.push('студент');
  if (/подработк/i.test(text)) marks.push('подработка');
  if (/стаж[её]р|стажировк/i.test(text)) marks.push('стажировка');
  if (/обуч|обучает|наставник|ученик/i.test(text)) marks.push('с обучением');
  if (h.night) marks.push('ночные смены');
  if (h.byDuty) marks.push('часы по договорённости');
  return marks;
}
