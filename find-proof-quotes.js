// Подбор подтверждений: какая цитата из какого файла реально существует.
// Одноразовый помощник, оставлен в репозитории, чтобы следующий прогон
// проверки не приходилось делать на глаз.
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  ['resume-python.html', ['Kwork', 'парсер', 'Telegram', 'автотест', '769', 'FastAPI']],
  ['resume-backend.html', ['Actix-Web', 'SQLite FTS5', '564', 'Docker', 'healthcheck', 'GitHub Actions', 'Регистры', '1С']],
  ['resume-qa.html', ['Selenium', 'Allure', '47', 'Pytest', 'негатив', 'тест-кейс', 'PyCharm']],
  ['resume-cpp.html', ['Vulkan', 'OpenGL', 'Assimp', '88', 'scene graph', 'Win32', 'GDI+', 'FBX']],
  ['resume-gamedev.html', ['Unity', 'Vulkan', 'immediate-mode', '158', 'Rust', 'инструмент']],
  ['resume-frontend.html', ['WebSocket', 'socket.io', 'drag-and-drop', 'JavaScript', 'HTML5', '47', 'Select']],
];

for (const [file, quotes] of CANDIDATES) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) { console.log(file + ': ФАЙЛА НЕТ'); continue; }
  const low = fs.readFileSync(p, 'utf8').toLowerCase();
  const found = quotes.filter((q) => low.indexOf(q.toLowerCase()) >= 0);
  const missing = quotes.filter((q) => low.indexOf(q.toLowerCase()) < 0);
  console.log(file);
  console.log('  есть:    ' + found.join(' | '));
  console.log('  нет:     ' + missing.join(' | '));
}
