// Пробуем скачать картинку капты hh без cookies: иногда ключ самодостаточен.
// Нужно, чтобы показать её оператору — вводить текст он должен сам.
const https = require('https');
const fs = require('fs');
const url = process.argv[2];
if (!url) { console.log('нет url'); process.exit(2); }
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    console.log('статус: ' + res.statusCode + ', тип: ' + (res.headers['content-type'] || '?') + ', байт: ' + buf.length);
    if (res.statusCode === 200 && buf.length > 500) {
      fs.writeFileSync('hh-captcha.jpg', buf);
      console.log('сохранено в hh-captcha.jpg');
    } else {
      console.log('не похоже на картинку, первые байты: ' + buf.slice(0, 40).toString('latin1'));
    }
  });
}).on('error', (e) => console.log('ошибка: ' + e.message));
