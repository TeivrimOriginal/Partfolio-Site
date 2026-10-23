import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const list = JSON.parse(fs.readFileSync('zvac-area1275.json', 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
const qa = (html, name) => {
  const re = new RegExp(`data-qa="${name}"[^>]*>([\\s\\S]{0,600}?)</`, 'g');
  const out = [];
  for (const m of html.matchAll(re)) { const s = strip(m[1]); if (s) out.push(s); }
  return out;
};

async function get(id) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://hh.ru/vacancy/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      const t = await r.text();
      if (r.status === 200 && t.length > 20000) return t;
      if (r.status === 404) return '';
      console.log(`  ${id} status ${r.status} len ${t.length}`);
    } catch (e) { console.log(`  ${id} ERR ${e.message}`); }
    await sleep(5000 + a * 7000);
  }
  return null;
}

const out = [];
for (const [n, v] of list.entries()) {
  const html = await get(v.id);
  if (html === null) { out.push({ ...v, state: 'fetch_failed' }); continue; }
  if (html === '') { out.push({ ...v, state: 'closed_404' }); console.log(`${n + 1}/${list.length} ${v.id} 404`); continue; }
  let jp = {};
  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(b[1]);
      for (const node of (j['@graph'] || [j])) if (node['@type'] === 'JobPosting') jp = node;
    } catch { }
  }
  const desc = qa(html, 'vacancy-description').join(' ').slice(0, 4000);
  const keywords = ['студент', 'частичная занятость', 'совмещени', 'не более 24', 'гибкий график', 'свободный график',
    'обучает', 'без опыта', 'можно без', 'неполный день', 'часов в день', 'учеб', 'стажировк', 'подработк'];
  const found = keywords.filter(k => desc.toLowerCase().includes(k));
  out.push({
    id: v.id, title: v.title, url: v.url,
    employer: (jp.hiringOrganization && jp.hiringOrganization.name) || '',
    city: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressLocality) || '',
    region: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressRegion) || '',
    salaryFrom: v.salaryFrom, salaryTo: v.salaryTo,
    currency: jp.baseSalary && jp.baseSalary.currency,
    salaryUnit: jp.baseSalary && jp.baseSalary.value && jp.baseSalary.value.unit,
    experience: v.experience,
    datePosted: (jp.datePosted || '').slice(0, 10),
    validThrough: (jp.validThrough || '').slice(0, 10),
    employmentType: jp.employmentType || '',
    schedule: qa(html, 'work-schedule-by-days-text').join(' | '),
    hours: qa(html, 'working-hours-text').join(' | '),
    formats: qa(html, 'work-formats-text').join(' | '),
    applied: /Вы откликнулись|Отклик отправлен/.test(html),
    keywords: found,
    desc,
  });
  const o = out[out.length - 1];
  console.log(`${n + 1}/${list.length} ${v.id} ${v.title.slice(0, 38)} | ${o.employer.slice(0, 28)} | ${o.city} | exp=${o.experience} | ${o.employmentType} | ${o.schedule} | ${o.hours} | ${o.formats} | kw:${o.keywords.join(',')}`);
  await sleep(1300);
  if ((n + 1) % 20 === 0) fs.writeFileSync('zarechny-vacancies-full.json', JSON.stringify(out, null, 1));
}
fs.writeFileSync('zarechny-vacancies-full.json', JSON.stringify(out, null, 1));
console.log('saved', out.length, 'closed', out.filter(o => o.state).length);