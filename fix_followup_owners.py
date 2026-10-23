import csv, io, os, shutil

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

# --- 1. убрать f-сделки: follow-up по d-получателям ведёт параллельный цикл
#        (followup-1-500.txt, stage a2, 07.10). Два follow-up в один день =
#        жалоба на спам и потерянный ящик. ---
drop = {"f002", "f003", "f005", "f006"}
kept = [d for d in deals if d["id"] not in drop]
removed = len(deals) - len(kept)
deals = kept

# --- 2. свои follow-up: только по ИТ-получателям i001..i005 (предложение про
#        парсеры уходило отсюда, у параллельного цикла таких писем нет).
#        День 4 после отправки 04.10 -> 08.10. ---
have = {d["id"] for d in deals}
made = []
for n in range(1, 6):
    base = "i00%d" % n
    rid = "fi%02d" % n
    src = next((d for d in deals if d["id"] == base), None)
    if not src:
        continue
    if rid in have:
        print("уже есть:", rid)
        continue
    r = {k: "" for k in dcols}
    r.update({
        "id": rid, "stage": "f1", "stage_entered": "2026-10-04",
        "next_action_date": "2026-10-08",
        "company": src.get("company", ""),
        "okved": src.get("okved", ""),
        "score": src.get("score", ""),
        "email": src["email"],
        "source_url": src.get("source_url", ""),
        "notes": "follow-up 1 ИТ-оффер (день 4), исходная %s" % base,
    })
    deals.append(r)
    # оба примера обязательны: префлайт требует вложение и админ-пример
    for suf in ("example", "admin-example"):
        s = "outbox/sample/%s-%s.html" % (base, suf)
        d = "outbox/sample/%s-%s.html" % (rid, suf)
        if os.path.exists(s):
            shutil.copyfile(s, d)
    made.append((rid, src["email"]))

write("deals.csv", deals, dcols)

# --- 3. убрать письма снятых f-сделок ---
for rid in sorted(drop):
    for p in ("outbox/%s.eml" % rid,
              "outbox/sample/%s-example.html" % rid,
              "outbox/sample/%s-admin-example.html" % rid):
        if os.path.exists(p):
            os.remove(p)

print("снято f-сделок (дубль параллельного цикла): %d" % removed)
print("")
print("follow-up 1 ИТ-оффер на 08.10:")
for rid, email in made:
    print("   %-6s %s" % (rid, email))
print("")
print("сделок всего: %d" % len(deals))
