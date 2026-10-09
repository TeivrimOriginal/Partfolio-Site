// Интерфейс HardSearchWork. Локальный сервер, без сборки и без зависимостей.
//
// Что показывает и зачем:
//   Очередь      — вакансии, прошедшие порог, отсортированные по проценту;
//   Письма       — черновики с текстом целиком и разбором скоринга;
//   Контакты     — что нашли по каждой компании и откуда;
//   Отправка     — что уйдёт, по какому каналу и ПОЧЕМУ остальное не уйдёт;
//   LeaksData    — то, что ниже порога 50, с причиной отсева;
//   Отправлено   — история: куда, когда, с каким результатом.
//
// Процент приёма — не обещание, а разложенный на части показатель. Рядом с
// каждой цифрой стоит, из чего она сложилась, иначе это просто красивое число.

import http from 'node:http';
import tls from 'node:tls';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, stats, sharedEmails, dispatchFor, recordDispatch } from './db.mjs';
import { resumeForStack } from './resumes.mjs';
import { pickChannel } from './target.mjs';
import { planBatch, prepareVacancy, markSent, mailto, shortText, CHANNEL_ACTION } from './send.mjs';
import { scanBrowser, BROWSER_SITES, MAIL_SITES } from './browser-sessions.mjs';
import { THRESHOLD } from './score.mjs';

const PORT = Number(process.env.HSW_PORT || 8787);

const db = openDb();

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `
:root{
  --bg:#0a0d14; --panel:#121826; --panel2:#182032; --line:#242e42; --line2:#2f3b52;
  --tx:#e9edf5; --dim:#8a95ad; --acc:#5b8cff; --acc2:#8b5cf6; --ok:#2ecc8f;
  --warn:#f5a524; --bad:#ff5f5f; --r:14px;
  --shadow:0 12px 32px rgba(0,0,0,.38);
  --head:linear-gradient(180deg,rgba(10,13,20,.96),rgba(10,13,20,.82));
}
html[data-theme=light]{
  --bg:#f4f7fc; --panel:#ffffff; --panel2:#f1f5fb; --line:#e3e9f4; --line2:#d3ddec;
  --tx:#131826; --dim:#5d6880;
  --shadow:0 10px 28px rgba(25,40,80,.09);
  --head:linear-gradient(180deg,rgba(255,255,255,.97),rgba(255,255,255,.85));
}
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:
    radial-gradient(1200px 600px at 12% -8%,rgba(91,140,255,.14),transparent 60%),
    radial-gradient(900px 500px at 92% -12%,rgba(139,92,246,.12),transparent 60%),
    var(--bg);
  color:var(--tx); font:14.5px/1.6 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;
  min-height:100vh; -webkit-font-smoothing:antialiased;
}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
header{position:sticky;top:0;z-index:20;background:var(--head);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.wrap{max-width:1220px;margin:0 auto;padding:0 20px}
.brand{display:flex;align-items:center;gap:12px;padding:16px 0 12px}
.logo{width:34px;height:34px;border-radius:11px;flex:none;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 6px 18px rgba(91,140,255,.35)}
.logo svg{width:19px;height:19px;fill:#fff}
.brand h1{font-size:17px;font-weight:700;letter-spacing:.2px}
.brand .sub{color:var(--dim);font-size:12.5px}
.brand .sp{flex:1}
.iconbtn{border:1px solid var(--line);background:var(--panel);color:var(--dim);border-radius:10px;
  padding:6px 11px;font-size:12.5px;cursor:pointer;font-family:inherit}
.iconbtn:hover{border-color:var(--acc);color:var(--acc);text-decoration:none}
nav{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:12px}
nav a{padding:7px 13px;border-radius:999px;color:var(--dim);font-size:13px;border:1px solid transparent;
  display:inline-flex;align-items:center;gap:7px;transition:.15s}
nav a:hover{background:var(--panel2);color:var(--tx);text-decoration:none}
nav a.on{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;box-shadow:0 6px 16px rgba(91,140,255,.28)}
nav a .n{font-variant-numeric:tabular-nums;font-size:12px;opacity:.75;
  background:rgba(127,145,180,.16);border-radius:999px;padding:1px 7px}
nav a.on .n{background:rgba(255,255,255,.22);opacity:.95}
main{padding:22px 0 64px;animation:fade .25s ease}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px;margin-bottom:22px}
.card{position:relative;overflow:hidden;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);padding:14px 16px;box-shadow:var(--shadow)}
.card::after{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:var(--acc);opacity:.75}
.card.good::after{background:var(--ok)} .card.warnv::after{background:var(--warn)}
.card.badv::after{background:var(--bad)} .card.violet::after{background:var(--acc2)}
.card .k{color:var(--dim);font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.card .v{font-size:26px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.card .d{color:var(--dim);font-size:12px;margin-top:2px}
.card.good .v{color:var(--ok)} .card.warnv .v{color:var(--warn)} .card.badv .v{color:var(--bad)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--shadow);overflow:hidden;margin-bottom:18px}
.panel > .head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line)}
.panel > .head h2{font-size:14.5px;font-weight:700}
.panel > .head .sub{color:var(--dim);font-size:12.5px}
.panel > .head .sp{flex:1}
.panel .pad{padding:16px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
thead th{text-align:left;padding:10px 14px;background:var(--panel2);
  color:var(--dim);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;
  border-bottom:1px solid var(--line);white-space:nowrap}
tbody td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover td{background:rgba(91,140,255,.055)}
tbody td a{font-weight:600}
.num{font-variant-numeric:tabular-nums}
.pct{display:inline-flex;align-items:center;justify-content:center;min-width:46px;padding:3px 8px;
  border-radius:8px;font-weight:700;font-variant-numeric:tabular-nums;font-size:13px}
.p0{background:rgba(255,95,95,.15);color:#ff8f8f}
.p1{background:rgba(245,165,36,.16);color:#ffc46b}
.p2{background:rgba(46,204,143,.15);color:#5fe3b0}
html[data-theme=light] .p0{color:#c62b2b}
html[data-theme=light] .p1{color:#9a6100}
html[data-theme=light] .p2{color:#127a54}
.tag{display:inline-block;padding:2px 8px;border-radius:7px;background:var(--panel2);
  border:1px solid var(--line);color:var(--dim);font-size:11.5px;margin:2px 4px 2px 0}
.tag.hot{border-color:#7a4a12;color:#ffc46b;background:rgba(245,165,36,.1)}
.tag.ok{border-color:#1f6b4e;color:#5fe3b0;background:rgba(46,204,143,.1)}
.tag.bad{border-color:#7a2b2b;color:#ff8f8f;background:rgba(255,95,95,.1)}
.tag.acc{border-color:#2f4a86;color:#a9c4ff;background:rgba(91,140,255,.12)}
html[data-theme=light] .tag.acc{border-color:#b9cdfb;color:#2b55c4}
html[data-theme=light] .tag.ok{border-color:#b6e6d3;color:#127a54}
html[data-theme=light] .tag.bad{border-color:#f3c2c2;color:#c62b2b}
html[data-theme=light] .tag.hot{border-color:#f3d9a8;color:#9a6100}
.muted{color:var(--dim)} .small{font-size:12.5px}
.mono{font-family:"Cascadia Mono",Consolas,"Courier New",monospace}
.pre{white-space:pre-wrap;background:var(--panel2);border:1px solid var(--line);border-radius:12px;
  padding:16px;font:13.5px/1.7 "Cascadia Mono",Consolas,monospace;max-height:520px;overflow:auto}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.btn{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:10px;background:var(--panel2);
  border:1px solid var(--line);color:var(--tx);cursor:pointer;font-size:13px;font-family:inherit;transition:.15s}
.btn:hover{border-color:var(--acc);color:var(--acc);text-decoration:none;transform:translateY(-1px)}
.btn.pri{background:linear-gradient(135deg,var(--acc),var(--acc2));border-color:transparent;color:#fff;
  box-shadow:0 6px 16px rgba(91,140,255,.28)}
.btn.ok{border-color:#1f6b4e;color:#5fe3b0}
.btn[disabled]{opacity:.45;cursor:not-allowed;transform:none}
form.inline{display:inline-flex}
.bar{height:8px;border-radius:99px;background:var(--panel2);overflow:hidden;min-width:120px;flex:1}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--ok))}
.parts{margin-top:10px}
.parts .p{display:flex;gap:12px;padding:6px 0;border-bottom:1px dashed var(--line)}
.parts .p:last-child{border-bottom:none}
.parts .p b{min-width:104px;color:var(--dim);font-weight:600;font-size:12.5px}
.empty{color:var(--dim);padding:38px 24px;text-align:center;background:var(--panel);border:1px dashed var(--line2);
  border-radius:var(--r)}
.empty b{color:var(--tx)}
.reasons{display:grid;gap:8px}
.reason{display:flex;gap:12px;align-items:baseline;padding:9px 12px;background:var(--panel2);
  border:1px solid var(--line);border-radius:10px}
.reason b{min-width:38px;text-align:right;color:var(--warn);font-variant-numeric:tabular-nums}
.foot{color:var(--dim);font-size:12.5px;margin-top:26px;padding-top:16px;border-top:1px solid var(--line)}
.toast{position:fixed;right:20px;bottom:20px;z-index:50;max-width:460px;padding:13px 16px;border-radius:12px;
  background:var(--panel);border:1px solid var(--line2);box-shadow:var(--shadow);animation:fade .2s ease}
.toast.good{border-color:#1f6b4e} .toast.bad{border-color:#7a2b2b}
.toast .t{font-weight:700;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
.toast .m{margin-top:4px}
.toast.good .t{color:var(--ok)} .toast.bad .t{color:var(--bad)}
.grid2{display:grid;grid-template-columns:1.35fr 1fr;gap:18px;align-items:start}
@media(max-width:900px){.grid2{grid-template-columns:1fr}.brand .sub{display:none}}
details{border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-top:14px;overflow:hidden}
summary{cursor:pointer;padding:12px 16px;color:var(--dim);font-size:13px;user-select:none}
summary:hover{color:var(--tx)}
details .pre{margin:0;border:none;border-top:1px solid var(--line);border-radius:0;max-height:420px}

/* ------------------------------------------------------ главная редакция */
.desk-head{display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;margin-bottom:18px;
  padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--shadow)}
.desk-title{font-size:21px;font-weight:700;letter-spacing:-.2px}
.desk-sub{color:var(--dim);font-size:13px;margin-top:4px;max-width:70ch}
.desk-meter{margin-left:auto;min-width:230px}
.desk-meter-n{display:flex;align-items:baseline;gap:7px;margin-bottom:7px}
.desk-meter-n b{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.desk-meter-n span{color:var(--dim);font-size:12.5px}
.desk-list{display:grid;gap:16px;margin-bottom:18px}
.letter{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--shadow);padding:18px 20px;position:relative}
.letter.first{border-color:var(--acc);box-shadow:0 0 0 1px rgba(91,140,255,.35),var(--shadow)}
.letter.first::before{content:"первая отправка";position:absolute;top:-9px;left:18px;font-size:11px;
  background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;padding:2px 9px;border-radius:999px;
  letter-spacing:.03em}
.letter-top{display:flex;gap:14px;align-items:flex-start}
.letter-badge{width:30px;height:30px;flex:none;border-radius:9px;display:grid;place-items:center;
  background:var(--panel2);border:1px solid var(--line);color:var(--dim);font-weight:700;font-size:13px}
.letter.first .letter-badge{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;border-color:transparent}
.letter-head{flex:1;min-width:0}
.letter-head h2{font-size:16px;font-weight:700;line-height:1.35}
.letter-meta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:var(--dim);font-size:12.5px;margin-top:5px}
.letter-pct{flex:none;text-align:center;padding:6px 12px;border-radius:12px;background:var(--panel2);border:1px solid var(--line)}
.letter-pct b{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;display:block;line-height:1.1}
.letter-pct span{color:var(--dim);font-size:11.5px}
.letter-pct.hi b{color:var(--ok)} .letter-pct.mid b{color:var(--warn)} .letter-pct.lo b{color:var(--bad)}
.prob{display:flex;gap:12px;align-items:center;margin-top:14px}
.prob .bar{max-width:280px}
.prob span{color:var(--dim);font-size:12.5px}
.dest{display:grid;grid-template-columns:110px 1fr 200px 230px;gap:12px;margin-top:14px;
  padding:12px 14px;background:var(--panel2);border:1px solid var(--line);border-radius:12px}
.dest-block{display:flex;flex-direction:column;gap:3px;min-width:0}
.dest-k{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.dest-v{font-size:13px;word-break:break-word}
.dest-w{color:var(--dim);font-size:12px}
.why{margin-top:12px}
.why summary{font-size:12.5px;padding:9px 2px}
.why-parts{border-top:1px dashed var(--line);padding-top:8px}
.part{display:flex;gap:12px;padding:4px 0;font-size:12.5px}
.part-n{min-width:96px;color:var(--dim);font-weight:600}
.part-v{min-width:44px;font-variant-numeric:tabular-nums}
.part-v.full{color:var(--ok)} .part-v.zero{color:var(--bad)}
.part-w{color:var(--dim)}
.desk-actions{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:16px;
  padding-top:14px;border-top:1px solid var(--line)}
.desk-reject{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.desk-send{margin-left:auto;display:flex;gap:10px;align-items:center}
.btn.ghost{background:transparent;color:var(--dim)}
.btn.ghost:hover{border-color:var(--bad);color:var(--bad)}

/* --------------------------------------------------------- привязки */
.acc-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 16px;
  border-bottom:1px solid var(--line);background:rgba(127,145,180,.04)}
.acc-form-k{color:var(--dim);font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;
  font-weight:600;margin-right:4px}
@media(max-width:1100px){.acc-form .inp{flex:1 1 140px;width:auto}}
.inp{background:var(--panel2);border:1px solid var(--line);color:var(--tx);border-radius:9px;
  padding:7px 10px;font:12.5px "Segoe UI",system-ui,sans-serif;width:150px}
.inp.narrow{width:120px}
.inp:focus{outline:none;border-color:var(--acc)}
`;

