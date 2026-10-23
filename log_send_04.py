import csv, io, datetime

NOW = "2026-10-04"

# --- sent-log.csv: добавляем три подтверждённые отправки ---
with io.open("sent-log.csv", encoding="utf-8", newline="") as f:
    rows = list(csv.reader(f))
hdr = rows[0]
have = {r[0] for r in rows[1:] if r}

new = [
    ["i003", "manager@it-klaster.com", "",
     "Сбор данных и автоматизация: парсер или бот от 500 ? - пример во вложении",
     "2026-10-04 16:05:00", "sent", "",
     "i003-example.html + i003-admin-example.html"],
    ["i004", "admin@orsodin.ru", "",
     "Сбор данных и автоматизация: парсер или бот от 500 ? - пример во вложении",
     "2026-10-04 16:07:00", "sent", "",
     "i004-example.html + i004-admin-example.html"],
    ["i005", "dov@it-service-guk.ru", "",
     "Сбор данных и автоматизация: парсер или бот от 500 ? - пример во вложении",
     "2026-10-04 16:09:00", "sent", "",
     "i005-example.html + i005-admin-example.html"],
]
for r in new:
    if r[0] not in have:
        rows.append(r)

with io.open("sent-log.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
    for r in rows:
        w.writerow(r)

# --- deals.csv: sent_date / stage ---
with io.open("deals.csv", encoding="utf-8", newline="") as f:
    dl = list(csv.DictReader(f))
    cols = list(dl[0].keys())

for d in dl:
    if d["id"] in ("i003", "i004", "i005"):
        d["sent_date"] = NOW
        d["stage"] = "a1"
        d["stage_entered"] = NOW
        d["next_action_date"] = "2026-10-07"

with io.open("deals.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writeheader()
    for d in dl:
        w.writerow(d)

# --- контроль ---
with io.open("sent-log.csv", encoding="utf-8", newline="") as f:
    log = list(csv.reader(f))[1:]

sent_today = [r for r in log if len(r) > 4 and r[4].startswith(NOW) and r[5] == "sent"]
print("строк в журнале: %d" % len(log))
print("отправлено сегодня: %d" % len(sent_today))
for r in sent_today:
    print("   %-34s %s" % (r[1], r[4]))
print("всего sent: %d | failed: %d | mistake: %d" % (
    len([r for r in log if len(r) > 5 and r[5] == "sent"]),
    len([r for r in log if len(r) > 5 and r[5] == "failed"]),
    len([r for r in log if len(r) > 5 and r[5] == "sent-mistake"]),
))
