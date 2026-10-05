// Слой представления HardSearchWork: читает базу и отдаёт готовые данные для
// вкладок. Окно ничего не знает про SQL — иначе правка запроса означала бы
// правку окна.
//
// Зачем отдельный слой. Окно на WPF собирается кодом (см. UI-APP.md: с XAML
// ошибка разметки видна только при запуске). Значит и данные лучше готовить
// здесь, в обычном JS, где всё проверяется без запуска окна.
//
// Что отдаёт: три набора — отправленные, подготовленные, сводка. Плюс готовый
// расчёт процента для вакансии: ТЗ требует считать его по двум признакам —
// найден ли личный контакт HR и на сколько площадок отправлено по КОНКРЕТНОЙ
// вакансии конкретной компании. Третий признак — соответствие резюме требованиям,
// он берётся из letters.fit, который считает генератор.
//
// Три ошибки, которые закрыты здесь, все из этого же ТЗ:
//   * процент по вакансии, а не по компании: одна компания может держать три
//     вакансии, и «отправлено на 5 сайтов» считается по каждой отдельно;
//   * один и тот же канал дважды не считается за два отправки;
//   * отсутствие отправок — это не 50 процентов, а ноль, иначе пустая вакансия
//     выглядит наполовину успешной.
const { open, DB_FILE } = require('./hsw-db.js');

// Вес признаков в проценте. Сумма 100.
//   личный контакт HR   40  нашли адрес или профиль, по которому можно ответить
//                       конкретному человеку, а не «в компанию вообще»
//   каналы отправки    40  по 10 за каждый сайт; ТЗ требует минимум 5
//   соответствие       20  насколько резюме закрывает требования
const WEIGHT_HR_CONTACT = 40;
const WEIGHT_CHANNELS = 40;
const WEIGHT_FIT = 20;
const CHANNELS_FOR_MAX = 5;

function sentChannels(appRow) {
  return String(appRow.channel || '').trim();
}

/**
 * Процент для вакансии. Возвращает число и список того, из чего оно сложилось,
 * чтобы в окне было видно, почему получилось именно столько.
 *
 * Ключевой момент: считается по вакансии, а не по компании. В ТЗ прямо сказано
 * «КОНКРЕТЕНО ВАКАНСИЮ ОТДЕЛЬНОЙ КОМПАНИИ», и это единственный способ не
 * приписать вакансии отправки в другие вакансии той же компании.
 */
function fitFor(db, vacancyId) {
  const letters = db.prepare('SELECT * FROM letters WHERE vacancy_id = ? ORDER BY fit DESC').all(vacancyId);
  const apps = db.prepare('SELECT * FROM applications WHERE vacancy_id = ? AND ok = 1').all(vacancyId);
  const contacts = db
    .prepare('SELECT COUNT(*) c FROM contacts WHERE company_id = (SELECT company_id FROM vacancies WHERE id = ?) AND is_public = 1')
    .get(vacancyId);
  // 40 баллов даёт только адрес, который компания публикует ДЛЯ ОТКЛИКА по
  // вакансии: role='hr' (job@, hr@, careers@).
  //
  // Почему не любой публичный контакт. Первая версия считала hasHr как «есть хоть
  // один публичный контакт» и подписывала это «контакт HR». Измеренная разница:
  // у EvaTeam опубликован только sales@evateam.ru, и такая компания получала 40
  // баллов за адрес отдела продаж. В окне это выглядело бы как наличие шанса
  // там, где его нет, то есть враньё в самой цифре.
  //
  // Что при этом теряется. Личные контакты сотрудников не публикуются нигде:
  // проверено на странице работодателя hh, публичного делового телефона там нет
  // вовсе. Поэтому 40 баллов получает одна компания из семи — это правда о
  // компаниях, а не о неработающей проверке.
  const forHr = db
    .prepare("SELECT COUNT(*) c FROM contacts WHERE company_id = (SELECT company_id FROM vacancies WHERE id = ?) AND is_public = 1 AND role = 'hr'")
    .get(vacancyId);

  const letter = letters[0] || null;

  // Каналы считаются как множество: два отклика на hh и на Хабре — это разные
  // сайты, а два письма на одну почту — это один канал, не два.
  const channels = new Set();
  for (const a of apps) {
    const ch = sentChannels(a);
    if (ch) channels.add(ch.toLowerCase());
  }
  const channelCount = channels.size;

  const hasHr = forHr.c > 0;
  const channelPart = Math.min(channelCount, CHANNELS_FOR_MAX) * (WEIGHT_CHANNELS / CHANNELS_FOR_MAX);
  const fitPart = letter ? (Math.max(0, Math.min(100, letter.fit)) * WEIGHT_FIT) / 100 : 0;

  const percent = Math.round(
    (hasHr ? WEIGHT_HR_CONTACT : 0) + channelPart + fitPart
  );

  // Причина для контакта. Три состояния, а не два: «адрес для отклика есть»,
  // «контакт есть, но не для отклика» и «контактов нет». Среднее состояние
  // важно, иначе по компании с опубликованным sales@ непонятно, искать дальше
  // или уже некуда.
  const hrWhy = hasHr
    ? 'адрес для отклика есть (' + forHr.c + ') — ' + WEIGHT_HR_CONTACT + ' из ' + WEIGHT_HR_CONTACT
    : contacts.c > 0
      ? 'контактов ' + contacts.c + ', но нет адреса для отклика — 0 из ' + WEIGHT_HR_CONTACT
      : 'контактов нет — 0 из ' + WEIGHT_HR_CONTACT;

  return {
    percent: percent,
    hasHrContact: hasHr,
    contactsFound: contacts.c,
    hrContactsFound: forHr.c,
    channels: [...channels],
    channelCount: channelCount,
    letterFit: letter ? letter.fit : null,
    letterState: letter ? letter.state : null,
    why: [
      hrWhy,
      channelCount + ' из ' + CHANNELS_FOR_MAX + ' сайтов — ' + Math.round(channelPart) + ' из ' + WEIGHT_CHANNELS,
      letter ? 'резюме подходит на ' + letter.fit + '% — ' + Math.round(fitPart) + ' из ' + WEIGHT_FIT : 'письма нет — 0 из ' + WEIGHT_FIT,
    ],
  };
}