const TABS = [
  ['desk', 'Главная'],
  ['queue', 'Очередь'],
  ['letters', 'Письма'],
  ['send', 'Отправка'],
  ['sent', 'Отправлено'],
  ['accounts', 'Привязки'],
  ['contacts', 'Контакты'],
  ['leaks', 'LeaksData'],
];

function countsOf(s) {
  const passed = s.queues.scored + s.queues.drafted;
  const desk = deskCounts();
  return {
    desk: desk.waiting,
    queue: passed,
    letters: s.letters,
    contacts: s.contacts,
    send: passed,
    sent: s.queues.sent,
    accounts: desk.accounts,
    leaks: s.queues.leaks,
  };
}

function header(active, s) {
  const c = countsOf(s);
  return `<header><div class="wrap">
  <div class="brand">
    <span class="logo"><svg viewBox="0 0 24 24"><path d="M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z"/></svg></span>
    <h1>HardSearchWork</h1>
    <span class="sub">удалённо · без опыта · без высшего — порог отправки ${THRESHOLD}/100</span>
    <span class="sp"></span>
    <button class="iconbtn" id="themeBtn">Светлая тема</button>
    <a class="iconbtn" href="/">Обновить</a>
  </div>
  <nav>${TABS.map(([k, label]) =>
    `<a href="/?tab=${k}" class="${k === active ? 'on' : ''}">${label}<span class="n">${c[k] ?? 0}</span></a>`).join('')}</nav>
</div></header>`;
}

// Опыт на hh приходит внутренним кодом: between1and3, moreThan6. В таблице это
// читалось как «between1and3» — служебный словарь площадки вместо формулировки
// на языке вакансии.
const EXPERIENCE = {
  noExperience: 'без опыта',
  between1And3: '1–3 года',
  between3And6: '3–6 лет',
  moreThan6: 'более 6 лет',
};
const experienceText = (v) => EXPERIENCE[v] || v || '—';

function pctCell(v) {
  const cls = v >= 75 ? 'p2' : v >= THRESHOLD ? 'p1' : 'p0';
  return `<span class="pct ${cls}">${v ?? '—'}</span>`;
}

function metricCards(s) {
  const q = s.queues;
  const passed = q.scored + q.drafted;
  return `<div class="cards">
    <div class="card"><div class="k">вакансий в базе</div><div class="v">${s.vacancies}</div>
      <div class="d">${s.matching} под фильтры ТЗ</div></div>
    <div class="card good"><div class="k">прошли порог ${THRESHOLD}+</div><div class="v">${passed}</div>
      <div class="d">очередь на письма</div></div>
    <div class="card violet"><div class="k">писем</div><div class="v">${s.letters}</div>
      <div class="d">черновиков в базе</div></div>
    <div class="card ${s.contacts > 0 ? 'good' : 'badv'}"><div class="k">контактов</div><div class="v">${s.contacts}</div>
      <div class="d">по ${s.companies} компаниям</div></div>
    <div class="card ${q.sent > 0 ? 'good' : 'warnv'}"><div class="k">отправлено</div><div class="v">${q.sent}</div>
      <div class="d">подтверждено фактом</div></div>
    <div class="card badv"><div class="k">в LeaksData</div><div class="v">${q.leaks}</div>
      <div class="d">ниже порога, с причиной</div></div>
  </div>`;
}

/** Разбор скоринга подробно — без него процент невозможно оспорить. */
function partsBlock(fitWhy) {
  if (!fitWhy) return '';
  let why;
  try { why = JSON.parse(fitWhy); } catch { return ''; }
  const parts = (why.parts || []).map((p) =>
    `<div class="p"><b>${esc(p.name)} ${p.got}/${p.max}</b><span>${esc((p.why || []).join('; '))}</span></div>`).join('');
  const miss = (why.missing || []).length
    ? `<div class="small muted" style="margin-top:8px">не закрыто навыками: ${esc(why.missing.join(', '))}</div>` : '';
  const verdict = why.verdict ? `<div class="small" style="margin-top:8px">${esc(why.verdict)}</div>` : '';
  return `<div class="parts">${parts}${miss}${verdict}</div>`;
}

