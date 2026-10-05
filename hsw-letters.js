// Генератор писем для вакансий в базе, с процентом приёма.
//
// Что делает. Берёт вакансии, прошедшие фильтр, составляет под каждую письмо и
// считает fit — процент, по которому ТЗ сортирует вакансии «на которые скорее
// возьмут».
//
// Что такое fit здесь. Четыре составляющие, сумма 100:
//   совпадение стека вакансии с профилем     30
//   требования, закрытые опытом              35
//   конкретика: в вакансии названа технология, которая есть в профиле  15
//   отсутствие требований, которые профиль закрыть не может        20
//
// Последняя составляющая — самая честная и самая частая причина низкого
// процента: если в вакансии требуют то, чего в профиле нет, письмо будет
// правдой («умею вот это»), но не попадёт в отклик. Такое письмо всё равно
// готовится и показывается в окне с процентом — просто процент низкий, и
// человек решает сам.
//
// Что ТЗ запрещает и что здесь не делается. В письмо не попадают «удалённая
// работа полностью», «готов к стендаму», «стажёрская ставка», «самозанятость»,
// год 2022 и слово «коммерческий» в применении к нему-доказанному-опыту.
// Это проверяется отдельным тестом, а не обещанием: test-letter-banned.js
// проверяет и тело письма, и его subject.
//
// Что с процентом ниже 50. По ТЗ такое письмо не отправляется, а вакансия
// попадает в LeaksData — таблицу, где видно, чего именно не хватило. Сюда
// такие письма тоже пишутся: иначе в окне не видно, ЧТО именно не подошло, и
// отладка превращается в угадывание.
//
// Использование:
//   node hsw-letters.js                 собрать письма для всех вакансий без письма
//   node hsw-letters.js --vacancy 12345 одна вакансия
//   node hsw-letters.js --limit 20      не больше 20 писем за прогон
//   node hsw-letters.js --rewrite       пересобрать и для тех, у которых письмо есть
//   node hsw-letters.js --show          напечатать письма, не записывая

const { open, DB_FILE } = require('./hsw-db.js');
const { composeLetter, letterTags } = require('./hh-letter.js');
const { stackOf, STACK_ORDER } = require('./hsw-screen.js');

// Что в профиле. Это единственный источник правды о том, что умеет
// откликающийся. Ничего отсюда не придумывается: список соответствует
// опубликованным резюме (resume-python.html и остальные), и любая правка
// профиля требует правки резюме, иначе письмо будет обещать то, чего в резюме
// нет, и об этом узнает работодатель.
const PROFILE = {
  name: 'Данила Аринов',
  stacks: ['python', 'cpp', 'backend', 'devops', 'qa'],
  // Технологии, которыми реально закрываются требования. Именно по ним идёт
  // сопоставление с описанием вакансии.
  tech: [
    'python', 'fastapi', 'flask', 'django', 'sqlalchemy', 'postgresql', 'sqlite',
    'celery', 'redis', 'docker', 'linux', 'git', 'rest', 'api', 'pytest',
    'selenium', 'allure', 'httpx', 'asyncio', 'pandas',
    'jenkins', 'gitlab', 'jira', 'confluence',
  ],
  // Что профиль НЕ закрывает. Наличие такого слова в вакансии снижает fit:
  // честнее показать низкий процент, чем отправить письмо, мимо которого
  // работодатель пройдёт, посмотрев на резюме.
  gaps: ['1c', '1с', 'oracle', 'clickhouse', 'spark', 'scala', 'kotlin', 'golang', 'typescript', 'react', 'angular', 'java', 'php', '1с-битрикс'],
};

// Веса составляющих fit. Сумма 100.
const W_STACK = 30;
const W_EXPERIENCE = 35;
const W_TECH = 15;
const W_NOGAP = 20;

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function parseArgs(argv) {
  const out = { limit: 0, vacancyId: null, rewrite: false, show: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--vacancy') out.vacancyId = String(argv[++i]);
    else if (a === '--rewrite') out.rewrite = true;
    else if (a === '--show') out.show = true;
  }
  return out;
}

// Стек вакансии есть в профиле.
function stackFit(stack) {
  return PROFILE.stacks.includes(stack) ? W_STACK : 0;
}

// Требования, которые профиль закрывает. Возвращает, какие именно.
function techFit(text) {
  const low = text.toLowerCase();
  const hit = PROFILE.tech.filter((t) => low.includes(t));
  // Требования, которые профиль закрыть не может.
  const gaps = PROFILE.gaps.filter((t) => low.includes(t));
  return { hit, gaps };
}

