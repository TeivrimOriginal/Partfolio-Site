import csv, io, os, shutil

TODAY = "2026-10-04"
FOLLOWUP = "2026-10-08"   # день 4 после отправки

def read(p):
    with io.open(p, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    cols = list(rows[0].keys())
    # строка длиннее заголовка даёт в DictReader ключ None, а короче - не даёт
    # значений; csv потом падает на записи. Приводим к прямоугольной форме.
    out = []
    for r in rows:
        clean = {}
        for c in cols:
            v = r.get(c)
            clean[c] = "" if v is None else v
        out.append(clean)
    cols = [c for c in cols if c is not None]
    return out, cols

def write(p, rows, cols):
    # Атомарно: сначала во временный файл, потом замена. Прежний вариант
    # open(p,'w') обрезал файл ДО первой записи, и падение внутри csv.writer
    # оставляло пустой журнал - так был потерян sent-log.csv.
    import os as _os
    tmp = p + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
    _os.replace(tmp, p)

# ---------- 1. чистим журнал ----------
log, lcols = read("sent-log.csv")
before = len(log)

# мусорная строка от первого прогона, когда запятая не разделилась:
# id="i006,i007,i008", адрес пустой, статус failed - такого письма не существует
junk = [r for r in log
        if "," in (r.get("id") or "") or not (r.get("to") or "").strip()]
log = [r for r in log if r not in junk]

# дубликаты: одна и та же пара (id, to) со статусом sent оставляем последнюю
seen = {}
dedup = []
for r in log:
    key = ((r.get("id") or "").strip(), (r.get("to") or "").strip().lower(), r.get("status"))
    if key in seen:
        dedup[seen[key]] = None
    seen[key] = len(dedup)
    dedup.append(r)
log = [r for r in dedup if r is not None]

# ---------- 2. источник истины: что реально ушло сегодня ----------
sent_today = {}
for r in log:
    if r.get("status") == "sent" and (r.get("sent_at") or "").startswith(TODAY):
        e = (r.get("to") or "").strip().lower()
        if e:
            sent_today[e] = r.get("id")

write("sent-log.csv", log, lcols)
print("журнал: было %d, стало %d (мусорных строк удалено: %d)" % (before, len(log), len(junk)))

# ---------- 3. нормализуем ИТ-сделки по журналу ----------
deals, dcols = read("deals.csv")
have = {d["id"] for d in deals}
fixed = []

for d in deals:
    if not d["id"].startswith("i") or not d["id"][1:].isdigit():
        continue
    e = (d.get("email") or "").strip().lower()
    if e in sent_today:
        if d.get("sent_date") != TODAY or d.get("next_action_date") != FOLLOWUP:
            fixed.append(d["id"])
        d["sent_date"] = TODAY
        d["stage"] = "a1"
        d["stage_entered"] = TODAY
        d["next_action_date"] = FOLLOWUP

# ---------- 4. follow-up 1 для каждого, кто получил ИТ-оффер ----------
made = []
for d in deals:
    if not d["id"].startswith("i") or d.get("sent_date") != TODAY:
        continue
    n = int(d["id"][1:])
    rid = "fi%02d" % n
    if rid in have:
        continue
    r = {k: "" for k in dcols}
    r.update({
        "id": rid, "stage": "f1", "stage_entered": TODAY,
        "next_action_date": FOLLOWUP,
        "company": d.get("company", ""), "okved": d.get("okved", ""),
        "score": d.get("score", ""), "email": d["email"],
        "source_url": d.get("source_url", ""),
        "notes": "follow-up 1 ИТ-оффер (день 4), исходная %s" % d["id"],
    })
    deals.append(r)
    have.add(rid)
    for suf in ("example", "admin-example"):
        s = "outbox/sample/%s-%s.html" % (d["id"], suf)
        t = "outbox/sample/%s-%s.html" % (rid, suf)
        if os.path.exists(s):
            shutil.copyfile(s, t)
    made.append((rid, d["email"]))

write("deals.csv", deals, dcols)

# ---------- 5. контроль ----------
its = [d for d in deals if d["id"].startswith("i") and d["id"][1:].isdigit()]
fis = [d for d in deals if d["id"].startswith("fi")]
print("исправлено дат у сделок: %s" % (", ".join(fixed) if fixed else "нечего"))
print("ИТ-отправлено %s: %d" % (TODAY, len([d for d in its if d.get("sent_date") == TODAY])))
print("follow-up на %s: %d %s" % (FOLLOWUP, len(fis), [d["id"] for d in fis]))
print("новых follow-up: %s" % (", ".join("%s(%s)" % m for m in made) if made else "нет"))

# каждое ИТ-отправленное письмо имеет ровно один follow-up
missing = [d["id"] for d in its if d.get("sent_date") == TODAY
           and not any(f["notes"].endswith(d["id"]) for f in fis)]
print("без follow-up: %s" % (", ".join(missing) if missing else "нет"))
