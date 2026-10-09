// Проверки отправки, целиком на фикстурах: сети и почты нет, письма никто не
// отправляет. Проверяется ровно то, что в отправке легло испортить:
//
//   * выбор адресата — не площадка, не служебный ящик, не общий адрес, и не
//     первый попавшийся;
//   * .eml — валидная структура письма, тема читается, вложение целое;
//   * планирование — одна компания получает одно письмо, повтор в ту же
//     компанию не готовится, не-разработка и порог отсекаются;
//   * запись в dispatches — подготовка не выдаёт себя за отправку.
//
// Запуск: node hsw/test-send.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, sharedEmails, addContact } from './db.mjs';
import { pickAddress } from './target.mjs';
import { resumeForStack, stackKeyOf } from './resumes.mjs';
import { pickChannel, isPlatformContact } from './target.mjs';

// Каталог подготовленных писем переопределяется ДО загрузки send.mjs: иначе
// проверки писали бы свои фикстуры в рабочий hsw/outbox и смешивали их с
// настоящими письмами. Статический импорт поднялся бы раньше этой строки.
const TMP_OUTBOX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'outbox-test');
process.env.HSW_OUTBOX = TMP_OUTBOX;
const { buildEml, encodeHeader, planBatch, prepareVacancy, markSent, shortText, bodyForChannel, CHANNEL_ACTION } =
  await import('./send.mjs');

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  + ${name}`); }
  else { fail++; console.log(`  ОШИБКА ${name}${extra ? ` :: ${extra}` : ''}`); }
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP_DB = path.join(HERE, 'test-send.sqlite');

for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
const db = openDb(TMP_DB);
const stamp = new Date().toISOString();

const vac = (o) => {
  const r = db.prepare(`
    INSERT INTO vacancies (source, external_id, url, title, company, company_key, remote,
      no_experience, no_degree, percent, stack, fit_why, status, first_seen, last_seen)
    VALUES (?,?,?,?,?,?,1,1,?,?,?,?,?,?,?)
  `).run(
    o.source || 'hh',
    o.external_id,
    o.url ?? `https://hh.ru/vacancy/${o.external_id}`,
    o.title, o.company, o.company_key,
    o.no_degree ?? 1, o.percent, o.stack ?? null,
    JSON.stringify(o.fit_why || {}), o.status || 'scored', stamp, stamp,
  );
  return Number(r.lastInsertRowid);
};

const contact = (key, kind, value) =>
  db.prepare('INSERT OR IGNORE INTO contacts (company_key, kind, value, first_seen) VALUES (?,?,?,?)')
    .run(key, kind, value, stamp);

// -------------------------------------------------------------- адресат
console.log('\nвыбор адресата');

ok(pickAddress([{ kind: 'email', value: 'hr@okkam.ru' }]).value === 'hr@okkam.ru', 'берёт единственный адрес');
ok(pickAddress([]).blocked.includes('нет опубликованного адреса'), 'без почты — честная причина, а не пустота');
ok(pickAddress([{ kind: 'phone', value: '+7 900 000-00-00' }]).blocked === 'у компании нет опубликованного адреса',
  'телефон без почты адресатом не является');

const two = pickAddress(
  [{ kind: 'email', value: 'info@okkam.ru' }, { kind: 'email', value: 'job@okkam.ru' }],
  { site: 'https://okkam.ru' },
);
ok(two.value === 'job@okkam.ru', 'роль в найме лучше общего ящика', two.value);
ok(pickAddress([{ kind: 'email', value: 'jobs@company.com' }, { kind: 'email', value: 'sales@company.com' }]).value === 'jobs@company.com',
  'служебный sales отбрасывается');
ok(pickAddress([{ kind: 'email', value: 'no-reply@company.com' }]).blocked.includes('служебный'), 'no-reply не адресат');
ok(pickAddress([{ kind: 'email', value: 'hrfeedback@avito.ru' }]).blocked.includes('служебный'), 'hrfeedback не адресат');
ok(pickAddress([{ kind: 'email', value: 'something@dreamjob.ru' }]).blocked.includes('площадки'), 'домен агрегатора не адресат');
ok(pickAddress([{ kind: 'email', value: 'employers@dreamjob.ru' }], { shared: new Set(['employers@dreamjob.ru']) })
  .blocked.includes('общий адрес'), 'общий адрес площадки отбрасывается даже без списка доменов');