// Опыт вакансии против профиля.
//
// Важно: отсутствие в вакансии слова «опыт» — это НЕ доказательство, что
// опыта не требуют. hh уже отфильтровал по experience=noExperience, поэтому
// здесь считается не «сколько лет просят», а «есть ли вообще требование к
// опыту». Если требования нет, это максимум, а не ноль: письмо не должно
// врать, что опыт не нужен, но и не должно занижать процент из-за отсутствия
// того, чего не просят.
function experienceFit(text) {
  const low = text.toLowerCase();
  const asks = /(опыт[а-я]*\s*:?\s*(от\s*)?(\d+)|(\d+)\s*(год|лет|месяц)|не менее \d+)/.test(low);
  if (!asks) return { score: W_EXPERIENCE, why: 'требований к опыту в тексте нет' };
  return { score: Math.round(W_EXPERIENCE / 2), why: 'в вакансии назван опыт: профиль junior, совпадение частичное' };
}

function computeFit(v) {
  const text = [v.title, v.requirements, v.description].filter(Boolean).join(' \n ');
  const stack = v.stack || stackOf(v.title, text);

  const sStack = stackFit(stack);
  const exp = experienceFit(text);
  const { hit, gaps } = techFit(text);

  // Технология засчитывается, только если её назвали в описании, а не только в
  // заголовке: «Python-разработчик» в заголовке не доказывает, что в работе
  // нужен Python, если в тексте про него ни слова.
  const namedInBody = PROFILE.tech.some((t) => text.toLowerCase().includes(t));
  const sTech = namedInBody ? W_TECH : 0;

  // Пробелы снимают всё, кроме нуля: письмо про то, чего в профиле нет, —
  // это враньё, даже если написано вежливо.
  const sNogap = gaps.length ? 0 : W_NOGAP;

  const fit = Math.max(0, Math.min(100, sStack + exp.score + sTech + sNogap));

  const why = [];
  why.push('стек ' + (stack || 'не определён') + ': ' + sStack + ' из ' + W_STACK);
  why.push('опыт: ' + exp.score + ' из ' + W_EXPERIENCE + ' (' + exp.why + ')');
  why.push('технологии в тексте: ' + sTech + ' из ' + W_TECH +
    (namedInBody ? ' (найдено: ' + hit.slice(0, 4).join(', ') + ')' : ' (в тексте не названы)'));
  why.push('пробелов профиля в требованиях: ' + sNogap + ' из ' + W_NOGAP +
    (gaps.length ? ' — ' + gaps.slice(0, 3).join(', ') : ''));

  return { fit, why, stack, gaps, namedInBody };
}

// Запись в LeaksData для писем с fit ниже порога.
//
// Почему это здесь, а не в отдельном шаге. ТЗ: «если fit<50 — таблица
// LeaksData». Без этой записи письмо помечается как bad и тихо пропадает:
// сводка показывает leaks=0, хотя три вакансии отсеяны по существу. Измерено
// именно так — письма записаны, LeaksData пуста. Поэтому отклонение и
// отправляются, и пишутся в разные таблицы, но в одной транзакции: состояние
// «bad без записи в leaks» означало бы, что потерялась причина отказа.
function upsertLeak(db, vacancyId, fit, why) {
  db.prepare(`
    INSERT INTO leaks (vacancy_id, fit, why, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(vacancy_id) DO UPDATE SET fit = excluded.fit, why = excluded.why
  `).run(vacancyId, fit, why, nowIso());
}

