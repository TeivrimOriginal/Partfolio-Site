// Очередь отправки: что осталось отправить и как записать результат.
//
// Разборка на две части не из эстетики. Навигацию нельзя делать внутри
// evaluate() — она убивает контекст, document.body становится null. Поэтому
// переход к вакансии делает вызывающий код через tools.browser.navigate, а
// этот модуль отдаёт скрипт для уже открытой страницы.
//
// Модуль существует, чтобы очередь не жила в моей памяти: после капты осталось
// 19 вакансий, и их надо отправить без повторного разбора вручную.

const fs = require('fs');
const path = require('path');
const { browserScripts: applyScripts } = require('./hh-apply.js');

const LETTERS_FILE = 'LETTERS-SHORTLIST.json';
const APPLIED_IDS_FILE = 'hh-applied-ids.txt';
const RESULT_LOG = 'hh-apply-results.jsonl';

function readAppliedIds() {
  if (!fs.existsSync(APPLIED_IDS_FILE)) return [];
  return fs.readFileSync(APPLIED_IDS_FILE, 'utf8')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readLetters() {
  return JSON.parse(fs.readFileSync(LETTERS_FILE, 'utf8'));
}

/**
 * Что ещё не отправлено, по порядку шорт-листа.
 * @returns {Array<{id:string,title:string,company:string,letter:string}>}
 */
function pending() {
  const done = readAppliedIds();
  return readLetters()
    .filter((r) => done.indexOf(r.id) < 0)
    .map((r) => ({ id: r.id, title: r.title, company: r.company, letter: r.letter }));
}

/** Сколько всего в шорт-листе, сколько отправлено, сколько осталось. */
function stats() {
  const all = readLetters();
  const done = readAppliedIds();
  const sent = all.filter((r) => done.indexOf(r.id) >= 0);
  return {
    total: all.length,
    sent: sent.length,
    left: all.length - sent.length,
    sentIds: sent.map((r) => r.id),
    nextId: (pending()[0] || {}).id || null,
  };
}

/**
 * Письмо для вакансии. Пишет в stdout, чтобы вызывающий код мог забрать текст
 * и передать его в страницу: обратно в node письмо попадать не должно, оно
 * уже здесь.
 * @param {string} id
 */
function letterFor(id) {
  const row = readLetters().find((r) => r.id === id);
  if (!row) throw new Error('нет письма для ' + id);
  return row.letter;
}

/** URL вакансии для навигации. */
function urlFor(id) {
  return 'https://zarechny.hh.ru/vacancy/' + id;
}

/** Скрипт страницы для отправки отклика с уже заполненным письмом. */
function applyScriptFor(id) {
  return applyScripts.apply(letterFor(id));
}

/**
 * Записывает результат одной попытки. Пишет в jsonl для аудита и, если отклик
 * ушёл, добавляет id в список отправленных — иначе дедуп в поиске будет
 * предлагать её снова и снова.
 *
 * @param {{id:string,title?:string,company?:string,result:string,letterLen?:number,steps?:string[]}} r
 */
function record(r) {
  if (!r || !r.id || !r.result) throw new Error('нужны id и result');
  const entry = {
    at: new Date().toISOString(),
    id: r.id,
    title: r.title || '',
    company: r.company || '',
    result: r.result,
    letterLen: typeof r.letterLen === 'number' ? r.letterLen : null,
    steps: r.steps || [],
  };
  fs.appendFileSync(RESULT_LOG, JSON.stringify(entry) + '\n', 'utf8');

  if (r.result === 'SENT' || r.result === 'SENT_WITH_LETTER') {
    const ids = readAppliedIds();
    if (ids.indexOf(r.id) < 0) {
      ids.push(r.id);
      fs.writeFileSync(APPLIED_IDS_FILE, ids.join(','), 'utf8');
    }
  }
  return entry;
}

/** Что ушло, что застряло на капче, что закрыто. */
function resultsSummary() {
  if (!fs.existsSync(RESULT_LOG)) return { attempts: 0, byResult: {} };
  const lines = fs.readFileSync(RESULT_LOG, 'utf8').split('\n').filter(Boolean);
  const byResult = {};
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }
    byResult[row.result] = (byResult[row.result] || 0) + 1;
  }
  return { attempts: lines.length, byResult };
}

module.exports = {
  LETTERS_FILE,
  APPLIED_IDS_FILE,
  RESULT_LOG,
  pending,
  stats,
  letterFor,
  urlFor,
  applyScriptFor,
  record,
  resultsSummary,
};
