// Отправка писем. До этого файла в системе не было ни одного места, которое
// что-то отправляло: письма копировались из интерфейса и уходили руками,
// а таблица `dispatches` оставалась пустой. Из-за этого была сломана не
// только отправка:
//
//   * вкладка «Отправлено» показывала ноль всегда;
//   * скоринг считал «использованные каналы» по dispatches (`channels_n`),
//     то есть 15 баллов за «вакансия не забыта после первого канала» не
//     начислялись ни одной вакансии — балл был недостижим по построению;
//   * повторных отправок никто не мог отследить: следов не оставалось.
//
// Здесь вся отправка целиком, и по умолчанию она НЕ отправляет: готовит
// письма (`.eml` с вложенным резюме) и записывает подготовку в базу. Реальная
// отправка включается флагом `--send` и требует заполненных HSW_SMTP_* —
// иначе письмо ушло бы с адреса, который человек не контролирует.
//
// Что здесь защищает от неприятного:
//
//   1. Адресат выбирается только из контактов, которые компания публикует
//      сама. Чужой адрес и выгруженная база адресатами не бывают.
//   2. Адрес, встречающийся у трёх и более компаний, адресатом не бывает:
//      это ящик агрегатора (см. sharedEmails в db.mjs).
//   3. Одной компании — одно письмо за запуск: три вакансии не означают
//      три письма в один ящик.
//   4. Повтор в ту же компанию раньше чем через 14 дней не готовится.
//   5. Письмо, не прошедшее проверку на выдуманные обещания, не
//      отправляется и не подготавливается.

import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, recordDispatch, sharedEmails, now } from './db.mjs';
import { draftLetter, checkClaims, PROFILE } from './letters.mjs';
import { resumeForStack } from './resumes.mjs';
import { pickChannel, hostOf, isPlatformContact } from './target.mjs';
import { THRESHOLD } from './score.mjs';

const ROOT = process.cwd();
// Каталог можно переопределить: тесты пишут в отдельную папку и не трогают
// рабочие письма, а при желании файлы можно складывать куда угодно.
const OUTBOX = process.env.HSW_OUTBOX
  ? path.resolve(process.env.HSW_OUTBOX)
  : path.join(ROOT, 'hsw', 'outbox');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Что человек делает с подготовленным файлом по каждому каналу. Формулировки
// в интерфейсе и в отчёте берутся отсюда, чтобы «куда нажать» не расходилось
// с тем, что лежит в файле.
export const CHANNEL_ACTION = {
  email: 'открыть .eml в почтовом клиенте и отправить',
  hh: 'открыть ссылку и вставить текст в сопроводительное письмо',
  telegram: 'открыть чат и отправить текст',
  site: 'написать через форму или почту на сайте компании',
  phone: 'позвонить или написать в мессенджер по указанному номеру',
};