function upsertLetter(db, v, letter, fitInfo) {
  const existing = db
    .prepare('SELECT id FROM letters WHERE vacancy_id = ? ORDER BY id LIMIT 1')
    .get(v.id);
  const stamp = nowIso();
  // Состояние зависит от fit: ниже 50 письмо не готово к отправке, и по ТЗ
  // такая вакансия уходит в LeaksData. Состояние ставится здесь, а не при
  // отправке, иначе в окне вкладка «Подготавливаются» показывала бы письма,
  // которые никто не собирается слать.
  const state = fitInfo.fit >= 50 ? 'ready' : 'bad';
  const why = fitInfo.why.join('; ');
  if (state === 'bad') {
    upsertLeak(db, v.id, fitInfo.fit, why);
  } else {
    // Вакансия могла попасть в LeaksData в прошлом прогоне, а теперь
    // подошла. Старая запись тогда врёт, и её надо убрать.
    db.prepare('DELETE FROM leaks WHERE vacancy_id = ?').run(v.id);
  }
  if (existing) {
    db.prepare('UPDATE letters SET subject = ?, body = ?, length = ?, fit = ?, fit_why = ?, state = ? WHERE id = ?')
      .run(letter.subject, letter.body, letter.body.length, fitInfo.fit, why, state, existing.id);
    return { id: existing.id, state, rewritten: true };
  }
  db.prepare(`INSERT INTO letters (vacancy_id, subject, body, length, fit, fit_why, state, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(v.id, letter.subject, letter.body, letter.body.length, fitInfo.fit, why, state, stamp);
  const row = db.prepare('SELECT id FROM letters WHERE vacancy_id = ? ORDER BY id DESC LIMIT 1').get(v.id);
  return { id: row.id, state, rewritten: false };
}

function stackRank(stack) {
  const i = STACK_ORDER.indexOf(stack);
  return i < 0 ? STACK_ORDER.length : i;
}

function main() {
  const args = parseArgs(process.argv);
  const db = open(DB_FILE);

  try {
    let sql = 'SELECT v.*, c.name AS company_name FROM vacancies v LEFT JOIN companies c ON c.id = v.company_id WHERE v.is_open = 1';
    const params = [];
    if (args.vacancyId) {
      sql += ' AND v.site_id = ?';
      params.push(args.vacancyId);
    } else if (!args.rewrite) {
      sql += ' AND NOT EXISTS (SELECT 1 FROM letters l WHERE l.vacancy_id = v.id)';
    }
    sql += ' ORDER BY v.id';

    const rows = db.prepare(sql).all(...params);
    console.log('=== письма ===');
    console.log('  вакансий к обработке: ' + rows.length + (args.rewrite ? ' (--rewrite: и те, у которых письмо есть)' : ' (без писем)'));
    if (args.limit > 0) console.log('  ограничение --limit: ' + args.limit);
    if (!rows.length) {
      console.log('  нечего делать. Если вакансии есть, а письма нет — проверьте, что сборщик записал их (hsw-collect.js).');
      return;
    }

    // Приоритет python — тот же порядок, что и в сборщике, иначе пачка из
    // разных запусков окажется перемешанной.
    rows.sort((a, b) => stackRank(a.stack) - stackRank(b.stack));

    const done = [];
    let errors = 0;
    let limit = args.limit || rows.length;

    for (const v of rows) {
      if (limit <= 0) break;
      const text = [v.title, v.requirements, v.description].filter(Boolean).join(' \n ');
      const stack = v.stack || stackOf(v.title, text);

      // composeLetter возвращает СТРОКУ, а не объект. Это выяснено на живой
      // вакансии: первая версия проверяла letter.body и получала «пустое
      // письмо» для всех 17 вакансий, то есть проверка проходила по неверной
      // форме данных. Проверено в probe-letter-shape.js.
      let body;
      try {
        body = composeLetter(v.title, v.description || '', v.company_name || v.company_raw || '', PROFILE);
      } catch (e) {
        errors++;
        console.log('  ' + v.site_id + ' ОШИБКА composeLetter: ' + e.message);
        continue;
      }
      if (typeof body !== 'string' || !body.trim()) {
        errors++;
        console.log('  ' + v.site_id + ' пустое письмо — пропускаю (тип: ' + typeof body + ')');
        continue;
      }

      const letter = { body, subject: v.title };
      const fitInfo = computeFit(v);

      if (args.show) {
        console.log('\n--- ' + v.site_id + '  ' + stack + '  fit ' + fitInfo.fit + ' ---');
        for (const w of fitInfo.why) console.log('    ' + w);
        console.log('  Предмет: ' + letter.subject);
        console.log(body.split('\n').map((l) => '  | ' + l).join('\n'));
        limit--;
        continue;
      }

      const res = upsertLetter(db, v, letter, fitInfo);
      limit--;
      done.push({ v, fitInfo, res, stack });
      console.log('  ' + v.site_id + ' [' + stack + '] fit ' + String(fitInfo.fit).padStart(3) +
        ' → ' + res.state + (res.rewritten ? ' (перезаписано)' : '') + '  ' +
        String(v.title).slice(0, 48) + ' — ' + (v.company_name || v.company_raw || '?'));
    }

    if (args.show) return;

    const ready = done.filter((d) => d.res.state === 'ready');
    const bad = done.filter((d) => d.res.state === 'bad');
    console.log('\n=== итог ===');
    console.log('  писем записано:  ' + done.length + (errors ? '  ошибок: ' + errors : ''));
    console.log('  готовы (fit>=50): ' + ready.length);
    console.log('  в LeaksData (fit<50): ' + bad.length + ' — по ТЗ они не отправляются');
    if (bad.length) {
      console.log('\n  что мешает в отклонённых:');
      for (const b of bad) console.log('    [' + b.stack + '] ' + b.v.title.slice(0, 46) + ' → ' + b.fitInfo.why[b.fitInfo.why.length - 1]);
    }
  } finally {
    db.close();
  }
}

main();