function sentTab(db) {
  const rows = db
    .prepare(
      'SELECT a.*, v.title AS vacancy_title, v.url AS vacancy_url, v.site AS vacancy_site, ' +
      'v.stack, c.name AS company_name ' +
      'FROM applications a ' +
      'LEFT JOIN vacancies v ON v.id = a.vacancy_id ' +
      'LEFT JOIN companies c ON c.id = a.company_id ' +
      'ORDER BY (a.sent_at IS NULL), a.sent_at DESC, a.id DESC'
    )
    .all();

  return rows.map((r) => {
    // Детализация по вакансии: процент и из чего он сложился. Считается один раз
    // на вакансию, а не на строку, чтобы при пяти отправках показывалось одно и то
    // же число, а не разное.
    const f = r.vacancy_id ? fitFor(db, r.vacancy_id) : null;
    return {
      id: r.id,
      sentAt: r.sent_at,
      ok: !!r.ok,
      site: r.site,
      channel: r.channel,
      target: r.target,
      subject: r.subject,
      proof: r.proof,
      error: r.error,
      vacancyId: r.vacancy_id,
      vacancyTitle: r.vacancy_title,
      vacancyUrl: r.vacancy_url,
      stack: r.stack,
      company: r.company_name || '',
      percent: f ? f.percent : null,
      percentWhy: f ? f.why : [],
      contactsFound: f ? f.contactsFound : 0,
      channels: f ? f.channels : [],
    };
  });
}

function preparingTab(db) {
  const rows = db
    .prepare(
      'SELECT l.*, v.title AS vacancy_title, v.url AS vacancy_url, v.site AS vacancy_site, ' +
      'v.stack, v.company_raw, c.name AS company_name, c.id AS cid ' +
      'FROM letters l ' +
      'LEFT JOIN vacancies v ON v.id = l.vacancy_id ' +
      'LEFT JOIN companies c ON c.id = v.company_id ' +
      'WHERE l.state IN (\'draft\', \'ready\') ' +
      'ORDER BY l.fit DESC, l.created_at DESC'
    )
    .all();

  return rows.map((r) => {
    // Два счётчика по той же причине, что и в fitFor: всего контактов и
    // адресов для отклика. «Контактов 3» и «адрес для отклика есть» — разные
    // вещи, и в строке видно только второе.
    const contacts = r.cid
      ? db.prepare('SELECT COUNT(*) c FROM contacts WHERE company_id = ? AND is_public = 1').get(r.cid).c
      : 0;
    const hrContacts = r.cid
      ? db.prepare("SELECT COUNT(*) c FROM contacts WHERE company_id = ? AND is_public = 1 AND role = 'hr'").get(r.cid).c
      : 0;
    const already = r.vacancy_id
      ? db.prepare('SELECT COUNT(*) c FROM applications WHERE vacancy_id = ? AND ok = 1').get(r.vacancy_id).c
      : 0;
    return {
      id: r.id,
      state: r.state,
      fit: l_fit(r),
      letterFit: r.fit,
      letterLength: r.length,
      subject: r.subject,
      body: r.body,
      channel: r.channel,
      vacancyId: r.vacancy_id,
      vacancyTitle: r.vacancy_title,
      vacancyUrl: r.vacancy_url,
      site: r.vacancy_site,
      stack: r.stack,
      company: r.company_name || r.company_raw || '',
      contactsFound: contacts,
      hrContactsFound: hrContacts,
      alreadySent: already,
      createdAt: r.created_at,
    };
  });
}