const csv = (v) => {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ------------------------------------------------------------ .eml

const b64wrap = (buf) => Buffer.from(buf).toString('base64').replace(/.{76}/g, '$&\r\n');

/** Заголовок с не-ASCII кодируется по RFC 2047 — иначе тема «Отклик на …» ломается. */
export function encodeHeader(v) {
  const s = String(v ?? '');
  return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

const rfcDate = (d = new Date()) => d.toUTCString().replace(/GMT$/, '+0000');

/**
 * Собрать письмо целиком в .eml: multipart/mixed, текст UTF-8 в base64 и
 * резюме PDF во вложении. Такой файл открывается в почтовом клиенте, в
 * Thunderbird и в предпросмотре почты, поэтому «отправка» = «открыл файл и
 * нажал отправить», а вкладка «Отправлено» остаётся точной.
 */
export function buildEml({ subject, body, from, to, attach = null, vacancy = null, date = new Date() }) {
  const fromAddr = (String(from).match(/<([^>]+)>/) || [, from])[1];
  const domain = hostOf(fromAddr) || 'localhost';
  const messageId = `<hsw.${date.getTime().toString(36)}.${crypto.randomBytes(4).toString('hex')}@${domain}>`;
  const boundary = `----=_HSW_${crypto.randomBytes(12).toString('hex')}`;

  const headers = [
    `From: ${encodeHeader(PROFILE.name)} <${fromAddr}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${rfcDate(date)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    vacancy ? `X-HSW-Vacancy: ${vacancy.id}` : null,
    vacancy?.url ? `X-HSW-Vacancy-Url: ${vacancy.url}` : null,
    vacancy?.percent != null ? `X-HSW-Fit: ${vacancy.percent}` : null,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  const parts = [
    '',
    'Это письмо в текстовом формате. Если видно криво — вложение ниже важнее текста.',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64wrap(Buffer.from(String(body), 'utf8')),
  ];

  if (attach?.bytes) {
    parts.push(
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attach.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attach.name}"`,
      '',
      b64wrap(attach.bytes),
    );
  }

  parts.push('', `--${boundary}--`, '');
  // CRLF, а не LF: почтовый клиент не считает файл письмом, если строки
  // заканчиваются по-UNIX, — Outlook и часть веб-почты показывают исходники.
  return `${headers.join('\r\n')}\r\n${parts.join('\r\n')}\r\n`;
}

export const mailto = ({ subject, body, to }) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// ------------------------------------------------------------ SMTP

/**
 * Минимальный SMTP-клиент: EHLO → STARTTLS → AUTH → MAIL/RCPT/DATA → QUIT.
 *
 * Написан вручную, а не взят пакетом: в проекте нет зависимостей, и SMTP без
 * STARTTLS не отправляется — пароль идёт открытым текстом. Попытка одна, с
 * таймаутом: письмо либо ушло, либо помечено failed, «наверное отправилось»
 * в базе не появляется.
 */
export async function smtpSend({ host, port = 587, user, pass, from, to, raw, timeoutMs = 25000, secure = false }) {
  const log = [];
  let waiter = null;

  const onData = (chunk) => {
    let buf = (onData.buf || '') + chunk;
    let m;
    // Многострочный ответ заканчивается строкой «250 » — у промежуточных на
    // третьей позиции дефис вместо пробела.
    while ((m = buf.match(/^(\d{3})([ -])([^\n]*)\r?\n/))) {
      buf = buf.slice(m[0].length);
      log.push(`${m[1]} ${m[3]}`);
      if (m[2] === ' ') {
        const w = waiter;
        waiter = null;
        if (w) w.resolve({ code: Number(m[1]), text: m[3] });
      }
    }
    onData.buf = buf;
  };

  let socket = secure
    ? tls.connect({ host, port, servername: host }, () => {})
    : net.connect({ host, port });

  const bind = (s) => {
    s.setEncoding('utf8');
    s.removeAllListeners('data');
    s.on('data', onData);
    s.on('error', (e) => { const w = waiter; waiter = null; if (w) w.reject(e); });
  };
  bind(socket);

  const read = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiter = null;
      reject(new Error('SMTP: нет ответа сервера вовремя'));
    }, timeoutMs);
    waiter = {
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
    };
  });

  const cmd = async (line, expect) => {
    log.push(`>>> ${line}`);
    socket.write(`${line}\r\n`);
    const r = await read();
    if (expect && !expect.some((p) => String(r.code).startsWith(p))) {
      throw new Error(`SMTP: на «${line}» ответ ${r.code} ${r.text}`);
    }
    return r;
  };

  const ehloName = hostOf(from) || 'localhost';
  try {
    await read(); // приветствие 220
    let caps = (await cmd(`EHLO ${ehloName}`, ['2'])).text;

    if (!secure && /^STARTTLS/m.test(caps)) {
      await cmd('STARTTLS', ['2']);
      socket = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket, servername: host }, () => resolve(s));
        s.once('error', reject);
      });
      bind(socket);
      caps = (await cmd(`EHLO ${ehloName}`, ['2'])).text;
    }

    if (user && pass) {
      if (!/AUTH[^\n]*\b(PLAIN|LOGIN|XOAUTH2|CRAM)\b/i.test(caps)) {
        throw new Error('SMTP: сервер не предлагает AUTH');
      }
      if (/AUTH[^\n]*\bPLAIN\b/i.test(caps) && !/AUTH[^\n]*\bLOGIN\b/i.test(caps)) {
        await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')}`, ['2']);
      } else {
        await cmd('AUTH LOGIN', ['3']);
        await cmd(Buffer.from(user, 'utf8').toString('base64'), ['3']);
        await cmd(Buffer.from(pass, 'utf8').toString('base64'), ['2']);
      }
    }

    await cmd(`MAIL FROM:<${from}>`, ['2']);
    await cmd(`RCPT TO:<${to}>`, ['2', '5']);
    await cmd('DATA', ['3']);
    // Точка в начале строки внутри письма закрывает команду — экранируется.
    const data = String(raw).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(`${data}\r\n.\r\n`);
    const done = await read();
    if (!String(done.code).startsWith('2')) throw new Error(`SMTP: сервер не принял письмо — ${done.code} ${done.text}`);
    cmd('QUIT', null).catch(() => {});
    socket.end();
    return { ok: true, code: done.code, log };
  } catch (e) {
    socket.destroy();
    return { ok: false, error: e.message, log };
  }
}