// -------------------------------------------------------------- каналы
console.log('\nвыбор канала, когда почты нет');

ok(pickChannel([{ kind: 'email', value: 'hr@okkam.ru' }], { vacancyUrl: 'https://hh.ru/vacancy/1' }).channel === 'email',
  'почта важнее площадки');
ok(pickChannel([{ kind: 'telegram', value: '@okkam' }], { vacancyUrl: 'https://hh.ru/vacancy/1' }).channel === 'hh',
  'без почты — отклик на hh, даже если есть телеграм');
ok(pickChannel([{ kind: 'telegram', value: '@okkam' }]).channel === 'telegram', 'без ссылки на вакансию — телеграм');
ok(pickChannel([{ kind: 'site', value: 'https://okkam.ru/contacts' }]).channel === 'site', 'сайт — после телеграма');
ok(pickChannel([{ kind: 'phone', value: '+7 900 000-00-00' }]).channel === 'phone', 'телефон — последний канал');
ok(pickChannel([]).blocked.includes('нет опубликованного адреса'), 'вообще без контактов — отказ с причиной');

// --------------------------------------------------- контакты площадок
console.log('\nконтакты площадок не считаются контактами компании');

ok(isPlatformContact('https://setka.ru/communities/0194f0a0-a88d-4d57-94d0-329dacbb5578'), 'сайт сервиса площадки отсекается');
ok(isPlatformContact('@hh_ru_official'), 'телеграм hh отсекается');
ok(isPlatformContact('https://hh.ru/employer/6528', 'site'), 'страница работодателя в поле «сайт» — это страница hh');
ok(!isPlatformContact('https://hh.ru/employer/6528', 'hh_employer'), 'как канал отклика страница работодателя остаётся');
ok(!isPlatformContact('https://okkam.ru'), 'настоящий сайт компании не отсекается');
ok(!isPlatformContact('jobs@okkam.ru'), 'почта компании не отсекается');
ok(!isPlatformContact('@okkaminsights'), 'телеграм компании не отсекается');

ok(addContact(db, { companyKey: 'платформа', kind: 'telegram', value: '@hh_ru_official' }) === false,
  'база не принимает контакт площадки');
ok(db.prepare("SELECT COUNT(*) c FROM contacts WHERE value LIKE '%hh_ru%'").get().c === 0, 'в базе его нет');
ok(!!pickChannel([{ kind: 'telegram', value: '@hh_ru_official' }]).blocked,
  'телеграм площадки не становится каналом: письмо в него не собирается');

// ------------------------------------------------------------- короткий текст
console.log('\nкороткий текст для канала без вложений');

const longLetter = {
  body: [
    'Здравствуйте! Меня зовут Данила Аринов, я Junior Python-разработчик.',
    'Это закрывает требования вакансии по стеку python.',
    'Что умею по делу:\n  • Python с 2022\n  • FastAPI\n  • PostgreSQL',
    'По условиям подходит: удалённый формат.',
    'Пишу на адрес jobs@okkam.ru, который компания публикует сама.',
    'Связь: @Smishnyavko · teivrim@gmail.com\nРезюме и примеры работ: https://teivrimoriginal.github.io/Partfolio-Site/',
    'Готов выполнить тестовое задание.',
  ].join('\n\n'),
};
const short = shortText(longLetter, { max: 400 });
ok(!short.includes('Это закрывает требования'), 'второй абзац выброшен');
ok(short.includes('Что умею по делу') && short.includes('Связь:'), 'осталось что читают и как ответить');
ok(!short.includes('адрес jobs@okkam.ru'), 'строка про адрес почты в телеграме не нужна');
ok(short.length <= 401, 'короткий текст укладывается в лимит', String(short.length));
ok(shortText(longLetter, { max: 100000 }) === longLetter.body.split('\n\n').slice(0, 1).join('\n\n')
  + '\n\n' + longLetter.body.split('\n\n')[2]
  + '\n\n' + longLetter.body.split('\n\n')[3]
  + '\n\n' + longLetter.body.split('\n\n')[5], 'без лимита текст не обрезается многоточием');