// Прогноз для «подготавливаются»: тот же процент, но без отправок, потому что
// отправок ещё нет. Ноль отправок — это ноль, а не половина.
function l_fit(letter) {
  if (!letter || letter.fit == null) return 0;
  return letter.fit;
}

function summary(db) {
  const sent = db.prepare('SELECT count(*) c FROM applications WHERE ok = 1').get().c;
  const prepared = db.prepare("SELECT count(*) c FROM letters WHERE state IN ('draft','ready')").get().c;
  const leaks = db.prepare('SELECT count(*) c FROM leaks').get().c;
  const vacancies = db.prepare('SELECT count(*) c FROM vacancies WHERE is_open = 1').get().c;
  const companies = db.prepare('SELECT count(*) c FROM companies').get().c;
  const contacts = db.prepare('SELECT count(*) c FROM contacts').get().c;
  const collected = db.prepare('SELECT count(*) c FROM companies WHERE fully_collected = 1').get().c;
  const sessions = db.prepare('SELECT count(*) c FROM sessions WHERE logged_in = 1').get().c;
  const sessionsAll = db.prepare('SELECT count(*) c FROM sessions').get().c;
  const mail = db.prepare('SELECT count(*) c FROM mailboxes WHERE usable = 1').get().c;
  const mailAll = db.prepare('SELECT count(*) c FROM mailboxes').get().c;

  // Средний процент по отправленным: медиана, а не среднее. Среднее завышается
  // одной удачной вакансией, а медиана показывает типичную.
  const percs = sentTab(db)
    .filter((r) => r.percent != null)
    .map((r) => r.percent)
    .sort((a, b) => a - b);
  const median = percs.length ? percs[Math.floor(percs.length / 2)] : null;

  return {
    sent: sent,
    prepared: prepared,
    leaks: leaks,
    vacancies: vacancies,
    companies: companies,
    companiesCollected: collected,
    contacts: contacts,
    sessionsLoggedIn: sessions,
    sessionsChecked: sessionsAll,
    mailUsable: mail,
    mailTotal: mailAll,
    medianPercent: median,
  };
}

function sessionsTab(db) {
  return db.prepare('SELECT * FROM sessions ORDER BY site').all().map((s) => {
    let names = [];
    try { names = JSON.parse(s.cookie_names || '[]'); } catch (e) { names = []; }
    return {
      site: s.site,
      loggedIn: !!s.logged_in,
      account: s.account || '',
      checkedAt: s.checked_at,
      cookies: names,
      how: s.check_how || '',
      tabId: s.tab_id || '',
    };
  });
}

function mailTab(db) {
  return db.prepare('SELECT * FROM mailboxes ORDER BY name').all().map((m) => ({
    name: m.name,
    user: m.user,
    host: m.host,
    port: m.port,
    dailyLimit: m.daily_limit,
    displayName: m.display_name,
    passEnv: m.pass_env,
    // usable в базе означает, что переменная была задана в момент проверки. Здесь
    // проверяется заново: пароль могли сменить после инициализации, и вкладка
    // обязана показывать текущее состояние, а не состояние на момент записи.
    hasPassNow: m.pass_env ? !!process.env[m.pass_env] : false,
  }));
}

function all() {
  const db = open(DB_FILE);
  try {
    return {
      summary: summary(db),
      sent: sentTab(db),
      preparing: preparingTab(db),
      sessions: sessionsTab(db),
      mailboxes: mailTab(db),
    };
  } finally {
    db.close();
  }
}

module.exports = { all, fitFor, sentTab, preparingTab, sessionsTab, mailTab, summary };

if (require.main === module) {
  const d = all();
  console.log(JSON.stringify(d, null, 1));
}