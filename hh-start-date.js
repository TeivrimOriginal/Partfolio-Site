// Проверяемая дата для блока «Опыт работы» на hh.
//
// hh требует месяц и год начала, а в локальном резюме честно написано
// «2022 — н.в.», без месяца. Выдумывать месяц нельзя, поэтому берётся дата
// создания самого раннего публичного репозитория: она проверяема и совпадает
// с началом работы с Python. Год результата сверяется с «2022» из резюме, и
// если не совпадает — скрипт падает, а не пишет чужую дату.
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'resume-audit', Accept: 'application/vnd.github+json' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(url + ' -> HTTP ' + res.statusCode));
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

(async function () {
  const repos = await get('https://api.github.com/users/TeivrimOriginal/repos?per_page=100&sort=created&direction=asc');
  if (!Array.isArray(repos) || !repos.length) throw new Error('репозитории не пришли');
  const withDates = repos
    .filter((r) => r && r.created_at && !r.fork)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const oldest = withDates[0];
  const d = new Date(oldest.created_at);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  console.log('всего репозиториев: ' + repos.length + ', без форков: ' + withDates.length);
  console.log('самый ранний: ' + oldest.name + ', создан ' + oldest.created_at);
  console.log('первые пять по дате:');
  withDates.slice(0, 5).forEach((r) => console.log('  ' + r.created_at.slice(0, 10) + '  ' + r.name));
  if (year !== 2022) {
    console.log('ГОД НЕ СОВПАДАЕТ с «2022» из резюме: получено ' + year + '. Ставить дату нельзя.');
    process.exit(1);
  }
  console.log('\nготово: начало работы — ' + month + ' ' + year + ' (' + (MONTHS[month] || '') + ' ' + year + ')');
})().catch((e) => {
  console.log('не получилось: ' + (e && e.message));
  process.exit(1);
});