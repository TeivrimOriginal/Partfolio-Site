import csv, re

# домены, которые явно не про розницу/производство/услуги:
# ИТ, бухгалтерия, CRM, аудит, банки, страховые, госструктуры, платформы
EXCLUDE = re.compile(
    r'(kontur|konturfeo|nalog|audit|buhgal|account|bank|finance|finans|credit|insurance|'
    r'crm|erp|1c|sandbox|bitrix|helpdesk|help|support|service-|soft|it-|itc|web|site|'
    r'shop-|store-|market|online|hosting|cloud|vps|domain|proxy|seo|promo|reklama|'
    r'infotel|svyaz|roste|roselt|zakup|gosp|gos|mos|admin|buh|zarplata|staff|hr|'
    r'training|edu|course|school|univer|med|clinic|health|apteka|strah)', re.I)

# наоборот — вероятные получатели: производство, торговля, стройка, логистика, ремонт
GOOD = re.compile(
    r'(prom|stroy|build|montazh|remont|beton|metall|plast|perevoz|gruz|logist|'
    r'torg|market|opt|wholesale|produkt|pish|agro|fermer|ryba|meat|molo|pekar|'
    r'mebel|plit|keram|okno|potolok|pola|tech|servis|master|atelier|shvey|'
    r'komfort|zhil|stroytr|dom|inter|land|office|torgov|centr)', re.I)

rows = list(csv.DictReader(open('leads-clean.csv', encoding='utf-8')))
kept = []
for r in rows:
    dom = r['domain']
    if EXCLUDE.search(dom):
        continue
    kept.append(r)

scored = []
for r in kept:
    s = int(r['score'])
    if GOOD.search(r['domain']):
        s += 30
    # однословный домен из слова — похоже на бренд
    base = r['domain'].split('.')[0]
    if '-' not in base and 4 <= len(base) <= 12:
        s += 10
    scored.append((s, r))

scored.sort(key=lambda x: -x[0])

with open('leads-target.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=['email','domain','local','score','source'])
    w.writeheader()
    for s, r in scored:
        r2 = dict(r)
        r2['score'] = s
        w.writerow(r2)

with open('leads-target-report.txt', 'w', encoding='utf-8') as f:
    f.write('было корпоративных: %d\n' % len(rows))
    f.write('после отсева ИТ/бухгалтерии/гос: %d\n\n' % len(kept))
    f.write('ТОП-25 целей:\n')
    for i, (s, r) in enumerate(scored[:25], 1):
        f.write('%2d  %-40s %4d  %s\n' % (i, r['email'], s, r['source'][:38]))

print('готово:', len(kept), 'целей')