function panel(title, sub, inner, actions = '') {
  return `<section class="panel">
    <div class="head"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${sub}</span>` : ''}<span class="sp"></span>${actions}</div>
    ${inner}
  </section>`;
}

function statusTag(status) {
  const map = {
    sent: ['ok', 'отправлено'], prepared: ['acc', 'подготовлено'],
    approved: ['acc', 'подготовлено'], draft: ['', 'черновик'], failed: ['bad', 'ошибка'],
  };
  const [cls, label] = map[status] || ['', status];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}

// ------------------------------------------------------- главная редакция
//
// Здесь решение принимает человек, и решение видно целиком: что за вакансия,
// кому уйдёт письмо, по какому каналу, что будет приложено, сколько стоит
// в процентах письмо и почему столько. Кнопки «Отклонить» и «Подтвердить» —
// единственное место в системе, где письмо вообще может уйти.
//
// Отдельно держится порядок: письмо подтверждается по порядку, а не как
// попало, и максимум на день (HSW_DESK_DAILY, по умолчанию 20). Без потолка
// список превращается в очередь, которую человек не успевает прочитать, а
// читать он обязан: адресат живой.
const REJECT_REASONS = [
  ['не та вакансия', 'похоже, что стек или формат не совпали'],
  ['не тот адресат', 'письмо уходит не тому, кто нанимает'],
  ['плохое резюме', 'в письме то, чего нет в резюме, или наоборот'],
  ['уже откликался', 'ответ был, повтор не нужен'],
  ['не сейчас', 'срок подходит, но вакансия не горит'],
];

function deskCounts() {
  const waiting = db.prepare(`
    SELECT COUNT(*) c FROM vacancies v
    WHERE v.status IN ('scored','drafted') AND v.stack IS NOT NULL AND v.percent >= ?
  `).get(THRESHOLD).c;
  const accounts = db.prepare('SELECT COUNT(*) c FROM accounts').get().c;
  return { waiting, accounts };
}

function tabDesk(db, message = '') {
  const s = stats(db);
  const dailyLimit = Number(process.env.HSW_DESK_DAILY || 20);
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = db.prepare("SELECT COUNT(*) c FROM dispatches WHERE status = 'sent' AND sent_at >= ?")
    .get(`${today}T00:00:00.000Z`).c;
  const remaining = Math.max(0, dailyLimit - sentToday);

  // Очередь редакции: процент выше — раньше. Отправленное и отклонённое
  // уходят в конец списка, а не исчезают: решение человека должно быть видно.
  const { plan, reasons } = planBatch(db, { batch: 40, resumeText: resumeText(), writeLetters: false });

  const rejected = db.prepare(`
    SELECT d.vacancy_id, d.note, d.sent_at, v.title, v.company, v.percent
    FROM dispatches d JOIN vacancies v ON v.id = d.vacancy_id
    WHERE d.status IN ('rejected','prepared')
    ORDER BY d.id DESC LIMIT 12
  `).all();

  const cards = plan.map((p, i) => {
    const v = p.vacancy;
    let why = {};
    try { why = JSON.parse(v.fit_why || '{}'); } catch { why = {}; }
    const dispatch = db.prepare('SELECT * FROM dispatches WHERE vacancy_id = ?').get(v.id);
    const isFirst = i === 0 && !rejected.length;
    const pct = v.percent || 0;

    const whyRows = (why.parts || []).map((part) => `
      <div class="part">
        <span class="part-n">${esc(part.name)}</span>
        <span class="part-v ${part.got >= part.max ? 'full' : part.got === 0 ? 'zero' : ''}">${part.got}/${part.max}</span>
        <span class="part-w">${esc((part.why || []).join('; '))}</span>
      </div>`).join('');

    const rejectBtns = REJECT_REASONS.map(([reason, hint]) => `
      <form class="inline" method="post" action="/desk/reject?id=${v.id}&channel=${esc(p.target.channel)}">
        <input type="hidden" name="reason" value="${esc(reason)}">
        <button class="btn ghost" title="${esc(hint)}" onclick="return confirm('Отклонить: ${esc(reason)}? Вакансия уйдёт из очереди редакции.')">${esc(reason)}</button>
      </form>`).join('');

    return `<section class="letter ${isFirst ? 'first' : ''}">
      <div class="letter-top">
        <div class="letter-badge">${i + 1}</div>
        <div class="letter-head">
          <h2>${esc(v.title)}</h2>
          <div class="letter-meta">
            <span>${esc(v.company || '—')}</span>
            ${v.stack ? `<span class="tag acc">${esc(v.stack)}</span>` : ''}
            ${v.remote ? '<span class="tag ok">удалённо</span>' : ''}
            ${v.no_experience ? '<span class="tag ok">без опыта</span>' : ''}
            ${v.salary_from ? `<span>${new Intl.NumberFormat('ru-RU').format(v.salary_from)} ₽</span>` : ''}
            ${v.valid_through ? `<span>до ${esc(v.valid_through)}</span>` : ''}
          </div>
        </div>
        <div class="letter-pct ${pct >= 75 ? 'hi' : pct >= THRESHOLD ? 'mid' : 'lo'}">
          <b>${pct}</b><span>/100</span>
        </div>
      </div>

      <div class="prob">
        <div class="prob-bar"><i style="width:${pct}%"></i></div>
        <span>${esc(why.verdict || 'вероятность приёма не разобрана')}</span>
      </div>

      <div class="dest">
        <div class="dest-block">
          <span class="dest-k">канал</span>
          <span class="tag acc">${esc(p.target.channel)}</span>
        </div>
        <div class="dest-block grow">
          <span class="dest-k">кому</span>
          <span class="dest-v mono">${esc(String(p.target.value).slice(0, 70))}</span>
          <span class="dest-w">${esc(p.target.why)}</span>
        </div>
        <div class="dest-block">
          <span class="dest-k">вложение</span>
          <span class="dest-v">${esc(p.resumeName || 'ссылка на резюме')}</span>
        </div>
        <div class="dest-block">
          <span class="dest-k">действие</span>
          <span class="dest-w">${esc(CHANNEL_ACTION[p.target.channel])}</span>
        </div>
      </div>

      <details class="why">
        <summary>Из чего сложились ${pct} баллов</summary>
        <div class="why-parts">${whyRows || '<div class="small muted">разбора нет</div>'}</div>
        ${(why.missing || []).length ? `<div class="small muted" style="margin-top:8px">не закрыто навыками: ${esc(why.missing.join(', '))}</div>` : ''}
      </details>

      <details class="why">
        <summary>Текст письма целиком</summary>
        <div class="pre">${esc(p.letter.body)}</div>
      </details>

      <div class="desk-actions">
        <div class="desk-reject">
          <span class="dest-k">отклонить</span>
          ${rejectBtns}
        </div>
        <div class="desk-send">
          ${dispatch && dispatch.status === 'prepared'
            ? `<span class="small muted">подготовлено: ${esc(String(dispatch.note).slice(0, 60))}</span>`
            : ''}
          <a class="btn" href="/?tab=letter&id=${v.id}">Открыть письмо</a>
          ${remaining > 0 && !isFirst
            ? `<form class="inline" method="post" action="/desk/confirm?id=${v.id}&channel=${esc(p.target.channel)}">
                 <button class="btn pri" onclick="return confirm('Отправить в ${esc(p.target.channel)}? Отправкой управляешь ты — это готовит файл.')">Подтвердить отправку</button>
               </form>`
            : `<button class="btn pri" disabled title="${isFirst ? 'сначала разбери первую отправку' : `дневной лимит исчерпан: ${sentToday}/${dailyLimit}`}">Подтвердить отправку</button>`}
        </div>
      </div>
    </section>`;
  }).join('');

  const reasonsHtml = Object.entries(reasons).sort((a, b) => b[1] - a[1]);

  return `
    <div class="desk-head">
      <div>
        <h1 class="desk-title">Главная редакция</h1>
        <p class="desk-sub">Отправкой управляешь ты. Система готовит письмо, адресата и вложение —
          решение «отправить» здесь, по одному письму за раз.</p>
      </div>
      <div class="desk-meter">
        <div class="desk-meter-n"><b>${sentToday}</b><span>из ${dailyLimit} сегодня</span></div>
        <div class="bar"><i style="width:${Math.min(100, (sentToday / dailyLimit) * 100)}%"></i></div>
        <div class="small muted">осталось подтвердить: ${remaining}</div>
      </div>
    </div>

    ${plan.length
      ? `<div class="desk-list">${cards}</div>`
      : `<div class="empty">Очередь редакции пуста: под порогом ${THRESHOLD} нет вакансий с опубликованным адресом.</div>`}

    <div class="grid2">
      ${panel('Почему не попало в редакцию', 'счётчик по каждой причине',
        reasonsHtml.length
          ? `<div class="pad reasons">${reasonsHtml.map(([why, n]) =>
              `<div class="reason"><b class="num">${n}</b><span>${esc(why)}</span></div>`).join('')}</div>`
          : '<div class="pad small muted">Пропущенных вакансий нет.</div>')}
      ${panel('Решения человека', 'что уже подтверждено или отклонено',
        rejected.length
          ? `<table><tbody>${rejected.map((r) => `<tr>
              <td><a href="/?tab=letter&id=${r.vacancy_id}">${esc(r.title)}</a>
                <div class="small muted">${esc(r.company || '')}</div></td>
              <td class="small">${r.status === 'rejected'
                ? `<span class="tag bad">отклонено: ${esc(r.note)}</span>`
                : '<span class="tag acc">подготовлено</span>'}</td>
              <td class="small muted num">${esc(String(r.sent_at || '').slice(0, 16).replace('T', ' '))}</td>
            </tr>`).join('')}</tbody></table>`
          : '<div class="pad small muted">Решений пока нет. Подтверждённое письмо попадёт сюда, а отклонённое уйдёт в LeaksData с причиной.</div>')}
    </div>`;
}

// ------------------------------------------------------------- привязки
//
// Привязка — это не пароль, а признак «связь настроена»: почтовый ящик или
// площадка. Секреты в базу не кладутся: пароль лежит в переменной окружения,
// и здесь показывается только имя переменной — иначе база, которая уезжает
// на флешку, уезжает вместе с почтой.
//
// Проверка связи настоящая: SMTP получает EHLO по TLS и отвечает кодом, из
// которого известно, требует ли сервер авторизации. Ничего не отправляется и
// никакая почта не читается.
const SERVICES = [
  { key: 'email', name: 'Почта (SMTP)', hint: 'Отправка писем вакансий, отклики по почте' },
  { key: 'emailin', name: 'Чтение почты (IMAP)', hint: 'Отслеживать ответы на отправленные письма' },
  { key: 'hh', name: 'Хабр Карьера (hh)', hint: 'Сбор вакансий и отклики через API' },
  { key: 'hirify', name: 'HiRFY', hint: 'Вакансии и отклики, нужен аккаунт' },
  { key: 'fl', name: 'FL.ru', hint: 'Вакансии фриланса, нужен аккаунт' },
  { key: 'kwork', name: 'Kwork', hint: 'Заказы и отклики, нужен аккаунт' },
  { key: 'telegram', name: 'Telegram', hint: 'Канал откликов и уведомления, нужен API-токен' },
  { key: 'linkedin', name: 'LinkedIn', hint: 'Вакансии, нужен вход' },
];

const ENV_BY_SERVICE = {
  email: ['HSW_SMTP_HOST', 'HSW_SMTP_PORT', 'HSW_SMTP_USER', 'HSW_SMTP_PASS', 'HSW_MAIL_FROM'],
  emailin: ['HSW_IMAP_HOST', 'HSW_IMAP_USER', 'HSW_IMAP_PASS'],
  hh: ['HSW_HH_TOKEN'],
  hirify: ['HSW_HIRIFY_TOKEN'],
  fl: ['HSW_FL_TOKEN'],
  kwork: ['HSW_KWORK_TOKEN'],
  telegram: ['HSW_TG_TOKEN'],
  linkedin: ['HSW_LINKEDIN_TOKEN'],
};

/**
 * Разбор адреса из значения: «Иван» → display, «Петя <petya@yandex.ru>» →
 * display и login, «a@b.ru» → login. Кавычки снимаются, чтобы HTML-экранирование
 * не оставляло в поле мусор.
 */
function parseAccount(login, display) {
  const raw = String(login || '').trim().replace(/^["']|["']$/g, '');
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { login: m[2].trim(), display: (display || m[1]).trim() || m[2].trim() };
  return { login: raw, display: (display || raw).trim() };
}

/** Привязки, у которых посчитано: чего не хватает и что отправлено сегодня. */
function accounts(db) {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY service, login').all();
  const today = new Date().toISOString().slice(0, 10);
  const sent = db.prepare(`
    SELECT a.id, COUNT(d.id) n FROM accounts a
    LEFT JOIN dispatches d ON d.channel = a.service AND d.status = 'sent'
      AND d.sent_at >= ? AND d.target = a.login
    GROUP BY a.id
  `).all(`${today}T00:00:00.000Z`);
  const sentMap = new Map(sent.map((r) => [r.id, r.n]));
  return rows.map((r) => {
    const env = ENV_BY_SERVICE[r.service] || [];
    const missing = env.filter((k) => !process.env[k]);
    return {
      ...r,
      envKeys: env,
      missing,
      ok: r.enabled === 1 && missing.length === 0,
      today: sentMap.get(r.id) || 0,
    };
  });
}

const serviceMeta = (key) => SERVICES.find((s) => s.key === key)
  || { key, name: key, hint: '' };

/**
 * Настоящая проверка связи с почтовым сервером: TLS плюс EHLO. Ничего не
 * отправляется и ни один ящик не открывается на чтение.
 */
function smtpProbe(host, port) {
  return new Promise((resolve) => {
    let socket = null;
    const timer = setTimeout(() => { if (socket) socket.destroy(); resolve({ ok: false, detail: 'таймаут ответа' }); }, 12000);
    try {
      socket = tls.connect({ host, port: Number(port || 587), servername: host }, () => {
        socket.write('EHLO localhost\r\n');
      });
      socket.setEncoding('utf8');
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk;
        const m = buf.match(/^(\d{3})([ -])([^\n]*)\r?\n/);
        if (!m) return;
        clearTimeout(timer);
        const caps = buf.slice(m[0].length);
        socket.destroy();
        resolve({
          ok: m[1] === '220',
          detail: m[1] === '220'
            ? `сервер ответил, ${/\bAUTH\b/i.test(caps) ? 'авторизация есть' : 'без авторизации'}`
            : `ответ ${m[1]} ${m[3].trim()}`,
        });
      });
      socket.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, detail: e.message }); });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, detail: e.message });
    }
  });
}
function toast(message) {
  if (!message) return '';
  const good = message.startsWith('готово');
  return `<div class="toast ${good ? 'good' : 'bad'}">
    <div class="t">${good ? 'готово' : 'не получилось'}</div>
    <div class="m">${esc(message.replace(/^готово:\s*/i, ''))}</div>
  </div>`;
}

function page(tab, body, s, message = '', theme = 'dark') {
  return `<!DOCTYPE html><html lang="ru" data-theme="${theme === 'light' ? 'light' : 'dark'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HardSearchWork — ${esc(tab)}</title><style>${CSS}</style></head><body>
