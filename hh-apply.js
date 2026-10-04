// Отправка отклика на hh. Порядок шагов здесь неочевиден и был найден
// экспериментально, поэтому зафиксирован.
//
// ГЛАВНОЕ: сначала письмо, потом отправка.
//
// Раньше было наоборот: нажать кнопку отправки и потом дописать письмо.
// На вакансии 137539010 hh показал в модалке «Сопроводительное письмо
// обязательное для этой вакансии», а кнопку «Откликнуться» оставил
// в состоянии disabled. Клик по disabled-кнопке не делает ничего, отклик не
// уходит, а код рапортовал об успехе. Правильный порядок: заполнить письмо,
// прочитать поле обратно и убедиться, что там именно наш текст, дождаться
// снятия disabled, и только потом отправлять.
//
// ВТОРОЕ: отчёт об успехе без проверки — это ложь. Поле читается обратно и
// сравнивается по длине. Если React не принял значение, мы не отправляем
// ничего и возвращаем LETTER_UNVERIFIED, а не «OK».
//
// ТРЕТЬЕ: капча hh — это текст с картинки. Её вводит человек, скрипт её
// только обнаруживает и останавливается, чтобы не получить блокировку аккаунта.

const browserScripts = {
  /**
   * Отправляет отклик. Страница с вакансией уже должна быть открыта:
   * навигация внутри evaluate() убивает контекст, document.body становится null.
   *
   * @param {string} letter текст письма
   */
  apply(letter) {
    return (
      '(async function(){\n' +
      'function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }\n' +
      'function body(){ return document.body ? document.body.innerText.replace(/\\s+/g," ") : ""; }\n' +
      'var log = { steps: [] };\n' +
      'var LETTER = ' + JSON.stringify(letter) + ';\n' +
      'var btn = document.querySelector(\'[data-qa="vacancy-response-link-top"]\');\n' +
      'if (!btn) {\n' +
      '  var t0 = body();\n' +
      '  log.result = /Вам отказали/i.test(t0) ? "ALREADY_REJECTED"\n' +
      '    : /Вы откликнулись/i.test(t0) ? "ALREADY_APPLIED"\n' +
      '    : /закрыт|неактуальна/i.test(t0) ? "CLOSED" : "NO_BUTTON";\n' +
      '  return JSON.stringify(log);\n' +
      '}\n' +
      '["mousedown","mouseup","click"].forEach(function(e){\n' +
      '  try { btn.dispatchEvent(new MouseEvent(e, {bubbles:true, cancelable:true, view:window})); } catch(x){}\n' +
      '});\n' +
      'var sub = null, captcha = false;\n' +
      'for (var k = 0; k < 40; k++) {\n' +
      '  await sleep(400);\n' +
      '  sub = document.querySelector(\'[data-qa="vacancy-response-submit-popup"]\');\n' +
      '  captcha = /Пройдите капчу|введите текст с картинки/i.test(body());\n' +
      '  if (sub || captcha) break;\n' +
      '}\n' +
      'if (captcha) { log.result = "CAPTCHA"; return JSON.stringify(log); }\n' +
      'if (!sub) { log.result = "NO_MODAL"; log.text = body().slice(0,240); return JSON.stringify(log); }\n' +
      'log.steps.push("модалка");\n' +
      // Шаг 1. Письмо — раньше отправки.\n' +
      'var ta = document.querySelector(\'[data-qa="vacancy-response-popup-form-letter-input"]\');\n' +
      'if (!ta) {\n' +
      '  // У части вакансий поля нет сразу: его открывает «Приложить сопроводительное».\n' +
      '  var a = Array.prototype.slice.call(document.querySelectorAll("button, a"))\n' +
      '    .filter(function(x){ return /Приложить сопроводительное/i.test(x.innerText || ""); })[0];\n' +
      '  if (a) {\n' +
      '    a.click();\n' +
      '    for (var j = 0; j < 30; j++) {\n' +
      '      await sleep(400);\n' +
      '      ta = document.querySelector(\'[data-qa="vacancy-response-popup-form-letter-input"]\');\n' +
      '      if (ta) break;\n' +
      '    }\n' +
      '  }\n' +
      '}\n' +
      'if (ta) {\n' +
      '  log.required = /обязательн/i.test(body());\n' +
      '  var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), "value");\n' +
      '  d.set.call(ta, LETTER);\n' +
      '  ta.dispatchEvent(new Event("input", {bubbles:true}));\n' +
      '  ta.dispatchEvent(new Event("change", {bubbles:true}));\n' +
      '  for (var w = 0; w < 20; w++) {\n' +
      '    await sleep(400);\n' +
      '    if (!sub.disabled) break;\n' +
      '  }\n' +
      '  log.letterBack = ta.value.length;\n' +
      '  log.letterWanted = LETTER.length;\n' +
      '  // Проверка. Без неё отчёт об успехе не значит ничего.\n' +
      '  if (ta.value.length < LETTER.length * 0.6) {\n' +
      '    log.result = "LETTER_UNVERIFIED";\n' +
      '    log.backSnippet = ta.value.slice(0, 140);\n' +
      '    return JSON.stringify(log);\n' +
      '  }\n' +
      '  log.steps.push("письмо заполнено и проверено");\n' +
      '} else {\n' +
      '  log.letterBack = 0;\n' +
      '  log.letterWanted = LETTER.length;\n' +
      '  log.steps.push("поля письма нет");\n' +
      '}\n' +
      '// Шаг 2. Ждём, что кнопка перестала быть disabled.\n' +
      'for (var w2 = 0; w2 < 15; w2++) {\n' +
      '  await sleep(400);\n' +
      '  if (!sub.disabled) break;\n' +
      '}\n' +
      'log.submitDisabled = sub.disabled;\n' +
      'if (sub.disabled) { log.result = "STILL_DISABLED"; log.text = body().slice(0,300); return JSON.stringify(log); }\n' +
      '// Шаг 3. Отправка.\n' +
      'sub.click();\n' +
      'for (var q = 0; q < 40; q++) {\n' +
      '  await sleep(500);\n' +
      '  var t = body();\n' +
      '  if (/Отклик отправлен|Вы откликнулись/i.test(t)) { log.result = "SENT"; return JSON.stringify(log); }\n' +
      '  if (/Пройдите капчу|введите текст с картинки/i.test(t)) { log.result = "CAPTCHA_AFTER_SUBMIT"; return JSON.stringify(log); }\n' +
      '  if (/Ответьте на вопросы/i.test(t)) { log.result = "QUESTIONS"; return JSON.stringify(log); }\n' +
      '  if (!document.querySelector(\'[data-qa="vacancy-response-submit-popup"]\')) { log.result = "MODAL_CLOSED"; return JSON.stringify(log); }\n' +
      '}\n' +
      'log.result = "UNKNOWN";\n' +
      'log.text = body().slice(0,300);\n' +
      'return JSON.stringify(log);\n' +
      '})()'
    );
  },
};

module.exports = { browserScripts };
