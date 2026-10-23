import csv, io, os, shutil, sys

START = int(sys.argv[1]) if len(sys.argv) > 1 else 9
COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 3
SEND_DATE = sys.argv[3] if len(sys.argv) > 3 else "2026-10-05"

def read(p):
    with io.open(p, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    return rows, list(rows[0].keys())

def write(p, rows, cols):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)

deals, dcols = read("deals.csv")
clean, _ = read("leads-clean.csv")
with io.open("dead-addresses.csv", encoding="utf-8-sig", newline="") as f:
    dead = {r["email"].lower() for r in csv.DictReader(f)}

used = {d["email"].lower() for d in deals if d.get("email")}
have = {d["id"] for d in deals}

pool = [c for c in clean
        if c.get("email")
        and c["email"].lower() not in used
        and c["email"].lower() not in dead]
pool.sort(key=lambda c: -int(c.get("score") or 0))

made = []
for k in range(COUNT):
    n = START + k
    rid = "i%03d" % n
    if rid in have:
        continue
    if k >= len(pool):
        break
    c = pool[k]
    r = {k2: "" for k2 in dcols}
    r.update({
        "id": rid, "stage": "a1", "stage_entered": "2026-10-04",
        "next_action_date": SEND_DATE,
        "okved": "Разработка программного обеспечения",
        "score": c.get("score", ""), "email": c["email"],
        "source_url": c.get("source", ""),
        "notes": "оффер ИТ: парсер и автоматизация (партия %s)" % SEND_DATE,
    })
    deals.append(r)
    for suf in ("example", "admin-example"):
        s = "outbox/sample/i001-%s.html" % suf
        d = "outbox/sample/%s-%s.html" % (rid, suf)
        if os.path.exists(s):
            shutil.copyfile(s, d)
    made.append((rid, c["email"], c.get("score")))

write("deals.csv", deals, dcols)

print("партия на %s:" % SEND_DATE)
for rid, email, score in made:
    print("   %-6s %-34s score=%s" % (rid, email, score))
print("")
print("сделок: %d | отправлено сегодня: %d | мёртвых: %d | осталось в базе: %d" % (
    len(deals),
    len([d for d in deals if d.get("sent_date") == "2026-10-04"]),
    len(dead), len(pool)))
