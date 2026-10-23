// Драйвер: обогащает карточки по всем собранным area подряд, в один поток.
// Параллельно hh нельзя: после ~70 запросов подряд он отдаёт 461, и половина
// выборки молча теряется.
import { spawnSync } from 'node:child_process';

const AREAS = process.argv.slice(2);
for (const a of AREAS) {
  const r = spawnSync('node', ['zenrich3.mjs', `zneigh-area${a}.json`, `zneigh-full-${a}.json`], { stdio: 'inherit', shell: true });
  if (r.status !== 0) console.log('FAILED area', a, r.status);
}