ok(Object.keys(CHANNEL_ACTION).length === 5, 'для каждого канала написано, что делать человеку');

// ------------------------------------------------- письмо без вложения
console.log('\nписьмо старого формата в канале без вложений');

const oldLetter = {
  body: [
    'Здравствуйте! Меня зовут Данила Аринов.',
    'Это закрывает требования вакансии.',
    'Что умею по делу:\n  • Python с 2022',
    'По условиям подходит: удалённый формат.',
    'Связь: @Smishnyavko\nРезюме прикреплено к письму.',
  ].join('\n\n'),
};

ok(bodyForChannel(oldLetter, 'email') === oldLetter.body, 'для почты письмо не трогается — вложение есть');
ok(!bodyForChannel(oldLetter, 'hh').includes('прикреплено'),
  'в hh обещание вложения убрано: файла там не будет');
ok(bodyForChannel(oldLetter, 'hh').includes('https://teivrimoriginal.github.io/Partfolio-Site/'),
  'вместо обещания — ссылка на опубликованное резюме');
ok(!shortText(oldLetter, { channel: 'telegram' }).includes('прикреплено'),
  'короткий текст для телеграма тоже без обещания вложения');

const newLetter = { body: 'Здравствуйте!\n\nРезюме и примеры работ: https://example/resume-qa.html' };
ok(bodyForChannel(newLetter, 'hh') === newLetter.body, 'письмо с уже верной ссылкой не меняется');

// ---------------------------------------------------------- общие адреса
console.log('\nобщие адреса в базе');

for (const key of ['dream a', 'dream b', 'dream c']) {
  vac({ external_id: `x-${key}`, title: 'Python', company: key, company_key: key, percent: 70, stack: 'Python' });
  contact(key, 'email', 'employers@dreamjob.ru');
}
vac({ external_id: 'okkam', title: 'Python', company: 'okkam', company_key: 'okkam', percent: 80, stack: 'Python' });
contact('okkam', 'email', 'jobs@okkam.ru');
contact('okkam', 'site', 'https://okkam.ru');

const sharedRows = sharedEmails(db, 3);
ok(sharedRows.length === 1 && sharedRows[0].value === 'employers@dreamjob.ru' && sharedRows[0].companies === 3,
  'общий адрес найден по трём компаниям', JSON.stringify(sharedRows));
ok(!sharedRows.some((s) => s.value === 'jobs@okkam.ru'), 'собственный адрес компании общим не считается');

// ------------------------------------------------------------------ .eml
console.log('\n.eml');

const pdf = fs.readFileSync(path.join(ROOT, 'resume-qa.pdf'));
const body = 'Здравствуйте! Меня зовут Данила Аринов.\n\nЦифры 5 986 строк.\nПишу на адрес jobs@okkam.ru, который компания публикует сама.\n';
const raw = buildEml({
  subject: 'Отклик на «QA-инженер» — ОККАМ',
  body,
  from: 'teivrim@gmail.com',
  to: 'jobs@okkam.ru',
  attach: { name: 'resume-qa.pdf', bytes: pdf },
  vacancy: { id: 7, url: 'https://hh.ru/vacancy/7', percent: 82 },
  date: new Date('2026-10-08T09:30:00Z'),
});

ok(raw.includes('\r\n'), 'строки заканчиваются CRLF');
ok(!/[^\r]\n/.test(raw), 'нет ни одной «голой» LF — почтовый клиент не сочтёт файл письмом');

const headers = raw.split('\r\n\r\n')[0];
ok(/^From: =\?UTF-8\?B\?.+\?= <teivrim@gmail\.com>$/m.test(headers), 'отправитель с русским именем закодирован по RFC 2047');
ok(/^To: jobs@okkam\.ru$/m.test(headers), 'получатель');
ok(/^Subject: =\?UTF-8\?B\?/m.test(headers), 'тема с кириллицей закодирована');
ok(/^Date: Thu, 08 Oct 2026 09:30:00 \+0000$/m.test(headers), 'дата в формате RFC 5322');
ok(/^Message-ID: <hsw\.[a-z0-9]+\.[0-9a-f]{8}@gmail\.com>$/m.test(headers), 'Message-ID');
ok(/^X-HSW-Vacancy: 7$/m.test(headers), 'в заголовке остаётся вакансия');

