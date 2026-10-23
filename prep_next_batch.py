import csv, io, os, shutil

ENC = "utf-8"

def read(p):
    with io.open(p, encoding=ENC, newline="") as f:
        rows = list(csv.DictReader(f))
        cols = list(rows[0].keys())
    return rows, cols

def write(p, rows, cols):
    with io.open(p, "w", encoding=ENC, newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)

deals, dcols = read("deals.csv")
clean, _ = read("leads-clean.csv")

used = {d["email"].lower() for d in deals if d.get("email")}
with io.open("dead-addresses.csv", encoding=ENC, newline="") as f:
    dead = {r["email"].lower() for r in csv.DictReader(f)}

# следующая тройка по score из ещё не тронутых
todo = [c for c in clean
        if c.get("email")
        and c["email"].lower() not in used
        and c["email"].lower() not in dead]
todo.sort(key=lambda c: -int(c.get("score") or 0))
pick = todo[:3]

for i, c in enumerate(pick, start=6):
    rid = "i00%d" % i
    if any(d["id"] == rid for d in deals):
        print("уже есть:", rid)
        continue
    r = {k: "" for k in dcols}
    r.update({
        "id": rid, "stage": "a1", "stage_entered": "2026-10-04",
        "next_action_date": "2026-10-05",
        "okved": "Разработка программного обеспечения",
        "score": c.get("score", ""), "email": c["email"],
        "source_url": c.get("source", ""),
        "notes": "оффер ИТ: парсер и автоматизация (партия 05.10)",
    })
    deals.append(r)
    # вложения переиспользуем — содержимое общее
    shutil.copyfile("outbox/sample/i001-example.html",
                    "outbox/sample/%s-example.html" % rid)
    shutil.copyfile("outbox/sample/i001-admin-example.html",
                    "outbox/sample/%s-admin-example.html" % rid)

write("deals.csv", deals, dcols)

print("подобрано на 05.10:")
for i, c in enumerate(pick, start=6):
    print("   i00%d  %-32s score=%s" % (i, c["email"], c.get("score")))
print("сделок всего: %d" % len(deals))
