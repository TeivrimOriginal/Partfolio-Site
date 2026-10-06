// Чтение Хабра: RSS-выдача и страница вакансии, без входа.
//
// Всё проверено на живых ответах 06.10.2026, а не взято из документации.
//
//   career.habr.com/vacancies — 200, но это SPA ({"isGuest":true}), в HTML нет
//     ни одного data-qa, вакансии рисует JavaScript. Для списка не годится.
//   /vacancies/rss?page=1&per_page=25&q=python — 200, 34 КБ, ровно 50 <item>.
//     Параметр per_page игнорируется: и 25, и 50 дают 50 записей.
//   /vacancies/<id> — 200, 66 КБ, и описание ЕСТЬ: заглушка «Авторизуйтесь»
//     заменяет только кнопку отклика, а не текст вакансии. Первое прочтение
//     страницы выглядело как «гостю ничего не отдают», потому что искали слова
//     «Опыт работы», которых на Хабре в разметке просто нет: требования лежат
//     тегами (#middle, #junior) и не отдельным полем.
//
// Отсюда решение: список берём из RSS, требования и описание — со страницы.
// Тот же приём, что на hh.

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOST = 'career.habr.com';

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&laquo;/g, '«'], [/&raquo;/g, '»'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&#39;/g, "'"],
  [/&middot;/g, '·'],
];

function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span|td|th|ul|ol)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unescapeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/rss+xml', 'Accept-Language': 'ru-RU,ru;q=0.9' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
            res.resume();
            resolve(get(new URL(loc, url).href, depth + 1));
            return;
          }
          resolve({ status: res.statusCode, body, url });
        });
      }
    );
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '', url }); });
    req.on('error', () => resolve({ status: 0, body: '', url }));
  });
}

