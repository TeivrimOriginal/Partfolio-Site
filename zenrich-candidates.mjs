import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cand = JSON.parse(fs.readFileSync('hh-candidates.json', 'utf8'));
const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const qa = (h, n) => [...h.matchAll(new RegExp(`data-qa="${n}"[^>]*>([\\s\\S]{0,400}?)<`, 'g'))].map(m => strip(m[1]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
for (const s of cand.survivors) {
  const r = await fetch('https://hh.ru/vacancy/' + s.id, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
  const h = await r.text();
  let jp = {};
  for (const b of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(b[1]); for (const n of (j['@graph'] || [j])) if (n['@type'] === 'JobPosting') jp = n; } catch { }
  }
  const sal = jp.baseSalary ? { from: jp.baseSalary.value && jp.baseSalary.value.min, to: jp.baseSalary.value && jp.baseSalary.value.max, unit: jp.baseSalary.value && jp.baseSalary.value.unit } : null;
  const row = {
    id: s.id, title: s.title,
    employer: (jp.hiringOrganization && jp.hiringOrganization.name) || '',
    city: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressLocality) || '',
    salary: sal, posted: (jp.datePosted || '').slice(0, 10), valid: (jp.validThrough || '').slice(0, 10),
    formats: qa(h, 'work-formats-text').join(' | '), hours: qa(h, 'working-hours-text').join(' | '),
    open: /data-qa="vacancy-response-link-top"/.test(h),
    keywords: ['python', 'n8n', 'jira', 'ai ', 'llm', 'api'].filter(k => strip(h).toLowerCase().includes(k)),
  };
  out.push(row);
  console.log(row.id, '|', row.employer, '|', row.title.slice(0, 50), '|', row.city, '|', JSON.stringify(row.salary), '|', row.formats, '|', row.hours, '| open', row.open, '| valid', row.valid);
  await sleep(1300);
}
fs.writeFileSync('hh-candidates-enriched.json', JSON.stringify(out, null, 1));