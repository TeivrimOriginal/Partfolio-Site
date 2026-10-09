const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probeYandex() {
  const r = await fetch('https://rabota.yandex.ru/search/list?text=python', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  console.log('=== Яндекс Работа ===');
  console.log('Length:', t.length);
  
  const m = t.match(/window\.__[A-Z_]+__/g);
  console.log('Window vars:', m ? m.slice(0, 10) : 'none');
  
  const jsonMatch = t.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    console.log('JSON found, length:', jsonMatch[1].length);
    console.log('First 3000 chars:', jsonMatch[1].substring(0, 3000));
  } else {
    console.log('No JSON found');
  }
  
  const dataState = t.match(/data-state="([^"]+)"/);
  if (dataState) {
    console.log('\ndata-state found, length:', dataState[1].length);
    console.log('First 2000 chars:', dataState[1].substring(0, 2000));
  }
}

async function probeFL() {
  const r = await fetch('https://www.fl.ru/projects/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  console.log('\n=== FL.ru ===');
  console.log('Length:', t.length);
  
  const jsonMatch = t.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    console.log('JSON found, length:', jsonMatch[1].length);
    console.log('First 3000 chars:', jsonMatch[1].substring(0, 3000));
  } else {
    console.log('No JSON found');
  }
  
  const projectLinks = t.match(/href="(\/projects\/\d+)"/g);
  console.log('Project links:', projectLinks ? projectLinks.slice(0, 10) : 'none');
}

async function probeKwork() {
  const r = await fetch('https://kwork.ru/projects', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  console.log('\n=== Kwork ===');
  console.log('Length:', t.length);
  
  const jsonMatch = t.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    console.log('JSON found, length:', jsonMatch[1].length);
    console.log('First 3000 chars:', jsonMatch[1].substring(0, 3000));
  } else {
    console.log('No JSON found');
  }
  
  const projectLinks = t.match(/href="(\/projects\/\d+)"/g);
  console.log('Project links:', projectLinks ? projectLinks.slice(0, 10) : 'none');
}

(async () => {
  try { await probeYandex(); } catch (e) { console.error('Yandex error:', e.message); }
  try { await probeFL(); } catch (e) { console.error('FL error:', e.message); }
  try { await probeKwork(); } catch (e) { console.error('Kwork error:', e.message); }
})();
