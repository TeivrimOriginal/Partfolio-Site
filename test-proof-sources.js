// Проверка того, что письма не выдумывают.
//
// Зачем. В письма попал пункт «разбор приватного ключа в ASN.1 вручную и тест
// test-rustore-signing.ps1, который ловил ошибки до отправки». Скрипта на диске
// нет — поиск по D:\SOOBSHESTVA его не находит, а фраза уже разошлась по
// письмам на 18 вакансий. Никто этого не заметил: письма читаются гладко, и
// выдумка выглядит как уверенный опыт.
//
// Поэтому каждый пункт «профиля» обязан ссылаться на файл, а файл обязан
// существовать и содержать цитируемую строку. Нечем подтвердить — нельзя писать.
//
// Использование: node test-proof-sources.js
const fs = require('fs');
const path = require('path');
const { STACKS } = require('./hh-resume-stack.js');
const { GROUPS } = require('./hh-letter.js');

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

// Цитаты из писем, которые не подтвердились ничем. Список явный, а не
// регулярка по всему тексту: придумать можно что угодно, и ловить это должен
// человек, читая письмо, а не программа.
const BANNED = [
  'test-rustore-signing',
  'ASN.1',
  'черновик, загрузка AAB',
];

let bad = 0;
let checked = 0;

// Факты живут в двух местах: в профилях стеков и в группах генератора писем.
// Пока копии были две, выдумка просочилась в одну и разошлась по вакансиям
// незамеченной. Проверяются оба места.
function checkList(items, nameOf, indent) {
  for (const item of items) {
    const proof = item.proof || [];
    const ev = item.evidence || [];
    console.log(indent + nameOf(item) + ' — пунктов: ' + proof.length + ', подтверждений: ' + ev.length);
    if (proof.length !== ev.length) {
      console.log(indent + '  ! расхождение: не каждый пункт подтверждён файлом');
      bad += Math.abs(proof.length - ev.length);
    }
    for (let i = 0; i < Math.min(proof.length, ev.length); i++) {
      const e = ev[i];
      const abs = path.isAbsolute(e.file) ? e.file : path.join(__dirname, e.file);
      const text = readFileSafe(abs);
      checked++;
      if (text === null) {
        console.log(indent + '  ! [' + i + '] файла нет: ' + e.file);
        bad++;
        continue;
      }
      const needle = String(e.quote || '').toLowerCase();
      if (!needle) {
        console.log(indent + '  ! [' + i + '] пустая цитата у пункта: ' + proof[i].slice(0, 50));
        bad++;
        continue;
      }
      if (text.toLowerCase().indexOf(needle) < 0) {
        console.log(indent + '  ! [' + i + '] цитаты «' + e.quote + '» нет в ' + e.file);
        bad++;
        continue;
      }
      console.log(indent + '  ок [' + i + '] ' + e.file + ' ← «' + e.quote + '»');
    }
    for (let i = 0; i < proof.length; i++) {
      for (const b of BANNED) {
        if (proof[i].toLowerCase().indexOf(b.toLowerCase()) >= 0) {
          console.log(indent + '  ! [' + i + '] в пункте есть запрещённое «' + b + '»');
          bad++;
        }
      }
    }
  }
}

console.log('проверка доказательств: профили стеков');
console.log('');
checkList(Object.keys(STACKS).map((k) => ({ key: k, proof: STACKS[k].proof, evidence: STACKS[k].evidence })),
  (item) => item.key, '  ');

console.log('');
console.log('проверка доказательств: группы генератора писем');
console.log('');
checkList(GROUPS, (item) => item.id, '  ');

// Готовые письма: там не должно остаться того, что уже забраковано выше.
console.log('');
const LETTER_FILES = ['LETTERS-SHORTLIST.json', 'HABR-LETTERS.json'];
let lettersScanned = 0;
for (const f of LETTER_FILES) {
  const raw = readFileSafe(path.join(__dirname, f));
  if (raw === null) {
    console.log('  ' + f + ': файла нет (пропускаю)');
    continue;
  }
  lettersScanned++;
  for (const b of BANNED) {
    const n = raw.split(b).length - 1;
    if (n > 0) {
      console.log('  ! ' + f + ': «' + b + '» встречается ' + n + ' раз');
      bad++;
    }
  }
}

console.log('');
console.log('подтверждений проверено: ' + checked + ', файлов писем просканировано: ' + lettersScanned + ', нарушений: ' + bad);
process.exit(bad === 0 ? 0 : 1);
