const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function findYandexAPI() {
  const r = await fetch('https://rabota.yandex.ru/search/list?text=python', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const apiCalls = t.match(/https?:\/\/[^"'\s]+api[^"'\s]*/gi);
  console.log('API calls:', apiCalls ? apiCalls.slice(0, 20) : 'none');
  
  const fetchCalls = t.match(/fetch\([^)]+\)/gi);
  console.log('Fetch calls:', fetchCalls ? fetchCalls.slice(0, 10) : 'none');
  
  const xhrCalls = t.match(/XMLHttpRequest|axios|ajax/gi);
  console.log('XHR/axios:', xhrCalls ? xhrCalls.slice(0, 10) : 'none');
  
  const dataUrls = t.match(/data-url="([^"]+)"/gi);
  console.log('Data URLs:', dataUrls ? dataUrls.slice(0, 10) : 'none');
  
  const scriptSrcs = t.match(/src="([^"]+\.js[^"]*)"/gi);
  console.log('Script sources:', scriptSrcs ? scriptSrcs.slice(0, 20) : 'none');
}

async function findFLStructure() {
  const r = await fetch('https://www.fl.ru/projects/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const projectIds = t.match(/\/projects\/\d+/g);
  console.log('\nFL project IDs:', projectIds ? [...new Set(projectIds)].slice(0, 20) : 'none');
  
  const cardClasses = t.match(/class="[^"]*card[^"]*"/gi);
  console.log('Card classes:', cardClasses ? cardClasses.slice(0, 20) : 'none');
  
  const itemClasses = t.match(/class="[^"]*item[^"]*"/gi);
  console.log('Item classes:', itemClasses ? itemClasses.slice(0, 20) : 'none');
  
  const bProject = t.match(/class="[^"]*b-project[^"]*"/gi);
  console.log('b-project classes:', bProject ? bProject.slice(0, 20) : 'none');
}

async function findKworkStructure() {
  const r = await fetch('https://kwork.ru/projects', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
  });
  const t = await r.text();
  
  const projectIds = t.match(/\/projects\/\d+/g);
  console.log('\nKwork project IDs:', projectIds ? [...new Set(projectIds)].slice(0, 20) : 'none');
  
  const cardClasses = t.match(/class="[^"]*card[^"]*"/gi);
  console.log('Card classes:', cardClasses ? cardClasses.slice(0, 20) : 'none');
  
  const itemClasses = t.match(/class="[^"]*item[^"]*"/gi);
  console.log('Item classes:', itemClasses ? itemClasses.slice(0, 20) : 'none');
  
  const kwCard = t.match(/class="[^"]*kw-card[^"]*"/gi);
  console.log('kw-card classes:', kwCard ? kwCard.slice(0, 20) : 'none');
}

(async () => {
  try { await findYandexAPI(); } catch (e) { console.error('Yandex error:', e.message); }
  try { await findFLStructure(); } catch (e) { console.error('FL error:', e.message); }
  try { await findKworkStructure(); } catch (e) { console.error('Kwork error:', e.message); }
})();