${header(tab, s)}
<main class="wrap">
${metricCards(s)}
${body}
<div class="foot">Отправка: система готовит письмо с вложенным резюме и адресатом
(только опубликованным компанией), нажатие «отправить» — за человеком.
Процент — разложенный показатель, а не обещание. Подробности: <span class="mono">HSW-SEND.md</span>.</div>
</main>
${toast(message)}
<script>
  const root = document.documentElement;
  const btn = document.getElementById('themeBtn');
  const label = () => { btn.textContent = root.dataset.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'; };
  // Тема из адреса (?theme=light) главнее запомненной и сразу запоминается:
  // иначе следующая страница вернула бы тёмную, и ссылка из терминала
  // работала бы через раз.
  const forced = new URLSearchParams(location.search).get('theme');
  const saved = forced || localStorage.getItem('hsw-theme');
  if (saved) root.dataset.theme = saved;
  if (forced) localStorage.setItem('hsw-theme', forced);
  label();
  btn.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('hsw-theme', root.dataset.theme);
    label();
  });
  const tt = document.querySelector('.toast');
  if (tt) setTimeout(() => tt.remove(), 9000);
</script>
</body></html>`;
}
// ------------------------------------------------------------- вкладки

function tabQueue(db) {
  const rows = db.prepare(`
    SELECT v.*, (SELECT COUNT(*) FROM contacts c WHERE c.company_key = v.company_key) AS contacts_n,
           (SELECT COUNT(*) FROM dispatches d WHERE d.vacancy_id = v.id AND d.status='sent') AS channels_n
    FROM vacancies v
    WHERE v.status IN ('scored','drafted')
    ORDER BY v.urgent DESC, v.percent DESC, v.valid_through ASC
  `).all();

  if (!rows.length) {
    return `<div class="empty">Очередь пуста.<br><br>
      <span class="mono">node hsw/collect.mjs</span> — собрать вакансии,<br>
      <span class="mono">node hsw/run-score.mjs</span> — посчитать проценты.</div>`;
  }

  const body = `<table>
    <thead><tr>
      <th style="width:70px">%</th><th>Вакансия</th><th style="width:160px">Компания</th>
      <th style="width:120px">Стек</th><th style="width:110px">Опыт</th><th style="width:120px">Зарплата</th>
      <th style="width:90px">Контакты</th><th style="width:120px">Действует</th>
    </tr></thead><tbody>` +
  rows.map((v) => {
    const days = v.valid_through ? Math.round((new Date(v.valid_through) - Date.now()) / 86400000) : null;
    const hot = v.urgent ? ' <span class="tag hot">горит</span>' : '';
    const money = v.salary_from
      ? `${new Intl.NumberFormat('ru-RU').format(v.salary_from)} ₽`
      : '<span class="muted">не указана</span>';
    return `<tr>
      <td>${pctCell(v.percent)}</td>
      <td><a href="/?tab=letter&id=${v.id}">${esc(v.title)}</a>${hot}
        <div class="small muted">${esc(v.city || '')}${v.schedule ? ' · ' + esc(v.schedule) : ''}</div></td>
      <td>${esc(v.company || '—')}</td>
      <td>${v.stack ? `<span class="tag acc">${esc(v.stack)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="small">${v.no_experience ? '<span class="tag ok">без опыта</span>' : esc(experienceText(v.experience))}</td>
      <td class="small num">${money}</td>
      <td class="small num">${v.contacts_n || 0}</td>
      <td class="small">${esc(v.valid_through || '—')}${days !== null ? `<div class="muted">${days > 0 ? `ещё ${days} дн` : 'срок истёк'}</div>` : ''}</td>
    </tr>`;
  }).join('') + '</tbody></table>';

  const top = rows[0];
  const detail = top ? panel(
    `Разбор верхней вакансии: ${top.title}`,
    `${top.percent}/100 · ${esc(top.company || '—')}`,
    `<div class="pad">
      <div class="row"><div class="bar"><i style="width:${top.percent}%"></i></div><b class="num">${top.percent}/100</b></div>
      ${partsBlock(top.fit_why)}
    </div>`,
    `<a class="btn" href="/?tab=letter&id=${top.id}">Открыть письмо</a>`,
  ) : '';

  return panel('Очередь отправки', `${rows.length} вакансий прошли порог`, body) + detail;
}

