// Разбор локальных резюме в структуру.
//
// Зачем: девять версий лежат HTML-файлами, а на hh резюме — это набор полей
// (должность, о себе, опыт, проекты, навыки). Чтобы переносить содержимое, а не
// переписывать его заново по памяти, нужен разбор в поля. Плюс из этих же полей
// потом собираются письма: они должны ссылаться на тот же проект, который стоит
// в резюме под выбранную вакансию.
//
// Разбор сознательно простой: регулярки по известной разметке resume-*.html.
// DOM-библиотеки в проекте нет, а подключать её ради девяти файлов дороже, чем
// аккуратные регулярки. Каждое поле проверяется тестом на отсутствие мусора.
const fs = require('fs');
const path = require('path');

const FILES = [
  { file: 'resume.html', stack: 'общее' },
  { file: 'resume-python.html', stack: 'python' },
  { file: 'resume-backend.html', stack: 'backend' },
  { file: 'resume-cpp.html', stack: 'cpp' },
  { file: 'resume-frontend.html', stack: 'frontend' },
  { file: 'resume-qa.html', stack: 'qa' },
  { file: 'resume1c.html', stack: '1c' },
  { file: 'resume-gamedev.html', stack: 'gamedev' },
  { file: 'resume-en.html', stack: 'en' },
];

const ENTITIES = [
  [/&middot;/g, ' · '], [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&laquo;/g, '«'], [/&raquo;/g, '»'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&#39;/g, "'"], [/&quot;/g, '"'], [/&larr;/g, '←'],
];

function decode(s) {
  let t = String(s || '');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function stripTags(s) {
  return decode(String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function sectionsOf(html) {
  const out = [];
  // Две группы: head включает сам заголовок (нужен для названия секции),
  // body — всё после </h2>. С одной группой body был undefined, и все секции
  // молча выпадали: роли и навыки читались, а «О себе», опыт и проекты нет.
  const re = /<section class="sec">([\s\S]*?<\/h2>)([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ head: m[1], body: m[2] });
  return out;
}

function sectionTitle(sec) {
  const m = String(sec).match(/<h2>([\s\S]*?)<\/h2>/);
  return m ? stripTags(m[1]) : '';
}

function itemsOf(sec) {
  const items = [];
  const re = /<div class="it">([\s\S]*?)<\/div>\s*(?=<div class="it">|<\/section>|$)/g;
  let m;
  while ((m = re.exec(sec)) !== null) {
    const b = m[1];
    const name = (b.match(/class="it-t"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
    const meta = (b.match(/class="it-d mono"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
    const bullets = [];
    const bre = /<li>([\s\S]*?)<\/li>/g;
    let bm;
    while ((bm = bre.exec(b)) !== null) bullets.push(stripTags(bm[1]));
    items.push({ name: stripTags(name), meta: stripTags(meta), bullets: bullets });
  }
  return items;
}

const RE_ABOUT = /^(о себе|about|profile|summary|о компании)/i;
const RE_EXPERIENCE = /опыт работы|командный|работа|experience|employment|work history|team/i;
const RE_PROJECTS = /проект|project/i;

function parse(html) {
  const header = (html.match(/<header>([\s\S]*?)<\/header>/) || [])[1] || '';
  const name = stripTags((header.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const role = stripTags((header.match(/class="role"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
  const contactsHtml = (header.match(/class="meta"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
  const contacts = [];
  const are = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let am;
  while ((am = are.exec(contactsHtml)) !== null) contacts.push({ href: am[1], label: stripTags(am[2]) });

  const sections = {};
  for (const sec of sectionsOf(html)) {
    const title = sectionTitle(sec.head);
    if (!title) continue;
    // Классификация двуязычная: английская версия резюме использует
    // Profile / Experience / Projects, и при русских проверках всё её
    // содержимое молча попадало в «просто текст».
    if (RE_ABOUT.test(title)) { sections[title] = stripTags(sec.body); continue; }
    if (RE_EXPERIENCE.test(title)) { sections[title] = itemsOf(sec.body); continue; }
    if (RE_PROJECTS.test(title)) { sections[title] = itemsOf(sec.body); continue; }
    const text = stripTags(sec.body);
    if (text) sections[title] = text;
  }

  // Навыки идут плашками: переносим в список, на hh это отдельный блок.
  const skills = [];
  const skre = /<span class="sk">([\s\S]*?)<\/span>/g;
  let sm;
  while ((sm = skre.exec(html)) !== null) skills.push(stripTags(sm[1]));

  return { name: name, role: role, contacts: contacts, sections: sections, skills: skills };
}

// Плоские поля для переноса на hh: там ограничение по длине, и молча обрезанный
// текст хуже, чем явное предупреждение.
function flat(res) {
  const about = Object.entries(res.sections).find(([t, v]) => RE_ABOUT.test(t) && typeof v === 'string');
  const jobs = [];
  const projects = [];
  for (const [title, value] of Object.entries(res.sections)) {
    if (Array.isArray(value)) {
      if (RE_PROJECTS.test(title)) projects.push(...value);
      else if (RE_EXPERIENCE.test(title)) jobs.push(...value);
    }
  }
  const edu = Object.entries(res.sections).find(([t]) => /образован|education/i.test(t));
  return {
    about: about ? about[1] : '',
    jobs: jobs,
    projects: projects,
    education: edu ? String(edu[1]) : '',
    skills: res.skills,
  };
}

const out = [];
for (const entry of FILES) {
  const full = path.join(__dirname, entry.file);
  if (!fs.existsSync(full)) { console.log('нет файла ' + entry.file); continue; }
  const parsed = parse(fs.readFileSync(full, 'utf8'));
  out.push({ stack: entry.stack, file: entry.file, role: parsed.role, parsed: parsed, flat: flat(parsed) });
  const f = out[out.length - 1].flat;
  console.log(
    entry.stack.padEnd(9) +
    ' роль: ' + parsed.role.slice(0, 46).padEnd(48) +
    ' о себе: ' + String(f.about).length + ' симв.' +
    ' работа: ' + f.jobs.length +
    ' проектов: ' + f.projects.length +
    ' навыков: ' + f.skills.length +
    ' образование: ' + (f.education ? 'есть' : 'нет')
  );
}

fs.writeFileSync(path.join(__dirname, 'resumes-data.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log('\nзаписано: resumes-data.json, резюме: ' + out.length);