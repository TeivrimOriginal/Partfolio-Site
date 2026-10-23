// Обогащение карточек: троттлинг hh с первого запроса подряд отдаёт 461.
// Лечится паузой + чередованием хостов. Проверено: после паузы страница
// приходит нормально (200, 828 КБ, ld+json на месте).
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const ARGS = process.argv.slice(2);
const IN = ARGS[0] || 'zbroad-area1275.json';
const OUT = ARGS[1] || 'zarechny-vacancies-full.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
const qa = (html, name) => {
  const re = new RegExp(`data-qa="${name}"[^>]*>([\\s\\S]{0,600}?)</`, 'g');
  const out = [];
  for (const m of html.matchAll(re)) { const s = strip(m[1]); if (s) out.push(s); }
  return out;
};

const list = JSON.parse(fs.readFileSync(IN, 'utf8'));
const known = new Set();
if (fs.existsSync(OUT)) {
  for (const v of JSON.parse(fs.readFileSync(OUT, 'utf8'))) known.add(v.id);
}
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];

async function get(id, n) {
  for (let a = 0; a <= 3; a++) {
    if (a > 0) await sleep(6000 + a * 9000);
    try {
      const r = await fetch(`${HOSTS[(n + a) % HOSTS.length]}/vacancy/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      const t = await r.text();
      if (r.status === 200 && t.length > 40000 && t.includes('application/ld+json')) return t;
      if (r.status === 404) return '';
    } catch { /* retry */ }
  }
  return null;
}

// Требования, которые закрывают вакансию для 19-летнего студента СПО.
const BLOCK = [
  { re: /высш(ее|его)\s+образован/i, why: 'высшее образование' },
  { re: /незаконч(енн|енное|енный)\s+высш/i, why: 'незаконченное высшее' },
  { re: /\bопыт\s+работы[^.]{0,40}\bот\s+\d+\s*(лет|года|г\b|месяц)/i, why: 'опыт от N лет' },
  { re: /\b(2|3|4|5|6)\s*\+\s*(лет|года|г\b)/i, why: 'опыт 2+ лет' },
  { re: /коммерческ\w*\s+опыт/i, why: 'коммерческий опыт' },
  { re: /стаж[её]р[^.]{0,60}с\s+высшим/i, why: 'высшее для стажёра' },
];

let done = 0;
for (const [n, v] of list.entries()) {
  if (known.has(v.id)) { done++; continue; }
  const html = await get(v.id, n);
  done++;
  if (html === null) { out.push({ ...v, state: 'throttled' }); console.log(`${done}/${list.length} ${v.id} THROTTLE`); }
  else if (html === '') { out.push({ ...v, state: 'closed_404' }); console.log(`${done}/${list.length} ${v.id} 404`); }
  else {
    let jp = {};
    for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const j = JSON.parse(b[1]);
        for (const node of (j['@graph'] || [j])) if (node['@type'] === 'JobPosting') jp = node;
      } catch { }
    }
    // Описание берём из ld+json, а НЕ из data-qa="vacancy-description":
    // data-qa стоит на внешнем div, и регулярка «до первого </» вытаскивала
    // 7–170 символов вместо текста. В ld+json лежит полный текст.
    const desc = strip(jp.description || '').slice(0, 8000);
    const descHtml = (jp.description || '');
    const title = (qa(html, 'vacancy-title')[0] || v.title || '').replace(/В архиве.*$/i, '').trim();
    const blocked = BLOCK.filter(b => b.re.test(desc)).map(b => b.why);
    const empType = (jp.employmentType || '') + ' ' + qa(html, 'vacancy-company-name').join(' ');
    out.push({
      id: v.id, title, url: v.url,
      employer: (jp.hiringOrganization && jp.hiringOrganization.name) || v.employer || '',
      city: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressLocality) || '',
      salaryFrom: jp.baseSalary ? jp.baseSalary.value ? jp.baseSalary.value.min : null : (v.from ?? null),
      salaryTo: jp.baseSalary ? jp.baseSalary.value ? jp.baseSalary.value.max : null : (v.to ?? null),
      currency: jp.baseSalary ? jp.baseSalary.currency : '',
      experience: v.exp,
      experienceText: (jp.experienceRequirements && (jp.experienceRequirements.experienceInMonths
        ? (jp.experienceRequirements.experienceInMonths / 12) + ' лет'
        : jp.experienceRequirements.name)) || '',
      datePosted: (jp.datePosted || '').slice(0, 10),
      employmentType: jp.employmentType || '',
      schedule: qa(html, 'work-schedule-by-days-text').join(' | '),
      hours: qa(html, 'working-hours-text').join(' | '),
      formats: qa(html, 'work-formats-text').join(' | '),
      blocked, blockedDesc: desc,
      descLen: desc.length,
      queries: v.queries,
      desc,
    });
    const o = out[out.length - 1];
    console.log(`${done}/${list.length} ${v.id} ${o.title.slice(0, 42)} | ${o.employer.slice(0, 26)} | ${o.city} | ${o.experienceText} | ${o.employmentType} | ${o.schedule} | ${o.hours} | blk:${blocked.join(',') || '-'}`);
  }
  if (done % 15 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
  await sleep(2200);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('saved', out.length, '->', OUT);
