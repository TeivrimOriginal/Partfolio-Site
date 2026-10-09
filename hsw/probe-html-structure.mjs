const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probeFL() {
  const r = await fetch('https://www.fl.ru/projects/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  console.log('=== FL.ru ===');
  console.log('Length:', t.length);
  
  const projectCards = t.match(/class="[^"]*project[^"]*"/gi);
  console.log('Project cards:', projectCards ? projectCards.slice(0, 10) : 'none');
  
  const links = t.match(/href="(\/projects\/[^"]+)"/g);
  console.log('Project links:', links ? links.slice(0, 10) : 'none');
  
  const titles = t.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/gi);
  console.log('Titles:', titles ? titles.slice(0, 10) : 'none');
  
  const dataAttrs = t.match(/data-[a-z-]+="[^"]*project[^"]*"/gi);
  console.log('Data attrs:', dataAttrs ? dataAttrs.slice(0, 10) : 'none');
  
  const scripts = t.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  console.log('Scripts count:', scripts ? scripts.length : 0);
  if (scripts) {
    for (const s of scripts) {
      if (s.includes('project') || s.includes('vacancy')) {
        console.log('Script with project/vacancy:', s.substring(0, 500));
      }
    }
  }
}

async function probeKwork() {
  const r = await fetch('https://kwork.ru/projects', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  console.log('\n=== Kwork ===');
  console.log('Length:', t.length);
  
  const projectCards = t.match(/class="[^"]*project[^"]*"/gi);
  console.log('Project cards:', projectCards ? projectCards.slice(0, 10) : 'none');
  
  const links = t.match(/href="(\/projects\/[^"]+)"/g);
  console.log('Project links:', links ? links.slice(0, 10) : 'none');
  
  const titles = t.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/gi);
  console.log('Titles:', titles ? titles.slice(0, 10) : 'none');
  
  const dataAttrs = t.match(/data-[a-z-]+="[^"]*project[^"]*"/gi);
  console.log('Data attrs:', dataAttrs ? dataAttrs.slice(0, 10) : 'none');
  
  const scripts = t.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  console.log('Scripts count:', scripts ? scripts.length : 0);
  if (scripts) {
    for (const s of scripts) {
      if (s.includes('project') || s.includes('vacancy')) {
        console.log('Script with project/vacancy:', s.substring(0, 500));
      }
    }
  }
}

(async () => {
  try { await probeFL(); } catch (e) { console.error('FL error:', e.message); }
  try { await probeKwork(); } catch (e) { console.error('Kwork error:', e.message); }
})();