const decodedSubject = Buffer.from(
  headers.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)[1], 'base64').toString('utf8');
ok(decodedSubject === 'Отклик на «QA-инженер» — ОККАМ', 'тема читается обратно в исходную строку', decodedSubject);

const boundary = headers.match(/boundary="(.+)"/)[1];
const parts = raw.split(`--${boundary}`);
ok(parts.length === 4, 'три части: текст, вложение, закрывающий разделитель', String(parts.length));
ok(raw.trimEnd().endsWith(`--${boundary}--`), 'закрывающий разделитель на месте');

// Тело части — всё после пустой строки. Взять «после Content-Transfer-Encoding»
// нельзя: у вложения следом идёт Content-Disposition, а его буквы — тоже
// допустимые символы base64, и файл вставки декодировался бы в мусор.
const bodyOf = (part) => part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n/g, '');

const textB64 = bodyOf(parts[1]);
ok(Buffer.from(textB64, 'base64').toString('utf8') === body, 'текст письма декодируется байт в байт');
ok(/Content-Disposition: attachment; filename="resume-qa\.pdf"/.test(parts[2]), 'вложение помечено как вложение');

const decodedPdf = Buffer.from(bodyOf(parts[2]), 'base64');
ok(decodedPdf.length === pdf.length && decodedPdf.equals(pdf), `вложение совпало с файлом (${pdf.length} Б)`);
const textLines = parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4).trimEnd().split('\r\n');
ok(textLines.every((l) => l.length <= 76) && textLines.length > 1, 'строки base64 не длиннее 76 символов');
ok(encodeHeader('Plain ASCII subject') === 'Plain ASCII subject', 'ASCII-заголовок не кодируется зря');

// ----------------------------------------------------------- планирование
console.log('\nпланирование отправки');

const idOkkam = vac({ external_id: 'okkam2', title: 'Python-разработчик', company: 'okkam', company_key: 'okkam', percent: 88, stack: 'Python' });
vac({ external_id: 'okkam3', title: 'Python intern', company: 'okkam', company_key: 'okkam', percent: 60, stack: 'Python' });
vac({ external_id: 'below', title: 'Python-разработчик', company: 'lowco', company_key: 'lowco', percent: 40, stack: 'Python' });
contact('lowco', 'email', 'hr@lowco.ru');
const idOnec = vac({ external_id: 'nostack', title: 'Программист 1С', company: 'onec', company_key: 'onec', percent: 90, stack: null });
contact('onec', 'email', 'hr@onec.ru');

const plan1 = planBatch(db, { batch: 10 });
ok(plan1.plan.length === 4 && plan1.plan[0].vacancy.id === idOkkam,
  'в плане одна вакансия компании на компанию, а не по письму на каждую',
  plan1.plan.map((p) => `${p.vacancy.id}:${p.target.channel}`).join(','));
ok(plan1.plan.filter((p) => p.vacancy.company_key === 'okkam').length === 1,
  'две вакансии одной компании дают одно письмо');
ok(plan1.plan.filter((p) => p.target.channel === 'email').length === 1,
  'почта только там, где она реально опубликована');
ok(Object.keys(plan1.reasons).some((r) => r.includes('одной компании')), 'повтор в ту же компанию посчитан причиной');
ok(plan1.plan[0].target.value === 'jobs@okkam.ru', 'адресат взят из контактов компании', plan1.plan[0].target.value);
ok(!plan1.shared.includes('jobs@okkam.ru'), 'свой адрес компании в общие не попал');
ok(db.prepare('SELECT COUNT(*) c FROM dispatches').get().c === 0, 'планирование ничего не пишет в dispatches');
ok(!Object.keys(plan1.reasons).some((r) => r.includes('1С')), 'не-разработка отсечена стеком и не попала даже в причины');

// -------------------------------------------------------- подготовка и учёт
console.log('\nподготовка и учёт отправки');

const prep = prepareVacancy(db, idOkkam);
ok(prep.ok === true, 'письмо подготовлено', prep.why || '');
ok(fs.existsSync(prep.file), 'файл .eml лежит на диске');
ok(fs.readFileSync(prep.file, 'latin1').includes('jobs@okkam.ru'), 'в файле тот адресат, что выбран');

