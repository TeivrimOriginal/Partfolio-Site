// Добираем то, чего нет в выдаче: срок действия, зарплату и город — из ld+json
// карточки. В нулевом прогоне поле valid осталось пустым: регулярка искала
// "validThrough":"..." в HTML, а эти поля лежат внутри экранированного ld+json,
// где кавычки не такие. Разбор JSON надёжнее регулярки.
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const qa = (h, n) => [...h.matchAll(new RegExp(`data-qa="${n}"[^>]*>([\\s\\S]{0,300}?)<`, 'g'))].map(m => strip(m[1]));

const fit = JSON.parse(fs.readFileSync('zero-exp-fit.json', 'utf8'));
// Возобновляемый прогон: уже собранные строки не перезапрашиваются. Без этого
// падение на одном ECONNRESET означало бы начинать 99 запросов заново — а hh
// рвёт соединение регулярно, это не редкость.
const done = new Map();
if (fs.existsSync('zero-exp-final.json')) {
  for (const v of JSON.parse(fs.readFileSync('zero-exp-final.json', 'utf8'))) if (v.valid) done.set(v.id, v);
}
console.log('уже собрано: ' + done.size);
const out = [];
for (const v of fit.good) {
  if (done.has(v.id)) { out.push(done.get(v.id)); continue; }
  let html = '';
  for (let a = 0; a < 3 && !html; a++) {
    try {
      const r = await fetch('https://hh.ru/vacancy/' + v.id, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      const t = r.status === 200 ? await r.text() : '';
      if (t.length > 20000) html = t;
    } catch (e) {
      console.log('  сбой сети на ' + v.id + ': ' + (e && e.message));
    }
    if (!html) await sleep(4000 + a * 5000);
  }
  if (!html) { console.log('не прочитана ' + v.id); out.push({ ...v, valid: '' }); continue; }
  let jp = {};
  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(b[1]); for (const n of (j['@graph'] || [j])) if (n['@type'] === 'JobPosting') jp = n; } catch { }
  }
  const bs = jp.baseSalary && jp.baseSalary.value;
  out.push({
    ...v,
    employer: (jp.hiringOrganization && jp.hiringOrganization.name) || v.employer,
    city: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressLocality) || '',
    from: (bs && bs.min) || v.from || null,
    to: (bs && bs.max) || v.to || null,
    posted: (jp.datePosted || '').slice(0, 10),
    valid: (jp.validThrough || '').slice(0, 10),
    formats: qa(html, 'work-formats-text').join(' | '),
    hours: qa(html, 'working-hours-text').join(' | '),
  });
  console.log(out[out.length - 1].id, '|', out[out.length - 1].employer.slice(0, 24), '|', out[out.length - 1].city, '|', out[out.length - 1].from, '-', out[out.length - 1].to, '| до', out[out.length - 1].valid);
  await sleep(1100);
  if (out.length % 20 === 0) fs.writeFileSync('zero-exp-final.json', JSON.stringify(out, null, 1) + '\n', 'utf8');
}
fs.writeFileSync('zero-exp-final.json', JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log('saved', out.length);