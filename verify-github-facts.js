// Проверка фактов о проектах по публичным репозиториям.
//
// Зачем. В письмах для C++ и геймдева стояло «два бэкенда Vulkan/OpenGL на
// выбор в рантайме». В его резюме написано «выбор графического бэкенда в рантайме»
// — без названий. Названия появились в письмах сами и подтвердить их было нечем,
// а это ровно тот вид выдумки, который вредит: проверяющий видит конкретику и
// принимает её за глубину опыта.
//
// raw.githubusercontent.com отсюда недоступен (соединение рвётся), но
// github.com отдаёт страницу репозитория вместе с README, поэтому проверяем там.
//
// Использование: node verify-github-facts.js
const https = require('https');

const REPOS = [
  'https://github.com/TeivrimOriginal/Teivrim-Engine',
  'https://github.com/TeivrimOriginal/Copy-SAI-Paint-with-Rust',
  'https://github.com/TeivrimOriginal/teivrim-novell-engine',
];

const TERMS = ['Vulkan', 'OpenGL', 'DirectX', 'D3D11', 'D3D12', 'GLFW', 'SDL2',
  'scene graph', 'scene_graph', 'Assimp', 'FBX', 'OBJ', 'immediate', 'Allure',
  'Selenium', 'Actix', 'SQLite', 'FTS5', 'Docker', 'healthcheck', 'GitHub Actions'];

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ code: res.statusCode, body: body }));
    });
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: 0, body: '' }); });
    req.on('error', (e) => resolve({ code: 0, body: '', err: e.message }));
  });
}

(async function () {
  for (const url of REPOS) {
    const r = await get(url);
    const name = url.split('/').pop();
    console.log('--- ' + name + ' -> HTTP ' + r.code + (r.err ? ' (' + r.err + ')' : '') + ', ' + r.body.length + ' Б');
    if (r.code !== 200) continue;
    const hay = r.body.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const hits = [];
    const miss = [];
    for (const t of TERMS) {
      const n = (hay.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
      if (n > 0) hits.push(t + ' x' + n); else miss.push(t);
    }
    console.log('  есть: ' + hits.join(', '));
    console.log('  нет:  ' + miss.join(', '));
  }
})();
