// Правило опыта исполняется в двух местах: в node при отборе и прямо в
// странице hh при массовом прогоне. Если эти копии разойдутся, отбор и
// проверка начнут считать разные вещи, и обнаружится это через месяц.
//
// Поэтому исполняемый в странице код собирается из исходника hh-experience.js,
// а не пишется второй раз: одна логика в двух местах проверяется тестом
// test-experience-serialized.js на общем корпусе фраз.
//
// Сериализация живёт в отдельном файле намеренно. Если положить её в
// hh-experience.js, её собственный текст попадёт в строку для страницы, и там
// окажутся require и module.exports — то есть мины, которые сработают в
// браузере. Тест на это тоже смотрит.
const fs = require('fs');
const path = require('path');

function pageRuleSource() {
  const file = path.join(__dirname, 'hh-experience.js');
  const src = fs.readFileSync(file, 'utf8');
  // Ищем последнее вхождение в начале строки, а не первое: строка с таким же
  // текстом встречается в комментариях, и обрезка по ней разрезает код
  // посередине — выходит «Invalid or unexpected token».
  const marker = '\nmodule.exports';
  const cut = src.lastIndexOf(marker);
  if (cut < 0) throw new Error('в hh-experience.js нет экспорта в начале строки — сериализация развалится');
  return (
    src.slice(0, cut) +
    '\nreturn { reasonIn: reasonIn, monthsFloor: monthsFloor, MONTH_THRESHOLD: MONTH_THRESHOLD,' +
    ' tooExperienced: function (t) { return reasonIn(t) !== null; } };\n'
  );
}

module.exports = { pageRuleSource: pageRuleSource };