function tabLetters(db) {
  const rows = db.prepare(`
    SELECT l.id, l.subject, l.fit_score, l.status, l.created,
           v.id AS vid, v.title, v.company, v.stack, v.percent
    FROM letters l JOIN vacancies v ON v.id = l.vacancy_id
    ORDER BY l.id DESC
  `).all();
  if (!rows.length) {
    return `<div class="empty">Писем нет.<br><br><span class="mono">node hsw/run-letters.mjs 10 0</span></div>`;
  }
  // Письма, оставшиеся от старых запусков, помечаются, а не удаляются: они
  // чужие данные пользователя, но отправлять их система не даст — вакансия
  // ниже порога или вообще не разработка. Молча показывать их в списке значит
  // показать то, что нельзя использовать.
  const stale = rows.filter((r) => !r.stack || (r.percent || 0) < THRESHOLD).length;
  const body = `<table>
    <thead><tr><th style="width:70px">%</th><th>Тема письма</th><th style="width:190px">Компания</th>
      <th style="width:140px">Статус</th><th style="width:160px">Создано</th></tr></thead><tbody>` +
  rows.map((r) => `<tr>
    <td>${pctCell(r.fit_score)}</td>
    <td><a href="/?tab=letter&id=${r.vid}">${esc(r.subject)}</a>
      <div class="small muted">${esc(r.title)}</div>
      ${!r.stack ? '<span class="tag bad">не-разработка, не отправится</span>' : ''}
      ${r.stack && (r.percent || 0) < THRESHOLD ? `<span class="tag bad">ниже порога ${THRESHOLD}, не отправится</span>` : ''}</td>
    <td>${esc(r.company || '—')}</td>
    <td class="small">${statusTag(r.status)}</td>
    <td class="small muted num">${esc(String(r.created).slice(0, 16).replace('T', ' '))}</td>
  </tr>`).join('') + '</tbody></table>';
  const note = stale
    ? `<div class="pad small muted" style="border-bottom:1px solid var(--line)">
        ${stale} из ${rows.length} писем — от старых запусков: вакансия ниже порога или не разработка.
        Отправить их система не даст; пересоздать: <span class="mono">node hsw/run-letters.mjs 10 0</span>.
      </div>`
    : '';
  return panel('Письма', `${rows.length} штук, текст целиком и разбор скоринга`, note + body);
}

function tabContacts(db) {
  const rows = db.prepare(`
    SELECT c.company_key, c.kind, c.value, c.note, c.first_seen,
      (SELECT company FROM vacancies v WHERE v.company_key = c.company_key LIMIT 1) AS company,
      (SELECT COUNT(*) FROM vacancies v WHERE v.company_key = c.company_key) AS vacancies_n
    FROM contacts c ORDER BY c.company_key, c.kind
  `).all();
  if (!rows.length) {
    return `<div class="empty">Контактов нет.<br><br><span class="mono">node hsw/collect-contacts.mjs 20</span></div>`;
  }
  const body = `<div class="pad small muted" style="border-bottom:1px solid var(--line)">
      Только то, что компания публикует сама. Контакты площадок (аккаунты hh, сервисы вроде setka.ru)
      и общие ящики агрегаторов в базу не попадают.
    </div>
    <table><thead><tr><th>Компания</th><th style="width:130px">Тип</th><th>Значение</th>
      <th style="width:100px">Вакансий</th><th style="width:120px">Найдено</th></tr></thead><tbody>` +
  rows.map((r) => `<tr>
    <td>${esc(r.company || r.company_key)}</td>
    <td class="small"><span class="tag">${esc(r.kind)}</span></td>
    <td><a href="${esc(r.value)}" target="_blank" rel="noopener">${esc(r.value)}</a>
      ${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td>
    <td class="small num">${r.vacancies_n}</td>
    <td class="small muted num">${esc(String(r.first_seen).slice(0, 10))}</td>
  </tr>`).join('') + '</tbody></table>';
  return panel('Контакты компаний', `${rows.length} записей`, body);
}

// Экран отправки: план (что уйдёт) и причины (почему остальное не уйдёт).
// До send.mjs такого экрана не было: система молчала о том, что умеет и чего
// не умеет, и «0 отправок» выглядело как «нечего отправлять».
// ------------------------------------------------------- автопривязка
//
// Кнопка «привязать из браузера» делает то, что человек делал руками: открывал
// каждую площадку, смотрел, есть ли вход, и отмечал это. Теперь это делает
// скан профилей Chrome/Edge/Brave.
//
// Что появляется в базе: строка accounts с service, login-заглушкой (домен
// площадки, а не выдуманный адрес), note с именем профиля и датой проверки.
// Что НЕ появляется: значения кук. Значение сессии — это пароль в открытом
// виде, и тащить его в базу, которая лежит рядом с письмами и отчётами, нельзя.
// Автопривязка отвечает на вопрос «где есть вход», а не «вынесу ли токен».
//
// Честность состояний: in — вход доказан маркерами; maybe — домен в куках есть,
// но признак входа для этой площадки неизвестен; none — профиль прочитан и
// площадки там нет; locked — файл держит браузер, это «не проверено», а не
// «входа нет». Три из четырёх состояний требуют слов, поэтому подпись в
// интерфейсе длиннее, чем цвет кружка.

const STATE_LABEL = {
  in: ['ok', 'вход есть'],
  maybe: ['hot', 'возможно, вход не подтверждён'],
  out: ['', 'входа нет'],
  none: ['', 'не найдено'],
  locked: ['', 'не проверено: файл держит браузер'],
};

/** Профиль, в котором площадка была видна. Для note — чтобы человек знал, откуда. */
/** Подпись состояния площадки в одну строку — в шаблоне это вызывается, а не повторяется. */
function stateTag(site) {
  const key = site.locked && !site.found ? 'locked' : site.state;
  const [cls, label] = STATE_LABEL[key] || STATE_LABEL.none;
  return { cls, label };
}

/** Имена кук строкой: первые восемь, остальные — счётчиком. */
function cookieList(site) {
  const names = site.cookieNames.slice(0, 8).join(', ');
  return site.cookieNames.length > 8 ? `${names} … ещё ${site.cookieNames.length - 8}` : names;
}

/** Срок и шифрование — одной строкой под именами кук. */
function expiryLine(site) {
  if (!site.latestExpiry) return '';
  return `<div class="small muted" style="font-family:inherit">до ${esc(site.latestExpiry)}${site.encrypted ? ' · значения в шифре' : ''}</div>`;
}

function profileLabel(site) {
  return (site.profilesInfo || []).map((p) => p.profile).join(', ') || 'профиль не указан';
}

/**
 * Создать или обновить привязку по найденной сессии.
 * login — домен площадки: реального логина в куках нет (есть только имя куки),
 * и выдумывать его значило бы потом отправлять письмо по несуществующему адресу.
 */
function bindFromSession(db, site) {
  const login = site.domains[0];
  db.prepare(`
    INSERT INTO accounts (service, login, display, pass_env, daily_limit, enabled, note, created,
      last_checked, last_ok, last_error)
    VALUES (?,?,?,'',20,1,?,?,?,1,'')
    ON CONFLICT (service, login) DO UPDATE SET
      last_checked = excluded.last_checked,
      last_ok = excluded.last_ok,
      last_error = excluded.last_error,
      note = CASE WHEN accounts.note LIKE 'из браузера:%' THEN excluded.note ELSE accounts.note END
  `).run(
    site.key,
    login,
    site.label,
    `из браузера:${profileLabel(site)} · куки: ${site.cookieNames.slice(0, 6).join(', ')}${site.cookieNames.length > 6 ? '…' : ''}`,
    new Date().toISOString(),
  );
}


/**
 * Таблица «что в браузере». Вынесена из шаблона не для красоты: вложенные
 * тернарники с обратными кавычками внутри ${} закрывают литерал, и разбор
 * шаблонной строки падает на месте, где по смыслу ошибки не было.
 */
function siteTable(sites) {
  const head = `<table><thead><tr><th>Площадка</th><th style="width:240px">Состояние</th>
    <th style="width:320px">Куки</th><th style="width:180px">Профиль</th></tr></thead><tbody>`;
  const body = sites.map((s) => {
    const st = stateTag(s);
    const mark = s.markersKnown
      ? `<div class="small muted" style="margin-top:3px">маркеры: ${esc(s.markersFound.join(", ") || "не найдены")}</div>`
      : '<div class="small muted" style="margin-top:3px">признак входа для площадки не известен</div>';
    return `<tr>
      <td><b>${esc(s.label)}</b><div class="small muted mono">${esc(s.domains.join(", "))}</div></td>
      <td class="small"><span class="tag ${st.cls}">${esc(st.label)}</span>${mark}</td>
      <td class="small mono">${esc(cookieList(s))}${expiryLine(s)}</td>
      <td class="small muted">${esc(profileLabel(s))}</td>
    </tr>`;
  }).join("");
  return `${head}${body}</tbody></table>`;
}

