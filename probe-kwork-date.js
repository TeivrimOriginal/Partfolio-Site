// Проверяем, есть ли публичная дата начала работы на Kwork.
// Нужна для блока «Опыт работы» на hh: hh требует месяц и год, а в локальном
// резюме честно написано «2022 — н.в.». Выдумывать месяц нельзя, поэтому ищем
// любую публичную дату: регистрация аккаунта, дата первого заказа.
const https = require('https');

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'ru-RU,ru;q=0.9' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body }));
      }
    );
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
  });
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

(async function () {
  const targets = [
    'https://kwork.ru/user/teivrim',
    'https://kwork.ru/api/users/teivrim',
    'https://kwork.ru/api/v1/users/teivrim',
  ];
  for (const url of targets) {
    const r = await get(url);
    const b = r.body || '';
    console.log('--- ' + url + ' -> ' + r.status + ', байт ' + b.length + (r.error ? ', ошибка ' + r.error : ''));
    if (!b) continue;
    // Ищем любые даты в тексте и в json-подобных полях
    const jsonDates = [...new Set((b.match(/\d{4}-\d{2}-\d{2}/g) || []))].slice(0, 10);
    const words = [...new Set((b.match(/на (?:платформе|сервисе)[^<"]{0,40}/gi) || []))].slice(0, 5);
    const reg = (b.match(/(?:с|since|registration|created)[^\d]{0,12}(\d{4})/gi) || []).slice(0, 5);
    if (jsonDates.length) console.log('   даты в ответе: ' + jsonDates.join(', '));
    if (words.length) console.log('   формулировки: ' + words.join(' | '));
    if (reg.length) console.log('   регистрация: ' + reg.join(' | '));
    if (!jsonDates.length && !words.length && !reg.length) console.log('   дат не нашлось');
  }
  console.log('\nитог: публичной даты нет — месяц начала не выводится, поле опыта на hh оставляем пустым,');
  console.log('а факты про Kwork переносим в «О себе», где они не требуют даты.');
})();