let d = db.prepare('SELECT * FROM dispatches WHERE vacancy_id = ?').get(idOkkam);
ok(d.status === 'prepared' && d.target === 'jobs@okkam.ru', 'подготовка записана как prepared, а не sent');
ok(db.prepare('SELECT status FROM letters WHERE vacancy_id = ?').get(idOkkam).status === 'approved', 'черновик помечен approved');
ok(db.prepare('SELECT status FROM vacancies WHERE id = ?').get(idOkkam).status === 'scored', 'вакансия не переведена в sent до отправки');
ok(prepareVacancy(db, idOnec).ok === false, 'не-разработка (1С) не готовится к отправке');

markSent(db, idOkkam);
d = db.prepare('SELECT * FROM dispatches WHERE vacancy_id = ?').get(idOkkam);
ok(d.status === 'sent' && !!d.sent_at, 'отправка подтверждена и записана с датой');
ok(db.prepare('SELECT status FROM vacancies WHERE id = ?').get(idOkkam).status === 'sent', 'вакансия ушла в sent');

const afterSend = planBatch(db, { batch: 10 });
ok(!afterSend.plan.some((p) => p.vacancy.company_key === 'okkam'), 'повторно в ту же компанию не готовится');
ok(Object.keys(afterSend.reasons).some((r) => r.includes('повтор в ту же компанию')), 'причина повтора названа прямо');

// ------------------------------------------------- подготовка без почты
console.log('\nподготовка письма без почты');

const idTg = vac({
  external_id: 'tgc', title: 'QA-инженер', company: 'Телеграм Компания', company_key: 'тг',
  percent: 77, stack: 'QA / тестирование', url: '',
});
contact('тг', 'telegram', '@telegramcompany');
const prepTg = prepareVacancy(db, idTg);
ok(prepTg.ok === true && prepTg.channel === 'telegram', 'без почты и без ссылки на hh-вакансию канал выбирается по контактам', prepTg.channel);
ok(prepTg.file.endsWith('.txt'), 'без почты готовится текст, а не письмо с вложением', prepTg.file);
ok(fs.readFileSync(prepTg.file, 'utf8').includes('--- текст для вставки ---'), 'в файле сказано, куда вставлять текст');
ok(fs.readFileSync(prepTg.file, 'utf8').includes('Резюме и примеры работ:'), 'без вложения стоит ссылка на резюме, а не обещание вложения');
const dTg = db.prepare('SELECT * FROM dispatches WHERE vacancy_id = ?').get(idTg);
ok(dTg.channel === prepTg.channel && dTg.status === 'prepared', 'канал и статус записаны в dispatches', `${dTg.channel}/${dTg.status}`);

// ---------------------------------------------------------------- резюме
console.log('\nвыбор резюме');

ok(stackKeyOf('QA / тестирование') === 'qa', 'ярлык QA превращается в ключ qa');
ok(stackKeyOf('Python') === 'python' && stackKeyOf('Backend') === 'python', 'Python и Backend дают ключ python');
ok(stackKeyOf('') === null, 'пустой стек не превращается в ключ');
ok(resumeForStack('QA / тестирование', { root: ROOT }) === 'resume-qa.pdf', 'к QA идёт qa-резюме');
ok(resumeForStack('DevOps', { root: ROOT }) === 'resume-devops.pdf', 'к DevOps идёт devops-резюме');
ok(resumeForStack('Данные', { root: ROOT }) === 'resume-sql-data.pdf', 'к «Данные» идёт data-резюме');
ok(resumeForStack('Неизвестный стек', { root: ROOT }) === 'resume-fastapi.pdf', 'неизвестный стек берёт базовое резюме');
ok(resumeForStack('QA', { root: 'каталога-нет' }) === null, 'нет файла — возвращается null, а не чужое резюме');

// ------------------------------------------------------------------ итог
db.close();
for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
if (fs.existsSync(TMP_OUTBOX)) fs.rmSync(TMP_OUTBOX, { recursive: true, force: true });

console.log(`\nпроверок: ${pass + fail}, из них пройдено ${pass}${fail ? `, ОШИБОК ${fail}` : ''}`);
if (fail) process.exit(1);
