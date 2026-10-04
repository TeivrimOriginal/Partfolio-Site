// Разрешённые адреса: куда на самом деле ведёт отклик с remote-job.ru.
//
// Зачем файл существует. Ссылка с агрегатора сама по себе бесполезна: отклик
// уходит на другую площадку. На этой конкретной выдаче почти все объявления
// оказались вакансиями hh, просто найденными другим поиском. Поэтому ценность
// не в самих вакансиях, а в их номерах hh: если такого номера нет в шортлисте и
// нет в отправленных, это новая вакансия для существующей очереди.
//
// Адреса разрешались браузером: переход с gorodrabot делает скрипт redirect.js,
// из node/meta refresh его не достать — проверено.
// Использование: node resolve-diff.js
const fs = require('fs');

// id вакансии на remote-job → адрес назначения
const RESOLVED = {
  1516561: 'https://zarechny.hh.ru/vacancy/137824411',
  1513990: 'https://rostov.hh.ru/vacancy/137622630',
  1512274: 'https://zarechny.hh.ru/vacancy/137514511',
  1507817: 'https://zarechny.hh.ru/vacancy/137215780',
  1469144: 'https://zarechny.hh.ru/vacancy/134829827',
  1519470: 'https://rostov.hh.ru/vacancy/137959823',
  1518149: 'https://chelyabinsk.hh.ru/vacancy/137922959',
  1511796: 'https://zarechny.hh.ru/vacancy/137485520',
  1519103: 'https://podolsk.hh.ru/vacancy/138021455',
  1513313: 'https://zarechny.hh.ru/vacancy/137585398',
  1462895: 'https://zarechny.hh.ru/vacancy/134492344',
  1516458: 'https://spb.hh.ru/vacancy/137802363',
  1514133: 'https://zarechny.hh.ru/vacancy/137646890',
  1518881: 'https://zarechny.hh.ru/vacancy/137976192',
  1517547: 'https://zarechny.hh.ru/vacancy/137873203',
  1502049: 'https://zarechny.hh.ru/vacancy/136810581',
  1514040: 'https://zarechny.hh.ru/vacancy/137652608',
  1511150: 'https://zarechny.hh.ru/vacancy/137435084',
  1512225: 'https://novosibirsk.hh.ru/vacancy/137518234',
  1512460: 'https://cheboksary.hh.ru/vacancy/137521646',
  1513507: 'https://novosibirsk.hh.ru/vacancy/137354249',
  1513992: 'https://rostov.hh.ru/vacancy/137622470',
  1508869: 'https://zarechny.hh.ru/vacancy/137271035',
  1498986: 'https://togliatti.hh.ru/vacancy/136586918',
  1518527: 'https://rostov.hh.ru/vacancy/137964592',
  1513283: 'https://zarechny.hh.ru/vacancy/137587111',
  1513282: 'https://novosibirsk.hh.ru/vacancy/137587241',
  1519932: 'https://nn.hh.ru/vacancy/138055992',
  1518525: 'https://vladimir.hh.ru/vacancy/137964777',
};

const hhIdOf = (url) => {
  const m = String(url || '').match(/hh\.ru\/vacancy\/(\d+)/);
  return m ? m[1] : null;
};

const applied = fs.readFileSync('hh-applied-ids.txt', 'utf8').split(/[,\s]+/).filter((x) => /^\d+$/.test(x));
const letters = JSON.parse(fs.readFileSync('LETTERS-SHORTLIST.json', 'utf8')).map((r) => String(r.id));
const queued = new Set(letters);
const appliedSet = new Set(applied);

const rows = [];
for (const rj of Object.keys(RESOLVED)) {
  const hhId = hhIdOf(RESOLVED[rj]);
  if (!hhId) { rows.push({ remoteJobId: rj, url: RESOLVED[rj], state: 'адрес не hh' }); continue; }
  let state = 'новая вакансия hh — можно добавить в очередь';
  if (appliedSet.has(hhId)) state = 'уже отклик отправлен';
  else if (queued.has(hhId)) state = 'уже есть в шортлисте с письмом';
  rows.push({ remoteJobId: rj, hhId: hhId, url: RESOLVED[rj], state: state });
}

const fresh = rows.filter((r) => r.state.indexOf('новая') === 0);
const known = rows.filter((r) => r.state.indexOf('уже') === 0);

console.log('разрешено адресов: ' + rows.length);
console.log('из них вакансий hh: ' + rows.filter((r) => r.hhId).length);
console.log('уже отправлено: ' + known.filter((r) => r.state.indexOf('уже отклик') === 0).length);
console.log('уже в шортлисте: ' + known.filter((r) => r.state.indexOf('шортлисте') === 0).length);
console.log('НОВЫХ для очереди hh: ' + fresh.length);
for (const f of fresh) console.log('  ' + f.hhId + ' ← remote-job ' + f.remoteJobId + ' · ' + f.url);

fs.writeFileSync('remote-job-resolved.json', JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  note: 'отклик с remote-job ведёт на другую площадку; здесь фактические адреса',
  rows: rows,
}, null, 1), 'utf8');
console.log('отчёт: remote-job-resolved.json');
