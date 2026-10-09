import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('hsw/hsw.sqlite');

console.log('=== Tables ===');
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).join(', '));

console.log('\n=== Vacancies by source ===');
console.log(db.prepare('SELECT source, COUNT(*) c FROM vacancies GROUP BY source').all());

console.log('\n=== Statuses ===');
console.log(db.prepare('SELECT status, COUNT(*) c FROM vacancies GROUP BY status').all());

console.log('\n=== Contacts ===');
console.log(db.prepare('SELECT kind, COUNT(*) c FROM contacts GROUP BY kind').all());

console.log('\n=== Letters ===');
console.log(db.prepare('SELECT status, COUNT(*) c FROM letters GROUP BY status').all());

console.log('\n=== Dispatches ===');
console.log(db.prepare('SELECT status, COUNT(*) c FROM dispatches GROUP BY status').all());

console.log('\n=== Recent runs ===');
console.log(db.prepare('SELECT id, started, finished, stats FROM runs ORDER BY id DESC LIMIT 5').all());
