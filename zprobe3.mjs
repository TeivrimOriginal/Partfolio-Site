// Проба доступности источников. Ничего не собирает — только код ответа и
// размер тела, чтобы понять, куда вообще можно идти.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const urls = process.argv.slice(2);
for (const u of urls) {
  let code = 'ERR', size = 0, note = '';
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }, redirect: 'follow' });
    const t = await r.text();
    code = r.status; size = t.length;
    note = /captcha|капча|подтвердите, что вы не робот|Доступ ограничен/i.test(t) ? 'CAPTCHA?' : '';
    if (/Заречн/i.test(t)) note += ' +Заречный';
  } catch (e) { note = e.message.slice(0, 60); }
  console.log(`${String(code).padEnd(4)} ${String(size).padStart(8)}  ${u}  ${note}`);
}