function tabAccounts(db, browserScan = null) {
  const list = accounts(db);
  const byService = new Map();
  for (const a of list) byService.set(a.service, [...(byService.get(a.service) || []), a]);

  const cards = SERVICES.map((svc) => {
    const accs = byService.get(svc.key) || [];
    const env = ENV_BY_SERVICE[svc.key] || [];
    const present = env.filter((k) => process.env[k]);
    const ready = accs.some((a) => a.ok);

    const rows = accs.map((a) => `<tr>
      <td><b>${esc(a.display || a.login)}</b><div class="small muted mono">${esc(a.login)}</div></td>
      <td class="small muted">${esc(a.note || '')}</td>
      <td class="small">${a.enabled
        ? `<span class="tag ${a.ok ? 'ok' : 'hot'}">${a.ok ? 'привязан' : `не хватает: ${esc(a.missing.join(', '))}`}</span>`
        : '<span class="tag bad">выключен</span>'}</td>
      <td class="small num">${a.daily_limit || '—'}${a.today ? ` · сегодня ${a.today}` : ''}</td>
      <td class="small">${a.last_checked
        ? `${a.last_ok ? '<span style="color:var(--ok)">связь есть</span>' : '<span style="color:var(--bad)">связи нет</span>'}
           <div class="muted num">${esc(String(a.last_checked).slice(0, 16).replace('T', ' '))}</div>
           <div class="muted">${esc(a.last_error || '')}</div>`
        : '<span class="muted">не проверялась</span>'}</td>
      <td class="small">
        <form class="inline" method="post" action="/account/check?id=${a.id}">
          <button class="btn">Проверить связь</button>
        </form>
        <form class="inline" method="post" action="/account/toggle?id=${a.id}">
          <button class="btn ghost">${a.enabled ? 'Выключить' : 'Включить'}</button>
        </form>
      </td>
    </tr>`).join('');

    return `<section class="panel">
      <div class="head">
        <h2>${esc(svc.name)}</h2>
        <span class="sub">${esc(svc.hint)}</span>
        <span class="sp"></span>
        ${ready ? '<span class="tag ok">привязан</span>' : (present.length ? '<span class="tag hot">переменные есть, привязки нет</span>' : '<span class="tag">не подключено</span>')}
      </div>
      <form class="acc-form" method="post" action="/account/add">
        <input type="hidden" name="service" value="${esc(svc.key)}">
        <span class="acc-form-k">привязать</span>
        <input class="inp" name="login" placeholder="логин или почта" required>
        <input class="inp" name="display" placeholder="имя">
        <input class="inp narrow" name="pass_env" placeholder="ПАРОЛЬ_ENV">
        <input class="inp narrow" name="daily_limit" placeholder="лимит/день" value="20">
        <button class="btn pri">Привязать</button>
      </form>
      ${rows
        ? `<table><thead><tr><th>Ящик</th><th style="width:170px">Заметка</th><th style="width:250px">Состояние</th>
            <th style="width:110px">Лимит</th><th style="width:190px">Проверка</th><th style="width:220px"></th></tr></thead>
           <tbody>${rows}</tbody></table>`
        : '<div class="pad small muted">Привязок нет. Добавь формой выше: система покажет, чего не хватает для связи.</div>'}
      ${env.length ? `<div class="pad small mono muted" style="border-top:1px solid var(--line)">
        переменные: ${env.map((k) => `<span class="tag ${present.includes(k) ? 'ok' : ''}">${esc(k)}${present.includes(k) ? '' : ' — нет'}</span>`).join(' ')}
      </div>` : ''}
    </section>`;
  }).join('');

  const readyCount = list.filter((a) => a.ok).length;

  // Блок «что в браузере» — то же, что лежит в accounts, но показывается сразу,
  // включая площадки без привязки: человек видит, что вход найден, и решает сам.
  const scan = browserScan;
  const sitesWithState = scan
    ? Object.values(scan.sites).filter((s) => s.cookieNames.length || s.state !== 'none')
    : [];
  const scanHtml = scan ? `
    ${panel('Что есть в браузере', `прочитано профилей: ${scan.scanned.length}${scan.blocked.length ? `, заблокировано: ${scan.blocked.length}` : ''}`,
      `<div class="pad">
        <div class="row" style="margin-bottom:12px">
          <form method="post" action="/accounts/auto">
            <button class="btn pri">Просканировать и привязать</button>
          </form>
          <span class="small muted">сканируются Chrome, Edge и Brave · профили находятся сами</span>
        </div>
        ${sitesWithState.length ? siteTable(sitesWithState) : '<div class="small muted">Ни одной куки площадок не найдено: пользователь не входил ни на одну из них в этих профилях.</div>'}

        ${scan.blocked.length ? `<div class="small muted" style="margin-top:12px">Не прочитаны: ${scan.blocked.map((b) => `<span class="tag">${esc(b.profile)} — ${b.why === 'locked' ? 'держит браузер' : esc(b.why)}</span>`).join(' ')}
          Это «не проверено», а не «входа нет»: закрой браузер или закрой профиль и сканируй снова.</div>` : ''}
        <div class="small muted" style="margin-top:12px">Значения кук не читаются и не сохраняются: в базу попадают только имена.
          Значение сессии — пароль в открытом виде.</div>
      </div>`)}` : '<div class="empty">Скан не выполнялся. Нажми «Просканировать и привязать».</div>';

  return `
    <div class="desk-head">
      <div>
        <h1 class="desk-title">Привязки</h1>
        <p class="desk-sub">Почта и площадки, через которые идёт отправка. Пароли здесь не хранятся:
          в форме указывается имя переменной окружения, в которой лежит пароль.</p>
      </div>
      <div class="desk-meter">
        <div class="desk-meter-n"><b>${readyCount}</b><span>из ${list.length} привязок готовы</span></div>
        <div class="small muted">привязка готова, когда включена и есть все переменные окружения</div>
      </div>
    </div>${scanHtml}${cards}`;
}
function tabSend(db) {
  const { plan, reasons, shared } = planBatch(db, { batch: 10, resumeText: resumeText(), writeLetters: false });

  const planBody = plan.length
    ? `<table><thead><tr><th style="width:70px">%</th><th style="width:110px">Канал</th>
        <th style="width:240px">Кому</th><th>Вакансия</th><th style="width:190px">Что делать</th></tr></thead><tbody>` +
      plan.map((p) => `<tr>
        <td>${pctCell(p.vacancy.percent)}</td>
        <td><span class="tag acc">${esc(p.target.channel)}</span></td>
        <td class="small mono">${esc(String(p.target.value).slice(0, 40))}
          <div class="small muted" style="font-family:inherit">${esc(p.target.why)}</div></td>
        <td><a href="/?tab=letter&id=${p.vacancy.id}">${esc(p.vacancy.title)}</a>
          <div class="small muted">${esc(p.vacancy.company || '—')}</div></td>
        <td class="small muted">${esc(CHANNEL_ACTION[p.target.channel])}</td>
      </tr>`).join('') + '</tbody></table>'
    : `<div class="empty">Готово к отправке пусто: под порогом ${THRESHOLD} нет вакансий с опубликованным адресом.</div>`;

  const reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const reasonBody = reasonRows.length
    ? `<div class="pad reasons">${reasonRows.map(([why, n]) =>
        `<div class="reason"><b class="num">${n}</b><span>${esc(why)}</span></div>`).join('')}</div>`
    : '<div class="pad small muted">Пропущенных вакансий нет.</div>';

  const summary = db.prepare('SELECT channel, status, COUNT(*) c FROM dispatches GROUP BY channel, status').all();
  const summaryBody = `<div class="pad small">${summary.length
    ? summary.map((r) => `<span class="tag ${r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'bad' : 'acc'}">${esc(r.channel)} / ${esc(r.status)}: ${r.c}</span>`).join(' ')
    : '<span class="muted">dispatches пуст — отправок ещё не было ни одной.</span>'}
    ${shared.length ? `<div style="margin-top:12px;color:var(--warn)">Общие адреса, в адресаты не идут:
      ${shared.map((s) => `<span class="tag">${esc(s)}</span>`).join(' ')}
      <div class="muted small">Это ящик площадки-агрегатора: письмо в него ушло бы по двенадцати компаниям сразу.</div></div>` : ''}
    </div>`;

  const count = Math.min(plan.length, 10);
  const prepBtn = count
    ? `<form class="inline" method="post" action="/send/batch?batch=${count}">
         <button class="btn pri" onclick="return confirm('Подготовить ${count} писем в hsw/outbox?')">Подготовить ${count}</button>
       </form>`
    : '';

  return panel('Готово к отправке', `${plan.length} писем · порог ${THRESHOLD}`, planBody, prepBtn)
    + `<div class="grid2">
        ${panel('Почему остальное не уйдёт', 'счётчик по каждой причине', reasonBody)}
        ${panel('Учёт отправок', 'что система уже записала', summaryBody)}
      </div>`;
}

