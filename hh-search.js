// Поиск вакансий на hh с фильтром из hh-target.js.
//
// Разбор данных hh за 04.10.2026 показал, что в выдаче «удалённо + без опыта»
// на первых страницах сидит реклама обучения Aston («ученик/стажер», Java, 1С,
// React, Power BI, дата-инженер). Их 13 почти одинаковых вакансий, они
// отклоняют массово, и каждый такой отклик портит статистику профиля. Поэтому
// фильтр обязателен, а не опционален: Aston режется и по слову в заголовке, и
// по названию компании.
//
// Что тут важно и было найдено экспериментально:
//   * селектор работодателя — `vacancy-serp__vacancy-employer`;
//     `vacancy-serp-item-employer` не существует и молча даёт пустую строку,
//     из-за чего фильтр по компании не работал вообще;
//   * текст карточки читаем через textContent, innerText у неприсоединённого
//     документа DOMParser отдаёт пустоту;
//   * `location.href` в цикле читает устаревшую страницу — вакансию надо
//     забирать через fetch('/vacancy/<id>') + DOMParser.

const { pageFilterSource } = require('./hh-target.js');

// Запросы под его стек: Python, backend, автоматизация, парсинг, боты, QA, DevOps.
const QUERIES = [
  'Python разработчик',
  'Python инженер',
  'backend разработчик',
  'Python автоматизация',
  'Python REST API',
  'парсер Python',
  'Telegram бот Python',
  'QA тестировщик',
  'инженер по тестированию',
  'DevOps Python',
  'junior Python',
  'Python разработчик стажер',
  'Python Flask FastAPI',
  'автоматизация тестирования',
];

const SEARCH_BASE =
  '/search/vacancy?area=113&experience=noExperience&work_format=REMOTE' +
  '&order_by=publication_time&text=';

const browserScripts = {
  /**
   * Собирает вакансии по всем запросам и возвращает только прошедшие фильтр.
   * @param {string[]} appliedIds
   * @param {number} pages сколько страниц смотреть на каждый запрос
   */
  collect(appliedIds, pages) {
    const pagesN = pages || 2;
    return (
      '(async function(){\n' +
      'try {\n' +
      pageFilterSource(appliedIds || []) + '\n' +
      'var queries = ' + JSON.stringify(QUERIES) + ';\n' +
      'var base = ' + JSON.stringify(SEARCH_BASE) + ';\n' +
      'var map = {};\n' +
      'for (var qi=0; qi<queries.length; qi++){\n' +
      '  for (var page=0; page<' + pagesN + '; page++){\n' +
      '    var rr = await fetch(base + encodeURIComponent(queries[qi]) + "&page=" + page, {credentials:"include"});\n' +
      '    if (!rr.ok) break;\n' +
      '    var doc = new DOMParser().parseFromString(await rr.text(), "text/html");\n' +
      '    var cards = doc.querySelectorAll(\'[data-qa="vacancy-serp__vacancy"]\');\n' +
      '    if (!cards.length) break;\n' +
      '    for (var ci=0; ci<cards.length; ci++){\n' +
      '      var c = cards[ci];\n' +
      '      var a = c.querySelector(\'a[href*="/vacancy/"]\');\n' +
      '      if (!a) continue;\n' +
      '      var m = a.getAttribute("href").match(/vacancy\\/(\\d+)/);\n' +
      '      if (!m) continue;\n' +
      '      var id = m[1];\n' +
      '      if (map[id]) continue;\n' +
      '      var ti = c.querySelector(\'[data-qa="serp-item__title"]\');\n' +
      '      var em = c.querySelector(\'[data-qa="vacancy-serp__vacancy-employer"]\');\n' +
      '      var v = { id: id,\n' +
      '        title: ti ? ti.textContent.replace(/\\s+/g," ").trim() : "",\n' +
      '        co: em ? em.textContent.replace(/\\s+/g," ").trim() : "",\n' +
      '        remote: !!c.querySelector(\'[data-qa="vacancy-label-work-schedule-remote"]\'),\n' +
      '        noExp: !!c.querySelector(\'[data-qa="vacancy-serp__vacancy-work-experience-noExperience"]\') };\n' +
      '      var j = judge(v);\n' +
      '      v.why = j.reason || "";\n' +
      '      v.rule = j.rule;\n' +
      '      map[id] = v;\n' +
      '    }\n' +
      '  }\n' +
      '}\n' +
      'var all = [], keep = [], drop = {};\n' +
      'for (var id in map){\n' +
      '  var v = map[id];\n' +
      '  all.push(v);\n' +
      '  if (v.why) { drop[v.why] = (drop[v.why]||0)+1; } else { keep.push(v); }\n' +
      '}\n' +
      'return JSON.stringify({ seen: all.length, keep: keep, dropped: drop });\n' +
      '} catch(e) { return JSON.stringify({ error: String(e && e.message || e) }); }\n' +
      '})()'
    );
  },

  /**
   * Текст вакансии: обязательно через fetch, не через переход на страницу.
   * @param {string} id
   */
  fetchVacancy(id) {
    return (
      '(async function(){\n' +
      'try {\n' +
      'var rr = await fetch("/vacancy/' + id + '", {credentials:"include"});\n' +
      'if (!rr.ok) return JSON.stringify({ ok:false, status: rr.status });\n' +
      'var doc = new DOMParser().parseFromString(await rr.text(), "text/html");\n' +
      'function txt(sel){ var e = doc.querySelector(sel); return e ? e.textContent.replace(/\\s+/g," ").trim() : ""; }\n' +
      'var parts = Array.prototype.slice.call(doc.querySelectorAll(\'[data-qa="vacancy-description"], [data-qa="vacancy-branded-snippet"]\'))\n' +
      '  .map(function(e){ return e.textContent.replace(/\\s+/g," ").trim(); }).join(" ");\n' +
      'var resp = doc.querySelector(\'[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-top-again"]\');\n' +
      'return JSON.stringify({\n' +
      '  ok: true,\n' +
      '  title: txt("h1"),\n' +
      '  desc: parts.slice(0, 4000),\n' +
      '  canApply: !!resp && !doc.querySelector(\'[data-qa="vacancy-response-link-top-again"]\'),\n' +
      '  alreadyRejected: /Вам отказали/i.test(doc.body.textContent),\n' +
      '  applied: /Вы откликнулись/i.test(doc.body.textContent)\n' +
      '});\n' +
      '} catch(e) { return JSON.stringify({ ok:false, error: String(e && e.message || e) }); }\n' +
      '})()'
    );
  },
};

module.exports = { QUERIES, SEARCH_BASE, browserScripts };
