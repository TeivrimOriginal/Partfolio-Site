// Выбор адресата: кому из опубликованных компанией контактов можно писать.
//
// Вынесено отдельно от отправки, потому что выбор адресата нужен не только
// при отправке: текст письма должен совпадать с тем, куда оно уйдёт. Если
// письмо писать без знания адресата, а потом выбирать адрес — получается
// письмо, написанное «в никуда», и адрес, выбранный по другой логике.

// Почему эти адреса не адресаты: они не пишут людям о работе.
export const ROLE_BLOCK = [
  'noreply', 'no-reply', 'donotreply', 'no.reply', 'bounce', 'mailer-daemon',
  'postmaster', 'hostmaster', 'abuse', 'unsubscribe', 'feedback', 'hrfeedback',
  'sales', 'admin', 'billing', 'buh', 'accounting', 'secretary', 'robot',
];

// Роль в адресе: такие ящики читает человек, который занимается наймом.
export const ROLE_GOOD = [
  'hr', 'job', 'jobs', 'career', 'careers', 'resume', 'resumes', 'cv',
  'recruit', 'recruiting', 'recruitment', 'talent', 'people', 'staff',
  'trud', 'rabota', 'vakan', 'personal',
];

// Домены площадок: письмо на них уходит не компании. Avito здесь нет
// сознательно: это компания, которая сама размещает вакансии, и её адрес —
// законный адресат. Её служебный ящик отсекается именем (hrfeedback).
export const DOMAIN_BLOCK = [
  'hh.ru', 'hhcdn.ru', 'dreamjob.ru', 'superjob.ru', 'rabota.ru', 'zarplata.ru',
  'indeed.com', 'linkedin.com', 'glassdoor.com', 'job.ru', 'career.ru',
  'fl.ru', 'kwork.ru', 'youdo.com', 'gosuslugi.ru',
];