function tabSent(db) {
  const rows = db.prepare(`
    SELECT d.*, v.title, v.company, v.percent FROM dispatches d
    JOIN vacancies v ON v.id = d.vacancy_id
    ORDER BY COALESCE(d.sent_at, '') DESC, d.id DESC
  `).all();
  if (!rows.length) {
    return `<div class="empty">Отправок ещё нет.<br><br>
      Подготовить письма — вкладка «Отправка» или <span class="mono">node hsw/send.mjs --batch 10</span>,
      отправка файлов — из <span class="mono">hsw/outbox</span>.</div>`;
  }
  const body = `<table><thead><tr><th>Вакансия</th><th style="width:240px">Кому</th>
    <th style="width:110px">Канал</th><th style="width:150px">Статус</th>
    <th style="width:160px">Когда</th><th style="width:70px">%</th></tr></thead><tbody>` +
  rows.map((r) => `<tr>
    <td><a href="/?tab=letter&id=${r.vacancy_id}">${esc(r.title)}</a>
      <div class="small muted">${esc(r.company || '')}</div></td>
    <td class="small mono">${esc(r.target || '—')}
      <div class="small muted" style="font-family:inherit">${esc(String(r.note || '').slice(0, 70))}</div></td>
    <td class="small"><span class="tag acc">${esc(r.channel)}</span></td>
    <td class="small">${statusTag(r.status)}</td>
    <td class="small muted num">${esc(String(r.sent_at || '').slice(0, 16).replace('T', ' ')) || '—'}</td>
    <td>${pctCell(r.percent)}</td>
  </tr>`).join('') + '</tbody></table>';
  return panel('История отправок', `${rows.length} записей`, body);
}

function tabLeaks(db) {
  const rows = db.prepare(`
    SELECT id, title, company, percent, stack, fit_why, valid_through
    FROM vacancies
    WHERE status = 'leaks' ORDER BY percent DESC, valid_through LIMIT 60
  `).all();
  if (!rows.length) {
    return '<div class="empty">LeaksData пуст — ни одна вакансия не набрала меньше порога.</div>';
  }
  const body = `<div class="pad small muted" style="border-bottom:1px solid var(--line)">
      Вакансии ниже порога ${THRESHOLD}. Это не мусор: сюда попадает всё, где резюме не подходит по стеку или формату.
    </div>
    <table><thead><tr><th style="width:70px">%</th><th>Вакансия</th><th style="width:170px">Компания</th>
      <th style="width:260px">Причина</th></tr></thead><tbody>` +
  rows.map((r) => {
    let reason = '—';
    try { reason = JSON.parse(r.fit_why).verdict || '—'; } catch { /* нет разбора */ }
    return `<tr>
      <td>${pctCell(r.percent)}</td>
      <td><a href="/?tab=letter&id=${r.id}">${esc(r.title)}</a>
        <div class="small muted">${esc(r.valid_through || '')}</div></td>
      <td>${esc(r.company || '—')}</td>
      <td class="small muted">${esc(reason)}</td>
    </tr>`;
  }).join('') + '</tbody></table>';
  return panel('LeaksData', 'ниже порога, с разбором причины', body);
}
function tabLetter(db, id) {
  const l = db.prepare('SELECT * FROM letters WHERE vacancy_id = ?').get(id);
  const v = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id);
  if (!v) {
    return `<div class="empty">Вакансия не найдена. Возможно, id из старой ссылки.<br><br>
      <a class="btn" href="/?tab=queue">← к очереди</a></div>`;
  }

  const contacts = db.prepare('SELECT kind, value, source_url, note FROM contacts WHERE company_key = ?').all(v.company_key);
  const shared = new Set(sharedEmails(db, 3).map((x) => x.value));
  const target = pickChannel(contacts, {
    site: contacts.find((c) => c.kind === 'site')?.value || '',
    shared,
    vacancyUrl: v.url,
  });
  const dispatches = dispatchFor(db, v.id);
  const channel = target.channel || 'email';
  const sent = dispatches.find((d) => d.status === 'sent' && d.channel === channel);
  const prepared = dispatches.find((d) => d.status === 'prepared' && d.channel === channel);
  const resume = resumeForStack(v.stack) || 'resume-fastapi.pdf';

  let flags = [];
  try { flags = JSON.parse(l?.fit_why || '{}').claims || []; } catch { flags = []; }

  const actions = target.blocked
    ? `<span class="tag bad">адресата нет: ${esc(target.blocked)}</span>`
    : `<form class="inline" method="post" action="/send/prepare?id=${v.id}">
         <button class="btn pri">${channel === 'email' ? 'Скачать .eml с резюме' : `Скачать текст для ${esc(channel)}`}</button>
       </form>
       ${channel === 'email'
         ? `<a class="btn" href="${esc(mailto({ subject: l?.subject || v.title, body: l?.body || '', to: target.value }))}">Отправить из своей почты</a>`
         : (/^https?:\/\//.test(target.value)
           ? `<a class="btn" href="${esc(target.value)}" target="_blank" rel="noopener">Открыть ${esc(channel)}</a>`
           : '')}
       ${sent
         ? `<span class="tag ok">отправлено ${esc(String(sent.sent_at).slice(0, 16).replace('T', ' '))}</span>`
         : `<form class="inline" method="post" action="/send/mark?id=${v.id}&channel=${esc(channel)}">
              <button class="btn ok" ${prepared ? '' : 'disabled title="сначала скачай файл"'}
                onclick="return confirm('Точно отправлено? Отметка попадёт в отчёт и в процент каналов')">Отметить отправленным</button>
            </form>`}`;

  const channelNote = target.blocked ? '' : `<div class="row">
      <span class="tag acc">${esc(channel)}</span>
      <span class="small muted">${esc(String(target.value).slice(0, 90))} · ${esc(CHANNEL_ACTION[channel])}</span>
    </div>`;

  const letterPanel = l
    ? panel('Письмо', `${esc(l.subject)}`, `
        <div class="pad">
          <div class="row">
            <button class="btn" onclick="copyText()">Скопировать текст</button>
            ${channel !== 'email' ? '<button class="btn" onclick="copyShort()">Скопировать короткий</button>' : ''}
            <a class="btn" href="${esc(v.url)}" target="_blank" rel="noopener">Открыть вакансию</a>
            <a class="btn" href="/resume/${esc(resume)}" target="_blank">Резюме (PDF)</a>
          </div>
          ${channelNote}
          ${channel !== 'email' ? `<div class="small muted" style="margin:14px 0 6px">Короткий текст для ${esc(channel)} — без вложений, со ссылкой на резюме</div>
            <div class="pre" id="letter-short">${esc(shortText(l, { channel }))}</div>` : ''}
          <div class="pre" id="letter" style="margin-top:12px">${esc(l.subject + '\n\n' + l.body)}</div>
        </div>`, `${statusTag(l.status)} ${actions}`)
    : `<section class="panel"><div class="pad">
        <div class="empty">Черновик не создан для этой вакансии.<br><br>
        <span class="mono">node hsw/run-letters.mjs 10 0</span> — создать письма; кнопка «Скачать» соберёт письмо само.</div>
        <div class="row" style="margin-top:14px;justify-content:center">${actions}</div>
      </div></section>`;

  const scorePanel = panel('Почему такой процент', `${v.percent}/100 · порог ${THRESHOLD}`,
    `<div class="pad">
      <div class="row"><div class="bar"><i style="width:${v.percent || 0}%"></i></div><b class="num">${v.percent}/100</b></div>
      ${partsBlock(v.fit_why)}
    </div>`);

  const claimsPanel = flags.length
    ? panel('Проверка обещаний', 'письмо претендует на лишнее',
        `<div class="pad"><ul style="margin:0 0 0 18px">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="small muted" style="margin-top:8px">Такое письмо не отправляется: сначала правь резюме.</div></div>`)
    : panel('Проверка обещаний', 'все утверждения о себе имеют опору в резюме',
        '<div class="pad small" style="color:var(--ok)">Чисел и технологий без опоры в резюме не найдено.</div>');

  const contactsPanel = panel('Контакты компании', contacts.length ? `${contacts.length} записей` : 'не найдено',
    contacts.length
      ? `<div class="pad">${contacts.map((c) =>
          `<span class="tag" title="${esc(c.note || '')}">${esc(c.kind)}: ${esc(c.value)}</span>`).join(' ')}</div>`
      : '<div class="pad small muted">Без контакта процент приёма падает. Добрать: <span class="mono">node hsw/collect-contacts.mjs 20</span></div>');

  return `<div class="row">
      <a class="btn" href="/?tab=queue">← к очереди</a>
      <span class="tag">${esc(v.source)}</span>
      ${v.stack ? `<span class="tag acc">стек: ${esc(v.stack)}</span>` : ''}
      ${v.no_degree ? '<span class="tag ok">без высшего</span>' : ''}
      ${v.no_experience ? '<span class="tag ok">без опыта</span>' : ''}
      ${v.urgent ? '<span class="tag hot">горит</span>' : ''}
    </div>
    <h1 style="font-size:22px;margin:4px 0 6px">${esc(v.title)}</h1>
    <div class="muted" style="margin-bottom:16px">${esc(v.company || '')}${v.city ? ' · ' + esc(v.city) : ''}${v.salary_from ? ' · от ' + new Intl.NumberFormat('ru-RU').format(v.salary_from) + ' ₽' : ''}</div>
    ${scorePanel}
    ${letterPanel}
    ${claimsPanel}
    ${contactsPanel}
    <details><summary>Требования из вакансии</summary>
      <div class="pre">${esc(v.requirements || v.description || '—')}</div></details>
    <script>
      function copy(id){
        const t = document.getElementById(id).innerText;
        navigator.clipboard.writeText(t).then(()=>alert('Скопировано'));
      }
      function copyText(){ copy('letter') }
      function copyShort(){ copy('letter-short') }
    </script>`;
}