// ------------------------------------------------------------ план

export function sentRecently(db, companyKey, days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT d.*, v.title FROM dispatches d JOIN vacancies v ON v.id = d.vacancy_id
    WHERE v.company_key = ? AND d.status = 'sent' AND d.sent_at >= ?
  `).all(companyKey, since);
}

/**
 * Что именно уйдёт и что почему не уйдёт. Молча пропущенные вакансии
 * выглядят как «система ничего не нашла», а это разные вещи, поэтому у
 * каждой причины есть счётчик.
 */
export function planBatch(db, { batch = 10, perCompany = 1, repeatDays = 14, resumeText = '', writeLetters = true } = {}) {
  const shared = new Set(sharedEmails(db, 3).map((s) => s.value));

  const rows = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM contacts c WHERE c.company_key = v.company_key) AS contacts_n
    FROM vacancies v
    WHERE v.status IN ('scored','drafted')
      AND v.percent >= ?
      AND v.stack IS NOT NULL
    ORDER BY v.urgent DESC, v.percent DESC, v.valid_through ASC
  `).all(THRESHOLD);

  const plan = [];
  const companiesUsed = new Set();
  const reasons = {};
  const skip = (why) => { reasons[why] = (reasons[why] || 0) + 1; };

  for (const v of rows) {
    if (plan.length >= batch) break;
    if (perCompany === 1 && companiesUsed.has(v.company_key)) { skip('одной компании — одно письмо за запуск'); continue; }

    const site = db.prepare("SELECT value FROM contacts WHERE company_key = ? AND kind = 'site' LIMIT 1").get(v.company_key)?.value || '';
    const contacts = db.prepare('SELECT kind, value, source_url, note FROM contacts WHERE company_key = ?').all(v.company_key);
    const target = pickChannel(contacts, { site, shared, vacancyUrl: v.url });
    if (target.blocked) { skip(target.blocked); continue; }

    const again = sentRecently(db, v.company_key, repeatDays);
    if (again.length) { skip(`повтор в ту же компанию за ${repeatDays} дн: ${String(again[0].sent_at).slice(0, 10)}`); continue; }

    // Черновика может не быть — тогда он делается здесь же, иначе подготовка
    // отправки зависела бы от того, успел ли человек запустить run-letters.
    // В режиме отчёта (writeLetters: false) база не пишется ничего: отчёт,
    // который меняет данные, отчётом не является.
    let letter = db.prepare('SELECT * FROM letters WHERE vacancy_id = ?').get(v.id);
    if (!letter) {
      const made = draftLetter(v, { score: { stack: v.stack, percent: v.percent }, target, channel: target.channel });
      const claims = checkClaims(made, resumeText);
      if (writeLetters) {
        db.prepare(`
          INSERT INTO letters (vacancy_id, resume_stack, subject, body, fit_score, fit_why, created, status)
          VALUES (?,?,?,?,?,?,?, 'draft')
        `).run(v.id, resumeForStack(v.stack, { root: ROOT }) || '', made.subject, made.body, v.percent,
          JSON.stringify({ claims }), new Date().toISOString());
      }
      letter = { ...made, fit_why: JSON.stringify({ claims }) };
    }

    const claims = (() => {
      try { return JSON.parse(letter.fit_why || '{}').claims || []; } catch { return []; }
    })();
    if (claims.length) { skip(`письмо претендует на лишнее: ${claims[0]}`); continue; }

    const resumeName = resumeForStack(v.stack, { root: ROOT });
    // Без файла резюме не отправляется только почта: в телеграме и на hh в
    // письме стоит ссылка на опубликованное резюме, и локальный файл для неё
    // не нужен.
    if (target.channel === 'email' && !resumeName) { skip(`нет файла резюме под стек ${v.stack}`); continue; }

    companiesUsed.add(v.company_key);
    plan.push({ vacancy: v, letter, target, resumeName });
  }

  return { plan, reasons, shared: [...shared] };
}