const hostOf = (url) => {
  try { return new URL(String(url).startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
  catch { return ''; }
};

// -------------------------------------------------- контакты, которые не наши
//
// Страница работодателя на hh — это страница площадки. На ней есть телеграм
// hh (@hh_ru_official), сайт сервиса (setka.ru/communities/…) и служебные
// телефоны. Сборщик брал их тем же кодом, что и настоящие контакты, и в базе
// они выглядели неотличимо:
//
//   okkam  site      https://setka.ru/communities/0194f0a0-…   ← это Setka, не Оккам
//   okkam  telegram  @hh_ru_official                            ← это аккаунт hh
//
// Письмо «в компанию Оккам», отправленное в аккаунт hh, — это не рассылка, а
// публичное сообщение в чужой канал. Поэтому такие значения не контакты.
const PLATFORM = [
  /(^|\/\/|@)(www\.)?(hh\.ru|zarechny\.hh\.ru|hhcdn\.ru|setka\.ru|headhunter\.ru|career\.habr\.com)\b/i,
  // Имя аккаунта площадки: «@hh_ru_official», «@hh.ru», «@hhru», «@headhunter».
  // Границы слов здесь не ставятся: в «@hh_ru_official» после «ru» идёт
  // подчёркивание, и \b между «u» и «_» не срабатывает — проверка на
  // границе молча пропускала бы ровно тот аккаунт, который и фильтруется.
  /^@?hh[._-]?(ru|official|support)/i,
  /^@?headhunter/i,
];

export function isPlatformContact(value, kind) {
  // Ссылка на страницу работодателя на hh — не «контакт площадки, попавший
  // в компанию», а честно помеченный канал: отклик через эту страницу
  // доходит до рекрутера. Фильтр по значению снёс бы 127 таких строк вместе
  // с мусором, поэтому тип смотрит первым.
  if (String(kind || '') === 'hh_employer') return false;
  const v = String(value || '');
  return PLATFORM.some((re) => re.test(v));
}

/**
 * Выбор адресата из опубликованных контактов компании.
 *
 * Порядок предпочтения: адрес в домене сайта компании (почти наверняка её
 * собственный), потом ящик человека, который занимается наймом, потом общий
 * ящик компании. `shared` — адреса, помеченные как общие для нескольких
 * компаний (ящик агрегатора, см. sharedEmails в db.mjs).
 *
 * Возвращает {value, kind, why} либо {blocked: причина}: молчаливый отказ
 * неотличим от «адресов не нашлось», а это разные вещи.
 */
export function pickAddress(contacts, { site = '', shared = new Set() } = {}) {
  const siteHost = hostOf(site);
  // Контакты площадки вычеркнуты ещё раз, даже если они попали в базу до
  // фильтра: выбор адресата не должен зависеть от того, когда чистили базу.
  const emails = (contacts || []).filter((c) => c.kind === 'email' && !isPlatformContact(c.value, c.kind));
  if (!emails.length) return { blocked: 'у компании нет опубликованного адреса' };

  const rejected = [];
  const scored = [];

  for (const c of emails) {
    const addr = String(c.value || '').trim().toLowerCase();
    const [local = '', domain = ''] = addr.split('@');
    if (!local || !domain) { rejected.push(`${addr}: не адрес`); continue; }
    if (shared.has(addr)) { rejected.push(`${addr}: общий адрес у нескольких компаний`); continue; }
    if (DOMAIN_BLOCK.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      rejected.push(`${addr}: домен площадки, а не компании`); continue;
    }
    if (ROLE_BLOCK.some((r) => local === r || local.startsWith(`${r}+`) || local.startsWith(`${r}_`) || local.startsWith(`${r}-`))) {
      rejected.push(`${addr}: служебный ящик`); continue;
    }

    let score = 0;
    const why = [];
    if (siteHost && domain === siteHost) { score += 50; why.push('адрес в домене сайта компании'); }
    else why.push('домен другой или сайт не найден');
    if (ROLE_GOOD.some((r) => local === r || local.startsWith(`${r}-`) || local.startsWith(`${r}_`))) {
      score += 20; why.push('роль в адресе — найм');
    }
    if (/^(info|hello|contact|mail|office|general|company)$/.test(local)) {
      score += 5; why.push('общий ящик компании');
    }
    // Похожий на личный адрес хуже ящика с ролью: отвечает человек, который
    // занимается не этим.
    if (/^[a-z]{1,2}[._-][a-z]{1,2}@/.test(local)) { score -= 5; why.push('похоже на личный адрес'); }
    scored.push({ ...c, value: addr, score, why });
  }

  if (!scored.length) return { blocked: `все найденные адреса отпадают: ${rejected.join('; ')}` };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { ...best, why: `${best.why.join(', ')}${scored.length > 1 ? `, ещё адресов: ${scored.length - 1}` : ''}` };
}

/**
 * Выбор канала, а не только адресата.
 *
 * Почему каналов больше одного: почта у компаний есть у четырнадцати записей
 * из ста восьмидесяти трёх контактов, и двенадцать из них — ящик агрегатора.
 * Система, умеющая отправлять только почтой, на живых данных отправляет
 * двум компаниям, а остальные28 вакансий у неё «нечем отправлять», хотя у
 * каждой есть телеграм, сайт или страница работодателя.
 *
 * Порядок не по «удобству системы», а по тому, где письмо дойдёт:
 *   email  — единственный канал, где вложение доедет само;
 *   hh     — отклик на вакансию на площадке: рекрутер точно его увидит,
 *            а компания ни о чём не узнает из нашего сбора контактов;
 *   telegram / site / phone — остальное, по порядку убывания вероятности
 *            ответа.
 */
export function pickChannel(contacts, { site = '', shared = new Set(), vacancyUrl = '' } = {}) {
  const mine = (contacts || []).filter((c) => !isPlatformContact(c.value, c.kind));
  const email = pickAddress(mine, { site, shared });
  if (!email.blocked) return { channel: 'email', ...email };

  const byKind = (kind) => mine.find((c) => c.kind === kind);
  if (vacancyUrl) {
    return { channel: 'hh', value: vacancyUrl, kind: 'site', why: 'отклик на площадке, где висит вакансия' };
  }
  const tg = byKind('telegram');
  if (tg) return { channel: 'telegram', value: tg.value, kind: 'telegram', why: 'телеграм, который компания публикует сама' };
  const s = byKind('site');
  if (s) return { channel: 'site', value: s.value, kind: 'site', why: 'форма или почта на сайте компании' };
  const ph = byKind('phone');
  if (ph) return { channel: 'phone', value: ph.value, kind: 'phone', why: 'телефон, опубликованный компанией' };
  return { blocked: email.blocked };
}

export { hostOf };
