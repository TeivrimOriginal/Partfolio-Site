// Чтение страниц hh: HTTP без входа + разбор HTML по data-qa.
//
// Зачем отдельный файл. Сборщику вакансий нужны заголовок, компания, описание
// и формат работы с одной карточки; генератору писем — то же самое плюс
// требования. Дублировать такую разборку в двух местах — верный способ
// получить два разных ответа на один вопрос.
//
// Всё здесь проверено на живой выдаче 06.10.2026, а не взято из документации:
//   * api.hh.ru/vacancies отдаёт 403 и с браузерным, и с «-application»
//     User-Agent — официальный API без ключа больше не открыт;
//   * hh.ru/search/vacancy отдаёт 302, zarechny.hh.ru/search/vacancy — 200
//     и 1.28 МБ HTML;
//   * RSS /search/vacancy/rss отдаёт 20 вакансий на обоих хостах, 8.8 КБ;
//   * в HTML карточка помечена data-qa="vacancy-serp__vacancy", номер вакансии
//     лежит в <div id="…"> рядом, а не в href (href абсолютный, и регексп
//     /vacancy/ на выдаче не находит ничего — измерено: 0 совпадений).
//
// Правило чтения hh, критичное здесь: строка «Вакансия закрыта» встречается в
// HTML даже у живой вакансии — это строки бандла. Искать можно только внутри
// конкретного data-qa. Проверено на 137824411: строка есть, вакансия живая.
// Поэтому признак архива берётся из текста внутри data-qa="vacancy-title".

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Хосты чередуются: гостевая выдача hh обрывается троттлингом через несколько
// десятков запросов. Порядок начинается с zarechny, потому что он отвечает 200,
// а hh.ru на /search отдаёт 302.
const HOSTS = ['zarechny.hh.ru', 'hh.ru'];

const PAUSE_MS = 700;

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
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span|td|th)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

