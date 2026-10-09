// Выбор резюме под стек вакансии.
//
// Зачем отдельный файл: стек в базе — это человекочитаемый ярлык скоринга
// («Python», «QA / тестирование», «Backend»), а имена файлов резюме — свои
// («resume-fastapi.pdf», «resume-qa.pdf»). Раньше эти два мира соединялись
// сравнением строк в интерфейсе: `map[stack]` по ключам 'python'/'qa'/'cpp',
// а в базе лежало 'Python' и 'QA / тестирование'. Ни одно совпадение не
// срабатывало, и к вакансии QA прикладывалось FastAPI-резюме. Молчаливый
// обман: письмо выглядит правильным, а внутри чужое резюме.
//
// Здесь одно место, где ярлык превращается в файл. Если файла нет — честно
// возвращается null, а не «первое попавшееся»: вложить не то резюме хуже,
// чем не вложить вовсе.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Ярлык скоринга → ключ стека. Регистр и слэш значения не имеют. */
export function stackKeyOf(label) {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('qa') || s.includes('тест')) return 'qa';
  if (s.includes('devops') || s.includes('инфраструктур') || s.includes('sre')) return 'devops';
  if (s.includes('данн') || s.includes('data') || s.includes('аналитик') || s.includes('etl')) return 'data';
  if (s.includes('frontend') || s.includes('фронт')) return 'frontend';
  if (s.includes('c++') || s.includes('cpp') || s.includes('rust') || s.includes('c#')) return 'cpp';
  if (s.includes('python') || s.includes('backend') || s.includes('бэкенд')) return 'python';
  return null;
}

/**
 * Ключ стека → файл резюме.
 *
 * Backend и Python разведены намеренно: для «Backend-разработчик» честнее
 * резюме без привязки к FastAPI, а под «Python» — то, что перечислено
 * конкретно в вакансии.
 */
const BY_KEY = {
  python: 'resume-fastapi.pdf',
  qa: 'resume-qa.pdf',
  devops: 'resume-devops.pdf',
  data: 'resume-data-pipeline.pdf',
  frontend: 'resume-frontend.pdf',
  cpp: 'resume-cpp.pdf',
};

const BY_LABEL = {
  Backend: 'resume-backend.pdf',
  'QA / тестирование': 'resume-qa.pdf',
  DevOps: 'resume-devops.pdf',
  Данные: 'resume-sql-data.pdf',
};

export const FALLBACK_RESUME = 'resume-fastapi.pdf';

/** Файл резюме под стек вакансии; null, если подходящего файла нет на диске. */
export function resumeForStack(label, { root = process.cwd(), fallback = true } = {}) {
  const candidates = [BY_LABEL[String(label || '').trim()], BY_KEY[stackKeyOf(label)], FALLBACK_RESUME];
  for (const name of candidates) {
    if (name && existsSync(resolve(root, name))) return name;
  }
  return fallback ? null : null;
}

/** Почему под этот стек не нашлось файла — для отчёта, а не для молчания. */
export function resumeGap(label, root = process.cwd()) {
  const key = stackKeyOf(label);
  return {
    key,
    wanted: [BY_LABEL[String(label || '').trim()], BY_KEY[key]].filter(Boolean),
    present: existsSync(resolve(root, FALLBACK_RESUME)),
  };
}