// ---------------------------------------------------------------- запуск

// Разрешённые файлы резюме берутся с диска, а не из захардкоженного списка из
// пяти файлов: список разъезжался с реальностью, и кнопка «Резюме (PDF)» для
// стека DevOps или Backend предлагала fastapi-резюме, потому что имя файла не
// совпадало с ключом из сопоставления. Теперь отдаётся любой файл resume*.pdf,
// который действительно лежит в каталоге, и только он.
const RESUME_FILES = new Set(
  readdirSync(process.cwd()).filter((f) => /^resume[\w.-]*\.pdf$/i.test(f)),
);

let resumeCache = null;
function resumeText() {
  if (resumeCache !== null) return resumeCache;
  const f = resolve(process.cwd(), 'resume-fastapi.html');
  resumeCache = existsSync(f) ? readFileSync(f, 'utf8').replace(/<[^>]+>/g, ' ').toLowerCase() : '';
  return resumeCache;
}

/** Тело POST-формы. Формы здесь маленькие и без файлов, но читать их целиком
 *  всё равно надо: размер ограничен, чтобы тело не копилось в памяти. */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('слишком большое тело')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Результат последнего скана. Хранится в памяти, а не в файле: это временное
 * наблюдение о состоянии браузера, и оно должно устаревать, а не копиться.
 */
let browserScan = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tab = url.searchParams.get('tab') || 'queue';
  const message = url.searchParams.get('msg') || '';

  // --- действия отправки. Формы без тела: в адресе только числовой id
  // вакансии и число писем, поэтому читать тело запроса не нужно, а принимать
  // произвольный путь или текст письма — тем более.
  if (req.method === 'POST') {
    const id = Number(url.searchParams.get('id') || 0);
    const go = (where, msg) => {
      res.writeHead(303, { Location: `${where}${where.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}` });
      res.end();
    };

    // --- главная редакция. Отправкой управляет человек, поэтому здесь
    // нажатие кнопки и есть решение: подтвердить готовит письмо и честно
    // говорит, что фактически отправлено, а что осталось за человеком.
    if (url.pathname === '/desk/confirm') {
      const channel = url.searchParams.get('channel') || 'email';
      const r = prepareVacancy(db, id, { resumeText: resumeText() });
      go('/?tab=desk', r.ok
        ? `готово: ${r.name} → ${r.channel}: ${r.to}. Отправь файл из hsw/outbox, потом «Отправить — вручную»`
        : `не вышло — ${r.why}`);
      return;
    }

    if (url.pathname === '/desk/reject') {
      const channel = url.searchParams.get('channel') || 'email';
      const reason = (url.searchParams.get('reason') || 'отклонено').slice(0, 80);
      recordDispatch(db, {
        vacancyId: id, channel, target: '', status: 'rejected',
        note: `отклонено человеком: ${reason}`,
      });
      db.prepare("UPDATE vacancies SET status = 'rejected' WHERE id = ?").run(id);
      db.prepare("UPDATE letters SET status = 'rejected' WHERE vacancy_id = ?").run(id);
      go('/?tab=desk', `отклонено: ${reason}. Вакансия ушла из редакции, причина записана`);
      return;
    }

    // --- привязки
    // Автопривязка: скан профилей и создание привязок там, где найден вход.
    // Значения кук не читаются: в accounts попадают имена, домен и профиль.
    if (url.pathname === '/accounts/auto') {
      browserScan = scanBrowser();
      const found = Object.values(browserScan.sites).filter((s) => s.found);
      for (const s of found) bindFromSession(db, s);
      const locked = browserScan.blocked.length;
      const msg = found.length
        ? `готово: привязано площадок ${found.length}${locked ? `, не прочитано профилей ${locked}` : ''}`
        : `не вышло — вход нигде не найден${locked ? `, часть профилей не прочитана (${locked})` : ''}`;
      go('/?tab=accounts', msg);
      return;
    }

    if (url.pathname === '/account/add') {
      const form = new URLSearchParams(await readBody(req));
      const service = String(form.get('service') || 'email');
      const { login, display } = parseAccount(form.get('login'), form.get('display'));
      if (!login) { go('/?tab=accounts', 'не вышло: пустой логин'); return; }
      db.prepare(`
        INSERT INTO accounts (service, login, display, pass_env, daily_limit, enabled, note, created)
        VALUES (?,?,?,?,?,1,?,?)
        ON CONFLICT (service, login) DO UPDATE SET
          display = excluded.display, pass_env = excluded.pass_env,
          daily_limit = excluded.daily_limit, enabled = 1
      `).run(
        service, login, display,
        String(form.get('pass_env') || '').trim(),
        Number(form.get('daily_limit') || 20),
        String(form.get('note') || ''),
        new Date().toISOString(),
      );
      go('/?tab=accounts', `готово: ${login} привязан как ${serviceMeta(service).name}. Проверь связь`);
      return;
    }

    if (url.pathname === '/account/toggle') {
      db.prepare('UPDATE accounts SET enabled = 1 - enabled WHERE id = ?').run(id);
      go('/?tab=accounts', 'состояние привязки переключено');
      return;
    }

    if (url.pathname === '/account/check') {
      const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      if (!a) { go('/?tab=accounts', 'привязка не найдена'); return; }
      const host = process.env[`${a.service.toUpperCase()}_HOST`] || process.env.HSW_SMTP_HOST;
      const port = process.env[`${a.service.toUpperCase()}_PORT`] || process.env.HSW_SMTP_PORT;
      const r = host ? await smtpProbe(host, port) : { ok: false, detail: 'хост не задан в переменных окружения' };
      db.prepare('UPDATE accounts SET last_checked = ?, last_ok = ?, last_error = ? WHERE id = ?')
        .run(new Date().toISOString(), r.ok ? 1 : 0, r.detail || '', id);
      go('/?tab=accounts', r.ok ? `связь есть: ${r.detail}` : `связи нет: ${r.detail}`);
      return;
    }

    if (url.pathname === '/send/prepare') {
      const r = prepareVacancy(db, id, { resumeText: resumeText() });
      go(`/?tab=letter&id=${id}`, r.ok
        ? `готово: ${r.name} → ${r.channel}: ${r.to}${r.attach ? `, вложение ${r.attach}` : ''}`
        : `не вышло — ${r.why}`);
      return;
    }

    if (url.pathname === '/send/mark') {
      const channel = url.searchParams.get('channel') || 'email';
      markSent(db, id, { channel });
      go(`/?tab=letter&id=${id}`, `готово: отмечено отправленным (${channel}), канал засчитан в проценте`);
      return;
    }

    if (url.pathname === '/send/batch') {
      const n = Math.min(50, Math.max(1, Number(url.searchParams.get('batch') || 5)));
      let done = 0;
      let firstFail = '';
      for (const p of planBatch(db, { batch: n, resumeText: resumeText() }).plan) {
        const r = prepareVacancy(db, p.vacancy.id, { resumeText: resumeText() });
        if (r.ok) done++; else if (!firstFail) firstFail = r.why;
      }
      go('/?tab=send', done
        ? `готово: подготовлено ${done} в hsw/outbox${firstFail ? `, не вышло: ${firstFail}` : ''}`
        : `не вышло — ${firstFail || 'нечего готовить'}`);
      return;
    }

    res.writeHead(404).end('не так');
    return;
  }

  // Отдаём резюме для кнопки «вложить письмо».
  const resume = url.pathname.match(/^\/resume\/([\w.-]+)$/);
  if (resume) {
    const name = resume[1];
    if (!RESUME_FILES.has(name)) { res.writeHead(404).end('нет такого резюме'); return; }
    // Имя файла приходит из URL, поэтому путь собирается от каталога проекта
    // и проверяется по списку разрешённых: иначе это чтение произвольного файла.
    const buf = readFileSync(resolve(process.cwd(), name));
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"` });
    res.end(buf);
    return;
  }

  const s = stats(db);
  let body;
  if (tab === 'desk') body = tabDesk(db);
  else if (tab === 'queue') body = tabQueue(db);
  else if (tab === 'letters') body = tabLetters(db);
  else if (tab === 'contacts') body = tabContacts(db);
  else if (tab === 'send') body = tabSend(db);
  else if (tab === 'sent') body = tabSent(db);
  else if (tab === 'accounts') body = tabAccounts(db, browserScan);
  else if (tab === 'leaks') body = tabLeaks(db);
  else if (tab === 'letter') body = tabLetter(db, Number(url.searchParams.get('id') || 0));
  else body = tabDesk(db);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(tab, body, s, message, url.searchParams.get('theme') || 'dark'));
});

server.listen(PORT, () => {
  const s = stats(db);
  console.log(`HardSearchWork: http://localhost:${PORT}`);
  console.log(`  вакансий ${s.vacancies}, под фильтры ${s.matching}, писем ${s.letters}, контактов ${s.contacts}`);
  console.log('  Ctrl+C — остановить');
});
