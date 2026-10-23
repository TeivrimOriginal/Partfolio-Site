import csv, io, os

P = "sent-log.csv"


def atomic_write(path, cols, rows):
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
    os.replace(tmp, path)


with io.open(P, encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))
cols = [c for c in rows[0].keys() if c is not None]

changed = 0
for r in rows:
    # 21:10 03.10 - это пустой тест SMTP, отправленный по ошибке при проверке
    # отправки. Он ушёл на тот же адрес, что и настоящий отклик d003 в 22:54,
    # поэтому после восстановления из IMAP обе записи слились в одну.
    if (r.get("id") == "d003" and (r.get("sent_at") or "").startswith("2026-10-03 21:10")
            and r.get("status") == "sent"):
        r["id"] = "TEST-EMPTY"
        r["subject"] = "(без темы)"
        r["status"] = "sent-mistake"
        r["error"] = "ошибка при проверке SMTP, письмо пустое, отправлено случайно"
        r["attach"] = ""
        changed += 1

if changed:
    atomic_write(P, cols, rows)
print("исправлено записей: %d" % changed)
print("")
with io.open(P, encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        print("   %-11s %-30s %-19s %s" % (r["id"], r["to"][:30], r["sent_at"], r["status"]))
