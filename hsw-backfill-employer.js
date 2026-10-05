// Дописывает компаниям hh_id, которые не записались при сборе.
//
// Зачем отдельный шаг. При сборе hh_id оставался null у всех компаний:
// регулярка искала href="/employer/(\d+)" с кавычкой сразу за номером, а на
// карточке ссылка выглядит href="/employer/8975022?hhtmFrom=vacancy". Регулярка
// исправлена в hh-page.js, но в базе остались записи без номера.
//
// Почему не пересобирать всё заново. Вакансии и письма уже собраны, а повторный
// сбор заново прогонял бы заново по двадцати карточкам ради одного целого
// поля. Номер работодателя можно взять из уже сохранённой страницы, если она
// есть; иначе — сходить по карточке один раз на компанию.
//
// Проверка после шага обязательна: сколько было без номера, сколько стало.
// Молчаливый «сбор прошёл» здесь означал бы, что регулярка снова не нашла
// ничего, а снаружи это не видно.

const { open, DB_FILE, upsertCompany } = require('./hsw-db.js');
const hh = require('./hh-page.js');

const db = open(DB_FILE);

function count() {
  return {
    total: db.prepare('SELECT COUNT(*) c FROM companies').get().c,
    withId: db.prepare("SELECT COUNT(*) c FROM companies WHERE hh_id IS NOT NULL AND hh_id <> ''").get().c,
    vacancies: db.prepare('SELECT COUNT(*) c FROM vacancies').get().c,
  };
}

async function main() {
  const before = count();
  console.log('=== до ===');
  console.log('  компаний: ' + before.total + ', из них с hh_id: ' + before.withId);

  // Компания без номера, у которой есть вакансия — из неё и берём страницу.
  const rows = db.prepare(`
    SELECT DISTINCT c.id, c.name, v.site_id
    FROM companies c JOIN vacancies v ON v.company_id = c.id
    WHERE (c.hh_id IS NULL OR c.hh_id = '') AND v.is_open = 1
    ORDER BY c.id
  `).all();

  console.log('  компаний без номера, у которых есть вакансия: ' + rows.length);
  if (!rows.length) {
    console.log('  нечего восстанавливать.');
    return;
  }

  const byCompany = new Map();
  for (const r of rows) {
    if (!byCompany.has(r.id)) byCompany.set(r.id, { name: r.name, vacancy: r.site_id });
  }
  console.log('  из них компаний (в вакансиях могут повторяться): ' + byCompany.size);

  let fixed = 0;
  let failed = 0;

  for (const [id, info] of byCompany) {
    const page = await hh.fetchVacancy(info.vacancy, { attempts: 2 });
    await hh.sleep(hh.PAUSE_MS);
    if (!page) {
      failed++;
      console.log('  ' + id + ' ' + String(info.name).slice(0, 40) + ' — страница не прочитана');
      continue;
    }
    const employerId = hh.employerIdFrom(page.body);
    const v = hh.parseVacancy(page.body, info.vacancy);
    if (!employerId) {
      failed++;
      console.log('  ' + id + ' ' + String(info.name).slice(0, 40) + ' — номер работодателя не найден в разметке');
      continue;
    }
    upsertCompany(db, info.name, {
      site: 'hh',
      hh_id: employerId,
      hh_url: 'https://hh.ru/employer/' + employerId,
      source: 'hh-serp',
    });
    fixed++;
    console.log('  ' + id + ' ' + String(v.company || info.name).slice(0, 44) + ' → hh_id ' + employerId);
  }

  const after = count();
  console.log('\n=== после ===');
  console.log('  компаний: ' + after.total + ', из них с hh_id: ' + after.withId);
  console.log('  восстановлено: ' + fixed + ', не удалось: ' + failed);

  // Проверка, которая ничего не проверяет, хуже её отсутствия: выводим
  // остаток и код возврата.
  const left = after.total - after.withId;
  console.log('\n  без номера осталось: ' + left);
  if (left > 0) {
    console.log('  ИХ ПЕРЕЧЕНЬ (у них нет открытой вакансии, номер взять неоткуда):');
    for (const c of db.prepare("SELECT id, name FROM companies WHERE hh_id IS NULL OR hh_id = '' ORDER BY id").all()) {
      console.log('    ' + c.id + '  ' + String(c.name).slice(0, 50));
    }
  }
}

main()
  .catch((e) => {
    console.error('сбой: ' + e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.close());