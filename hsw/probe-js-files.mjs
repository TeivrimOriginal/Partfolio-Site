const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function findYandexAPI() {
  const r = await fetch('https://rabota.yandex.ru/search/list?text=python', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const scriptSrcs = t.match(/src="([^"]+\.js[^"]*)"/gi);
  if (scriptSrcs) {
    for (const src of scriptSrcs.slice(0, 5)) {
      const url = src.match(/src="([^"]+)"/)[1];
      console.log('Checking:', url);
      try {
        const jsR = await fetch(url, { headers: { 'User-Agent': UA } });
        const jsT = await jsR.text();
        
        const apiMatches = jsT.match(/["'](\/api\/[^"']+)["']/g);
        if (apiMatches) {
          console.log('  API found:', [...new Set(apiMatches)].slice(0, 10));
        }
        
        const fetchMatches = jsT.match(/fetch\s*\(\s*["']([^"']+)["']/g);
        if (fetchMatches) {
          console.log('  Fetch found:', [...new Set(fetchMatches)].slice(0, 10));
        }
        
        const urlMatches = jsT.match(/url\s*:\s*["']([^"']+)["']/g);
        if (urlMatches) {
          console.log('  URL found:', [...new Set(urlMatches)].slice(0, 10));
        }
      } catch (e) {
        console.log('  Error:', e.message);
      }
    }
  }
}

async function findFLAPI() {
  const r = await fetch('https://www.fl.ru/projects/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const scriptSrcs = t.match(/src="([^"]+\.js[^"]*)"/gi);
  if (scriptSrcs) {
    for (const src of scriptSrcs.slice(0, 5)) {
      const url = src.match(/src="([^"]+)"/)[1];
      console.log('FL Checking:', url);
      try {
        const jsR = await fetch(url, { headers: { 'User-Agent': UA } });
        const jsT = await jsR.text();
        
        const apiMatches = jsT.match(/["'](\/api\/[^"']+)["']/g);
        if (apiMatches) {
          console.log('  API found:', [...new Set(apiMatches)].slice(0, 10));
        }
        
        const fetchMatches = jsT.match(/fetch\s*\(\s*["']([^"']+)["']/g);
        if (fetchMatches) {
          console.log('  Fetch found:', [...new Set(fetchMatches)].slice(0, 10));
        }
        
        const xajaxMatches = jsT.match(/xajax[^"'\s]+/g);
        if (xajaxMatches) {
          console.log('  Xajax found:', [...new Set(xajaxMatches)].slice(0, 10));
        }
      } catch (e) {
        console.log('  Error:', e.message);
      }
    }
  }
}

async function findKworkAPI() {
  const r = await fetch('https://kwork.ru/projects', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const scriptSrcs = t.match(/src="([^"]+\.js[^"]*)"/gi);
  if (scriptSrcs) {
    for (const src of scriptSrcs.slice(0, 5)) {
      const url = src.match(/src="([^"]+)"/)[1];
      console.log('Kwork Checking:', url);
      try {
        const jsR = await fetch(url, { headers: { 'User-Agent': UA } });
        const jsT = await jsR.text();
        
        const apiMatches = jsT.match(/["'](\/api\/[^"']+)["']/g);
        if (apiMatches) {
          console.log('  API found:', [...new Set(apiMatches)].slice(0, 10));
        }
        
        const fetchMatches = jsT.match(/fetch\s*\(\s*["']([^"']+)["']/g);
        if (fetchMatches) {
          console.log('  Fetch found:', [...new Set(fetchMatches)].slice(0, 10));
        }
      } catch (e) {
        console.log('  Error:', e.message);
      }
    }
  }
}

(async () => {
  try { await findYandexAPI(); } catch (e) { console.error('Yandex error:', e.message); }
  try { await findFLAPI(); } catch (e) { console.error('FL error:', e.message); }
  try { await findKworkAPI(); } catch (e) { console.error('Kwork error:', e.message); }
})();