// Текст одного элемента по data-qa.
//
// Режет по закрывающему тегу с учётом вложенности: внутри description есть свои
// div-ы, и наивный поиск первого </div> отрезал бы описание до первой строки.
// Заметность длины проверяется в test-hh-page.js: заголовок, вернувший полстраницы,
// — это поломка, которая не выглядит поломкой.
function qa(html, name) {
  const at = html.indexOf('data-qa="' + name + '"');
  if (at < 0) return '';
  const start = html.indexOf('>', at);
  if (start < 0) return '';
  // Имя тега берётся ТОЛЬКО что стоит левее атрибута data-qa, то есть по
  // lastIndexOf('<', at). Прежний вариант брал его из куска между data-qa и
  // «>» и получал не имя тега, а сам атрибут: на живой карточке для
  // data-qa="vacancy-title" это давало `data-qa="vacancy-title"` вместо h1,
  // элемент не закрывался, и заголовок возвращался длиной 497026 символов —
  // вся страница целиком. Проверка «поле не пусто» при этом проходила.
  const tagStart = html.lastIndexOf('<', at);
  if (tagStart < 0) return '';
  const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(tagStart, start));
  if (!tagMatch) return '';
  const tagName = tagMatch[1];
  const tagRe = new RegExp('<' + tagName + '\\b', 'gi');
  const endRe = new RegExp('</' + tagName + '\\s*>', 'gi');
  let depth = 1;
  let pos = start + 1;
  let cut = html.length;
  while (pos < html.length) {
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
  return htmlToText(html.slice(start + 1, cut));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Один GET с редиректами и таймаутом. Никогда не бросает: сетевой обрыв — это
// «страница не прочитана», а не исключение, потому что вызывающий код обязан
// отличать «нет вакансии» от «не смог прочитать».
function fetchOnce(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
            resolve(fetchOnce(new URL(loc, url).href, depth + 1));
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

// Карточка вакансии с повторами по хостам.
//
// Повтор делается потому, что троттлинг hh возвращает либо 403, либо 200 с
// заглушкой: отличить нужно по длине ответа, а не по коду. Порог 20000
// подобран по живой странице: карточка с описанием — сотни килобайт, заглушка
// после троттлинга — единицы.
async function fetchVacancy(id, opts) {
  const attempts = (opts && opts.attempts) || 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const r = await fetchOnce('https://' + host + '/vacancy/' + id);
    if (r.status === 200 && r.body.length > 20000) return r;
    await sleep(attempt === 0 ? 2500 : 6000);
  }
  return null;
}

// Разобранная карточка: то, что нужно и сборщику, и генератору.
function parseVacancy(html, id) {
  const title = qa(html, 'vacancy-title');
  return {
    id: String(id),
    title,
    archived: /в архиве/i.test(title),
    company: qa(html, 'vacancy-company-name') || qa(html, 'vacancy-company'),
    // Почему не vacancy-company: это контейнер, и он включает подвал карточки
    // работодателя. На живой карточке Aston приходило
    // «Aston Финалит Рейтинга работодателей hh.ru IT-компания У работодателя
    // есть аккредитация» — то есть в базу писалось не имя компании, а
    // объявление под ней. Точный элемент — vacancy-company-name.
    companyBlock: qa(html, 'vacancy-company__details'),
    companyId: (/href="\/employer\/(\d+)"/.exec(html) || [])[1] || null,
    salary: qa(html, 'vacancy-salary'),
    experience: qa(html, 'work-experience-text'),
    workFormat: qa(html, 'work-formats-text'),
    schedule: qa(html, 'work-schedule-by-days-text'),
    education: qa(html, 'vacancy-education'),
    description: qa(html, 'vacancy-description'),
    address: qa(html, 'vacancy-address'),
  };
}

// Карточки из HTML-выдачи поиска. Нужны, чтобы брать структурные метки
// «Без опыта» и «Можно удалённо», а не верить поисковой строке.
function parseSearchHtml(html) {
  const out = [];
  const cards = html.split('<article').slice(1);
  for (const card of cards) {
    if (!card.includes('data-qa="vacancy-serp__vacancy"')) continue;
    const end = card.indexOf('</article>');
    const body = end > 0 ? card.slice(0, end) : card;
    const idMatch = /<div id="(\d+)"/.exec(body);
    if (!idMatch) continue;
    const href = (/<a[^>]*data-qa="serp-item__title"[^>]*href="([^"]+)"/.exec(body) || [])[1] || '';
    out.push({
      id: idMatch[1],
      title: qa(body, 'serp-item__title-text'),
      company: qa(body, 'vacancy-serp__vacancy-employer-text'),
      companyId: (/href="\/employer\/(\d+)"/.exec(body) || [])[1] || null,
      address: qa(body, 'vacancy-serp__vacancy-address'),
      noExperienceTag: /data-qa="vacancy-serp__vacancy-work-experience-noExperience"/.test(body),
      remoteTag: /data-qa="vacancy-label-work-schedule-remote"/.test(body),
      url: href ? href.replace(/&amp;/g, '&').split('?')[0] : 'https://hh.ru/vacancy/' + idMatch[1],
    });
  }
  return out;
}

function unescapeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

// Разбор RSS-выдачи. В <description> hh кладёт сводку: «Вакансия компании: …»
// Создана: … Регион: … Уровень дохода: …» — оттуда берутся компания и зарплата.
// Полного описания вакансии в RSS нет, поэтому для проверки образования и
// опыта всё равно нужен поход на карточку. RSS — это дешёвый список кандидатов.
function parseRss(xml) {
  const items = [];
  for (const chunk of String(xml).split('<item>').slice(1)) {
    const pick = (tag) => {
      const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(chunk);
      return m ? unescapeXml(m[1]).trim() : '';
    };
    const descRaw = unescapeXml(pick('description')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const link = pick('link');
    const idMatch = /\/vacancy\/(\d+)/.exec(link);
    if (!idMatch) continue;
    const companyMatch = /Вакансия компании:\s*([^Р]+?)(?:\s+Создана:|$)/.exec(descRaw);
    const salaryMatch = /(?:Уровень месячного дохода|от)\s*:?\s*([\d  ]*\d)/.exec(descRaw);
    items.push({
      id: idMatch[1],
      title: pick('title'),
      url: 'https://hh.ru/vacancy/' + idMatch[1],
      published: pick('pubDate'),
      summary: descRaw,
      company: companyMatch ? companyMatch[1].trim() : '',
      salary: salaryMatch ? salaryMatch[1].replace(/\s+/g, ' ').trim() : '',
    });
  }
  return items;
}

module.exports = {
  UA, HOSTS, PAUSE_MS,
  htmlToText, qa, sleep,
  fetchOnce, fetchVacancy, parseVacancy, parseSearchHtml, parseRss,
};