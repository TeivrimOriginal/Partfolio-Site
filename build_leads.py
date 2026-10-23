import csv, glob, re, sys
from collections import OrderedDict

FREE = {'mail.ru','yandex.ru','yandex.com','bk.ru','list.ru','inbox.ru','rambler.ru',
        'gmail.com','ya.ru','outlook.com','hotmail.com','mail.com','icloud.com','aol.com'}

# площадки и сервисы, откуда адреса не являются целевыми компаниями
PLATFORM = {'rutube.ru','skillbox.ru','kontur.ru','checko.ru','nalog.ru','avito.ru',
            'ozon.ru','wildberries.ru','sberbank.ru','gosuslugi.ru','vk.com','t.me',
            '1x.avif','avif','png','jpg','jpeg','webp'}

ROLE = ('info','admin','sales','office','contact','mail','hello','hi','zakaz','order',
        'reklama','market','director','buh','secretar','manager','commercial','partners',
        'press','hr','support','service','client','buy','opt','svyaz','connect')

bad = 0
leads = OrderedDict()

for fn in ['emails-roles.csv','emails-big.csv','emails-big2.csv','emails-big3.csv','emails-v2.csv']:
    try:
        rows = list(csv.DictReader(open(fn, encoding='utf-8-sig')))
    except Exception:
        continue
    for r in rows:
        email = (r.get('email') or '').strip().lower()
        if '@' not in email:
            continue
        local, dom = email.rsplit('@', 1)
        if dom in FREE or dom in PLATFORM:
            bad += 1
            continue
        if not re.match(r'^[a-z0-9.-]+\.[a-z]{2,}$', dom):
            bad += 1
            continue
        # хеш-подобные и служебные ящики
        if len(local) > 24 and re.match(r'^[0-9a-f]+$', local):
            bad += 1
            continue
        if re.match(r'^(no-?reply|noreply|postmaster|abuse|mailer-daemon|donotreply|notification|notify|bounce)', local):
            bad += 1
            continue
        if local.startswith('test') or local.endswith('.test'):
            bad += 1
            continue
        # домен из одной цифры или из букв короче 4 - мусор
        base = dom.split('.')[0]
        if re.match(r'^\d+x?$', base) or len(base) < 4:
            bad += 1
            continue
        if email in leads:
            continue

        score = 0
        if local in ROLE:
            score += 40
        elif re.match(r'^(info|admin|sales|office)[0-9.]*$', local):
            score += 30
        elif re.match(r'^[a-z]{2,6}[0-9]{0,3}$', local):
            score += 12
        else:
            score += 6
        # источник: kontur выдаёт реальные контакты компаний
        src = (r.get('source') or '')
        if 'kontur' in src:
            score += 25
        elif 'rabota' in src:
            score += 18
        elif 'hh' in src:
            score += 15
        # длина домена как признак настоящего сайта
        score += min(len(dom), 20)

        leads[email] = {
            'email': email, 'domain': dom, 'local': local,
            'score': score, 'source': src
        }

ordered = sorted(leads.values(), key=lambda x: -x['score'])

with open('leads-clean.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=['email','domain','local','score','source'])
    w.writeheader()
    w.writerows(ordered)

with open('leads-report.txt', 'w', encoding='utf-8') as f:
    f.write('всего уникальных корпоративных: %d\n' % len(ordered))
    f.write('отброшено мусора: %d\n\n' % bad)
    f.write('ТОП-30 по оценке:\n')
    for i, x in enumerate(ordered[:30], 1):
        f.write('%2d  %-46s %4d  %s\n' % (i, x['email'], x['score'], x['source'][:40]))

print('готово:', len(ordered), 'лидов')