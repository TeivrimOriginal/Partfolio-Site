const r = await fetch('https://api.hh.ru/areas/1261', { headers: { 'User-Agent': 'hh-rabota-radical/1.0' } });
const d = await r.json();
const all = [d, ...d.areas];
const z = all.filter(a => /зареч/i.test(a.name));
console.log('total areas in region', all.length);
console.log(JSON.stringify(z, null, 1));
import fs from 'node:fs';
fs.writeFileSync('zarechny-area.json', JSON.stringify(z, null, 1));