// Заголовок RSS приходит в виде: Требуется «ML-инженер (Python · PyTorch)» (Москва)
// Название вытаскивается из кавычек, город — из последних скобок.
function splitRssTitle(raw) {
  const s = unescapeXml(raw).trim();
  const quoted = /«([^»]*)»/.exec(s);
  const title = quoted ? quoted[1].trim() : s.replace(/^Требуется\s*/, '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  // Город стоит последней группой в скобках, но в названии тоже бывают скобки,
  // поэтому берём именно хвостовую.
  const cityM = /\s*\(([^()]*)\)\s*$/.exec(s);
  let city = cityM ? cityM[1].trim() : '';
  // Хвост бывает не только городом: «(Москва, от 230 000 ₽)». Зарплата
  // разбирается отдельно, а поле называется городом. Без этого в city попадало
  // «Москва, от 230 000 ₽» — поймано проверкой test-habr-page.js.
  city = city.replace(/,?\s*(от|до)\s*[\d  ]+(\s*(₽|руб\.|р\.))?\s*$/i, '').trim();
  return { title, city };
}

// Уровень — это тег из закрытого списка, а НЕ первый тег.
//
// Первая версия брала tags[0] и была поймана проверкой: у «DevOps Engineer (KORM)»
// первый тег — DevOps, а не уровень, и в список уровней попадали DevOps, Git,
// Linux, Docker, Kubernetes, SQL, Python. С таким уровнем фильтр «только
// intern/junior» решил бы, что вакансия подходит, а потом отсек бы её как
// «уровень не junior» — отчёт врал бы дважды.
const LEVEL_WORDS = /^(intern|internship|junior|trainee|train|student|стажёр|стажер|стажировка|middle|senior|lead|principal|expert|head|director|тимлид)$/i;

// Описание RSS несёт всё нужное о требованиях:
//   Компания «Урал Логистика» ищет хорошего специалиста на вакансию «…».
//   Москва (Россия). Полный рабочий день. Можно удалённо.
//   Требуемые навыки: #middle, #Python, #Linux.
function parseRssSummary(descRaw) {
  const text = htmlToText(unescapeXml(descRaw)).replace(/\s+/g, ' ').trim();
  const company = (/Компани[аия]\s+«([^»]+)»/.exec(text) || [])[1] || '';
  const remote = /Можно удалённо|Удалённая работа|удаленно/i.test(text);
  const schedule = (/(Можно удалённо[^.]*|Полный рабочий день|Частичная занятость|Проектная работа)/i.exec(text) || [])[1] || '';
  // Теги после «Требуемые навыки». Уровень ищется среди них по закрытому списку,
  // стеком считаются остальные.
  const tagsBlock = (/Требуемые навыки:\s*([^.]*)\.?$/i.exec(text) || [])[1] || '';
  const tags = (tagsBlock.match(/#[\wЀ-ӿ]+/g) || []).map((t) => t.replace(/^#/, ''));
  const level = tags.find((t) => LEVEL_WORDS.test(t)) || '';
  const salary = (/(от\s*[\d  ]+\s*(?:до\s*[\d  ]+\s*)?₽)/.exec(text) || [])[1] || '';
  const closed = /вакансия закрыта|вакансия больше не актуальна/i.test(text);
  return { text, company, remote, schedule, tags, level, stackTags: tags.filter((t) => !LEVEL_WORDS.test(t)), salary, closed };
}

function parseRss(xml) {
  const out = [];
  for (const chunk of String(xml).split('<item>').slice(1)) {
    const pick = (tag) => {
      const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>').exec(chunk);
      return m ? unescapeXml(m[1]).trim() : '';
    };
    const link = pick('link');
    const idM = /\/vacancies\/(\d+)/.exec(link);
    if (!idM) continue;
    const { title, city } = splitRssTitle(pick('title'));
    const sum = parseRssSummary(pick('description'));
    out.push({
      site: 'habr',
      id: idM[1],
      title,
      city,
      url: 'https://career.habr.com/vacancies/' + idM[1],
      published: pick('pubDate'),
      summary: sum.text,
      company: sum.company,
      remoteFromFeed: sum.remote,
      schedule: sum.schedule,
      level: sum.level,
      tags: sum.tags,
      stackTags: sum.stackTags,
      salary: sum.salary,
      closed: sum.closed,
    });
  }
  return out;
}

// RSS-выдача. Параметры фильтра: q — запрос, remoteWork=true — удалённо,
// page — страница. per_page площадка игнорирует, но оставляем для ясности.
async function fetchFeed({ q, remote, page }) {
  const params = ['page=' + (page || 1), 'per_page=50'];
  if (q) params.push('q=' + encodeURIComponent(q));
  if (remote) params.push('remoteWork=true');
  const url = 'https://' + HOST + '/vacancies/rss?' + params.join('&');
  const r = await get(url);
  if (r.status !== 200 || !r.body.includes('<item')) return [];
  return parseRss(r.body);
}

// Страница вакансии. Описание лежит в div.faded-content__body, но там же бывает
// обёртка заглушки «Авторизуйтесь», поэтому берём класс vacancy-description__text,
// который есть только у настоящего описания.
function parseVacancyPage(html) {
  const at = html.indexOf('vacancy-description__text');
  let description = '';
  if (at > 0) {
    const start = html.indexOf('>', at) + 1;
    // Ищем закрывающий </div> уровня того же контейнера: описание содержит свои
    // div-ы, поэтому простое indexOf('</div>') отрезало бы первый абзац.
    let depth = 1;
    let pos = start;
    let cut = html.length;
    const tagRe = /<div\b/gi;
    const endRe = /<\/div>/gi;
    while (pos < html.length && depth > 0) {
      tagRe.lastIndex = pos;
      endRe.lastIndex = pos;
      const o = tagRe.exec(html);
      const c = endRe.exec(html);
      if (!c) break;
      if (o && o.index < c.index) { depth++; pos = o.index + 1; continue; }
      depth--;
      pos = c.index + 1;
      if (depth === 0) { cut = c.index; break; }
    }
    description = htmlToText(html.slice(start, cut));
  }

  // Заголовок и компания есть в самом начале текста страницы.
  const plain = htmlToText(html);
  const titleM = /Вакансия «([^»]+)»/.exec(plain);
  const companyM = /в компании «([^»]+)»/.exec(plain);
  const closed = /Вакансия закрыта|вакансия больше не актуальна/i.test(plain);

  return {
    title: titleM ? titleM[1].trim() : '',
    company: companyM ? companyM[1].trim() : '',
    description,
    closed,
    // Гость не видит форму отклика, но заглушка говорит прямо, что нужен вход.
    needLogin: /Авторизуйтесь|users\/auth\/tmid/.test(html),
    plainLength: plain.length,
  };
}

async function fetchVacancy(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await get('https://' + HOST + '/vacancies/' + id);
    if (r.status === 200 && r.body.length > 20000) return r;
    await sleep(attempt === 0 ? 2000 : 5000);
  }
  return null;
}

module.exports = {
  HOST, UA, sleep, get,
  htmlToText, unescapeXml, splitRssTitle, parseRssSummary, parseRss,
  fetchFeed, fetchVacancy, parseVacancyPage,
};