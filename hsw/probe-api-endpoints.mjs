const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function findYandexAPI() {
  const r = await fetch('https://rabota.yandex.ru/search/list?text=python', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const apiPatterns = [
    /\/api\/[^"'\s]+/gi,
    /https?:\/\/[^"'\s]*api[^"'\s]*/gi,
    /fetch\s*\(\s*["']([^"']+)["']/gi,
    /axios\s*\.\s*get\s*\(\s*["']([^"']+)["']/gi,
    /url\s*:\s*["']([^"']+)["']/gi,
  ];
  
  for (const pattern of apiPatterns) {
    const matches = t.match(pattern);
    if (matches) {
      console.log('Pattern:', pattern.source.substring(0, 50));
      console.log('Matches:', [...new Set(matches)].slice(0, 20));
      console.log('---');
    }
  }
  
  const scriptContent = t.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptContent) {
    for (const s of scriptContent) {
      if (s.includes('api') || s.includes('fetch') || s.includes('axios')) {
        const apiMatches = s.match(/["'](\/api\/[^"']+)["']/g);
        if (apiMatches) {
          console.log('API in script:', apiMatches.slice(0, 10));
        }
      }
    }
  }
}

async function findFLAPI() {
  const r = await fetch('https://www.fl.ru/projects/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const apiPatterns = [
    /\/api\/[^"'\s]+/gi,
    /https?:\/\/[^"'\s]*api[^"'\s]*/gi,
    /fetch\s*\(\s*["']([^"']+)["']/gi,
    /axios\s*\.\s*get\s*\(\s*["']([^"']+)["']/gi,
    /url\s*:\s*["']([^"']+)["']/gi,
    /xajax[^"'\s]+/gi,
  ];
  
  for (const pattern of apiPatterns) {
    const matches = t.match(pattern);
    if (matches) {
      console.log('FL Pattern:', pattern.source.substring(0, 50));
      console.log('Matches:', [...new Set(matches)].slice(0, 20));
      console.log('---');
    }
  }
}

async function findKworkAPI() {
  const r = await fetch('https://kwork.ru/projects', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const apiPatterns = [
    /\/api\/[^"'\s]+/gi,
    /https?:\/\/[^"'\s]*api[^"'\s]*/gi,
    /fetch\s*\(\s*["']([^"']+)["']/gi,
    /axios\s*\.\s*get\s*\(\s*["']([^"']+)["']/gi,
    /url\s*:\s*["']([^"']+)["']/gi,
  ];
  
  for (const pattern of apiPatterns) {
    const matches = t.match(pattern);
    if (matches) {
      console.log('Kwork Pattern:', pattern.source.substring(0, 50));
      console.log('Matches:', [...new Set(matches)].slice(0, 20));
      console.log('---');
    }
  }
}

(async () => {
  try { await findYandexAPI(); } catch (e) { console.error('Yandex error:', e.message); }
  try { await findFLAPI(); } catch (e) { console.error('FL error:', e.message); }
  try { await findKworkAPI(); } catch (e) { console.error('Kwork error:', e.message); }
})();