// ------------------------------------------------------------ подготовка

/**
 * Короткий текст для каналов без вложений и без форматирования.
 *
 * В телеграме письмо на 2 500 знаков не читают, а ссылку на резюме вставить
 * надо, поэтому берутся четыре абзаца: кто я и что делаю, что умею, условия и
 * контакты со ссылкой. Остальное — для почты.
 */
export function shortText(letter, { max = 900, channel = 'email' } = {}) {
  const paras = bodyForChannel(letter, channel).split('\n\n');
  const pick = (re) => paras.find((p) => re.test(p.trim()));
  const text = [
    paras[0],
    pick(/^Что умею по делу/),
    pick(/^По условиям|^Формат работы/),
    pick(/^Связь:/),
  ].filter(Boolean).join('\n\n');
  return text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max))}…`;
}

/**
 * Текст письма под канал.
 *
 * Письма, написанные до появления каналов, лежат в базе с фразой «Резюме
 * прикреплено к письму». В hh, телеграме или на сайте компании вложения нет,
 * и такая фраза — обещание, которое не выполнится: получатель ищет файл,
 * которого не будет. Поэтому для каналов без вложений фраза заменяется
 * ссылкой на опубликованное резюме, а не молча остаётся.
 */
export function bodyForChannel(letter, channel = 'email') {
  const body = String(letter?.body || '');
  if (channel === 'email') return body;
  if (!/Резюме прикреплено к письму/.test(body)) return body;
  if (/Резюме и примеры работ|resume-[a-z]+\.(html|pdf)/i.test(body)) return body;
  return body.replace(/Резюме прикреплено к письму\.?/,
    `Резюме и примеры работ: ${PROFILE.contacts.portfolio}`);
}

export function prepareOne(db, item, { date = new Date() } = {}) {
  const day = date.toISOString().slice(0, 10);
  const dir = path.join(OUTBOX, day);
  fs.mkdirSync(dir, { recursive: true });

  const slug = String(item.vacancy.company || 'company')
    .toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 28) || 'company';
  const channel = item.target.channel || 'email';
  const isEmail = channel === 'email';

  const resumePath = item.resumeName ? path.join(ROOT, item.resumeName) : '';
  const attach = isEmail && resumePath && fs.existsSync(resumePath)
    ? { name: item.resumeName, bytes: fs.readFileSync(resumePath) }
    : null;

  const name = isEmail ? `v${item.vacancy.id}-${slug}.eml` : `v${item.vacancy.id}-${slug}-${channel}.txt`;
  const file = path.join(dir, name);
  let raw;

  if (isEmail) {
    raw = buildEml({
      subject: item.letter.subject,
      body: item.letter.body,
      from: process.env.HSW_MAIL_FROM || PROFILE.contacts.email,
      to: item.target.value,
      attach,
      vacancy: item.vacancy,
      date,
    });
    fs.writeFileSync(file, raw, 'latin1');
  } else {
    const head = [
      `Канал: ${channel} — ${CHANNEL_ACTION[channel]}`,
      `Куда: ${item.target.value}`,
      `Почему этот канал: ${item.target.why}`,
      `Компания: ${item.vacancy.company || '—'} · процент ${item.vacancy.percent ?? '—'} · стек ${item.vacancy.stack || '—'}`,
      `Вакансия: ${item.vacancy.url}`,
      '',
      '--- текст для вставки ---',
      '',
    ].join('\n');
    const body = channel === 'telegram'
      ? shortText(item.letter, { channel })
      : bodyForChannel(item.letter, channel);
    raw = head + body + '\n';
    fs.writeFileSync(file, raw, 'utf8');
  }

  recordDispatch(db, {
    vacancyId: item.vacancy.id,
    channel,
    target: item.target.value,
    status: 'prepared',
    note: isEmail
      ? `${attach ? item.resumeName : 'вложения нет: файл резюме не найден'}; ${item.target.why}`
      : `${CHANNEL_ACTION[channel]}; ${item.target.why}`,
  });

  return {
    day,
    dir,
    name,
    file,
    channel,
    to: item.target.value,
    attach: attach?.name || null,
    bytes: Buffer.byteLength(raw, 'latin1'),
  };
}

const indexRow = (prep, item) => [
  item.vacancy.id, prep.channel, prep.to, item.vacancy.company || '', item.letter.subject,
  prep.name, prep.attach || '', prep.bytes, 'prepared',
].map(csv).join(',');

/**
 * Подготовить одно письмо по id вакансии — так нажимается кнопка в интерфейсе.
 * Возвращает {ok, why} или {ok:true, file, to}: интерфейсу нужно знать и
 * результат, и адресата, потому что «подготовить» может честно не получиться.
 */
export function prepareVacancy(db, vacancyId, { resumeText = '' } = {}) {
  const v = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancyId);
  if (!v) return { ok: false, why: 'вакансия не найдена' };
  // Те же ограничения, что и в планировании. Кнопка в интерфейсе ведёт сюда
  // напрямую, по id, и без этих проверок «Программист 1С» или вакансия с
  // процентом 30 отправлялись бы по кнопке.
  if (!v.stack) return { ok: false, why: 'стек не определён — вакансия не признана разработкой' };
  if ((v.percent || 0) < THRESHOLD) return { ok: false, why: `процент ${v.percent || 0} ниже порога ${THRESHOLD}` };

  const shared = new Set(sharedEmails(db, 3).map((s) => s.value));
  const contacts = db.prepare('SELECT kind, value, source_url, note FROM contacts WHERE company_key = ?').all(v.company_key);
  const target = pickChannel(contacts, {
    site: contacts.find((c) => c.kind === 'site')?.value || '',
    shared,
    vacancyUrl: v.url,
  });
  if (target.blocked) return { ok: false, why: target.blocked };

  let letter = db.prepare('SELECT * FROM letters WHERE vacancy_id = ?').get(vacancyId);
  if (!letter) {
    const made = draftLetter(v, { score: { stack: v.stack, percent: v.percent }, target, channel: target.channel });
    const claims = checkClaims(made, resumeText);
    db.prepare(`
      INSERT INTO letters (vacancy_id, resume_stack, subject, body, fit_score, fit_why, created, status)
      VALUES (?,?,?,?,?,?,?, 'draft')
    `).run(vacancyId, resumeForStack(v.stack) || '', made.subject, made.body, v.percent,
      JSON.stringify({ claims }), new Date().toISOString());
    letter = { ...made, fit_why: JSON.stringify({ claims }) };
  }

  const claims = (() => {
    try { return JSON.parse(letter.fit_why || '{}').claims || []; } catch { return []; }
  })();
  if (claims.length) return { ok: false, why: `письмо претендует на лишнее: ${claims[0]}` };

  const resumeName = resumeForStack(v.stack, { root: ROOT });
  if (target.channel === 'email' && !resumeName) return { ok: false, why: `нет файла резюме под стек ${v.stack || '—'}` };

  const prep = prepareOne(db, { vacancy: v, letter, target, resumeName });
  return { ok: true, ...prep };
}

/** Отметить отправку после того, как человек нажал «отправить» в клиенте. */
export function markSent(db, vacancyId, { channel = 'email', note = 'подтверждено вручную после отправки' } = {}) {
  const target = db.prepare('SELECT target FROM dispatches WHERE vacancy_id = ? AND channel = ?').get(vacancyId, channel)?.target || '';
  recordDispatch(db, { vacancyId, channel, target, status: 'sent', sentAt: now(), note });
  return { ok: true, target };
}

// ------------------------------------------------------------ CLI

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const db = openDb();
  const resumeText = fs.existsSync(path.join(ROOT, 'resume-fastapi.html'))
    ? fs.readFileSync(path.join(ROOT, 'resume-fastapi.html'), 'utf8').replace(/<[^>]+>/g, ' ').toLowerCase()
    : '';

  // Уборка старых записей: до фильтра в базу попали телеграм hh и сайт
// сервиса, и в отчёте они выглядели бы как контакты компании.
  const stale = db.prepare('SELECT kind, value FROM contacts').all()
    .filter((c) => isPlatformContact(c.value, c.kind));
  if (stale.length) {
    const del = db.prepare('DELETE FROM contacts WHERE kind = ? AND value = ?');
    for (const s of stale) del.run(s.kind, s.value);
    console.log(`убрано контактов площадки: ${stale.length} (${[...new Set(stale.map((s) => s.value))].slice(0, 4).join(', ')}${stale.length > 4 ? ', …' : ''})`);
  }

  // --- отчёт: что готово и почему что-то не готово
  if (hasFlag('report')) {
    const { plan, reasons, shared } = planBatch(db, {
      batch: Number(argOf('batch', 20)), resumeText, writeLetters: false,
    });
    console.log('=== готово к отправке ===');
    for (const p of plan) {
      console.log(`  ${String(p.vacancy.percent).padStart(3)} | ${p.target.channel.padEnd(9)} | ${String(p.target.value).slice(0, 44).padEnd(44)} | ${p.vacancy.title.slice(0, 34)}`);
    }
    if (!plan.length) console.log(`  ничего: под порогом ${THRESHOLD} нет вакансий с опубликованным адресом`);
    console.log('\n=== почему пропущено ===');
    for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${why}`);
    if (shared.length) console.log('\nобщие адреса (в адресаты не идут): ' + shared.join(', '));
    const byChannel = db.prepare('SELECT channel, status, COUNT(*) c FROM dispatches GROUP BY channel, status').all();
    console.log('\nв dispatches: ' + (byChannel.map((r) => `${r.channel}/${r.status}=${r.c}`).join(', ') || 'пусто'));
    return;
  }

  // --- подтверждение отправки человеком
  if (hasFlag('mark-sent')) {
    const ids = String(argOf('mark-sent', '')).split(',').map((s) => Number(s.trim())).filter(Boolean);
    for (const id of ids) {
      const channel = argOf('channel', null)
        || db.prepare('SELECT channel FROM dispatches WHERE vacancy_id = ?').get(id)?.channel
        || 'email';
      markSent(db, id, { channel });
      console.log(`  отмечено отправленным: вакансия ${id}`);
    }
    console.log(`\nвкладка «Отправлено» показывает ${db.prepare("SELECT COUNT(*) c FROM dispatches WHERE status = 'sent'").get().c}`);
    return;
  }

  // --- план и подготовка
  const batch = Number(argOf('batch', 10));
  const dry = hasFlag('dry-run');
  const { plan, reasons, shared } = planBatch(db, { batch, resumeText });

  console.log(`HardSearchWork — отправка. К отправке ${plan.length} писем${dry ? ' (--dry-run: ничего не пишу)' : ''}\n`);
  if (shared.length) console.log(`общие адреса исключены: ${shared.join(', ')}\n`);

  for (const p of plan) {
    console.log(`  ${String(p.vacancy.percent).padStart(3)} | ${p.target.channel.padEnd(9)} | ${p.vacancy.title.slice(0, 38)} (${p.vacancy.company || '—'})`);
    console.log(`        ${String(p.target.value).slice(0, 70)} · ${p.target.why}`);
  }
  if (!plan.length) {
    console.log('  писем нет. Причины по вакансиям:');
    for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}  ${why}`);
    return;
  }
  if (dry) return;

  const prepared = plan.map((p) => prepareOne(db, p));
  const day = prepared[0].day;
  fs.writeFileSync(
    path.join(OUTBOX, day, 'index.csv'),
    `id,channel,to,company,subject,file,attach,bytes,status\n${prepared.map((prep, i) => indexRow(prep, plan[i])).join('\n')}\n`,
    'utf8',
  );

  console.log(`\nподготовлено файлов: ${prepared.length} → hsw/outbox/${day}/`);
  console.log(`оглавление: hsw/outbox/${day}/index.csv`);
  for (const prep of prepared) {
    console.log(`  ${prep.name} → ${prep.channel}: ${String(prep.to).slice(0, 40)} (${prep.attach || 'без вложения'}, ${Math.round(prep.bytes / 1024)} КБ)`);
    if (prep.channel !== 'email') console.log(`      что делать: ${CHANNEL_ACTION[prep.channel]}`);
  }

  const emailsOnly = prepared.filter((p) => p.channel === 'email');
  if (!hasFlag('send') || !emailsOnly.length) {
    console.log('\nДальше по письму: открыть .eml в почтовом клиенте и отправить, затем отметить:');
    console.log(`  node hsw/send.mjs --mark-sent ${prepared.map((p) => p.name.match(/^v(\d+)/)[1]).join(',')}`);
    console.log('Письма по SMTP отправляются одной командой (нужны HSW_SMTP_HOST/PORT/USER/PASS):');
    console.log(`  node hsw/send.mjs --batch ${batch} --send`);
    return;
  }

  const host = process.env.HSW_SMTP_HOST;
  const user = process.env.HSW_SMTP_USER;
  const pass = process.env.HSW_SMTP_PASS;
  const from = process.env.HSW_MAIL_FROM || PROFILE.contacts.email;
  const port = Number(process.env.HSW_SMTP_PORT || 587);
  if (!host || !user || !pass) {
    console.log('\n--send без настроек СМТП: файлы подготовлены, но не отправлены.');
    console.log('Нужны HSW_SMTP_HOST, HSW_SMTP_PORT, HSW_SMTP_USER, HSW_SMTP_PASS.');
    return;
  }

  const dailyLimit = Number(process.env.HSW_MAIL_DAILY_LIMIT || 20);
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = db.prepare("SELECT COUNT(*) c FROM dispatches WHERE status = 'sent' AND sent_at >= ?")
    .get(`${today}T00:00:00.000Z`).c;
  const pause = Number(process.env.HSW_SEND_PAUSE_MS || 20000);
  console.log(`\nотправляю по SMTP ${host}:${port} от ${from}. Сегодня отправлено ${sentToday}, лимит ${dailyLimit}, пауза ${pause / 1000} с`);

  let ok = 0;
  for (const [i, prep] of emailsOnly.entries()) {
    if (sentToday + ok >= dailyLimit) { console.log(`  стоп: дневной лимит ${dailyLimit} достигнут`); break; }
    const raw = fs.readFileSync(path.join(prep.dir, prep.name), 'latin1');
    const r = await smtpSend({ host, port, user, pass, from, to: prep.to, raw });
    if (r.ok) {
      recordDispatch(db, {
        vacancyId: Number(prep.name.match(/^v(\d+)/)[1]), channel: 'email', target: prep.to,
        status: 'sent', sentAt: now(), note: `SMTP ${host}; резюме ${prep.attach}`,
      });
      ok++;
      console.log(`  отправлено: ${prep.to}`);
    } else {
      recordDispatch(db, {
        vacancyId: Number(prep.name.match(/^v(\d+)/)[1]), channel: 'email', target: prep.to,
        status: 'failed', note: r.error,
      });
      console.log(`  ОШИБКА ${prep.to}: ${r.error}`);
    }
    if (i < emailsOnly.length - 1) await sleep(pause);
  }
  console.log(`\nотправлено ${ok} из ${emailsOnly.length}. Вкладка «Отправлено» обновлена.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error('упало:', e?.stack || e); process.exit(1); });
