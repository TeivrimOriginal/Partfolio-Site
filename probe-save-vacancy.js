// Сохраняет карточку вакансии hh на диск, чтобы разбирать разметку без сети.
// Каждая такая проверка в этом проекте стоила сети; файл переиспользуется.

const fs = require('fs');
const hh = require('./hh-page.js');

const ID = process.argv[2] || '138140507';
const OUT = process.argv[3] || 'F:/tmp/hh-vacancy-page.html';

(async () => {
  const page = await hh.fetchVacancy(ID, { attempts: 3 });
  if (!page) {
    console.log('карточка ' + ID + ' не пришла: троттлинг или смена вёрстки');
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUT, page.body, 'utf8');
  console.log('сохранено: ' + OUT + ', ' + page.body.length + ' Б');
})();