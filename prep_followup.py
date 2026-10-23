import csv, io, shutil

ENC = "utf-8"

def read(p):
    # utf-8-sig: файл по очереди пишут PowerShell и Python, у одного BOM есть,
    # у другого нет - без снятия BOM первый ключ становится '\ufeff"id"'.
    with io.open(p, encoding="utf-8-sig", newline="") as f:
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

with io.open("dead-addresses.csv", encoding="utf-8-sig", newline="") as f:
    dead = {r["email"].lower() for r in csv.DictReader(f)}

# кому уходил первый контакт и кто ещё жив
base_ids = ["d002", "d003", "d005", "d006"]
by_id = {d["id"]: d for d in deals}

made = []
for bid in base_ids:
    src = by_id.get(bid)
    if not src:
        print("нет исходной сделки:", bid)
        continue
    email = (src.get("email") or "").lower()
    if not email or email in dead:
        print("пропущен (мёртвый/нет почты):", bid, email)
        continue
    rid = "f" + bid[1:]
    if any(d["id"] == rid for d in deals):
        print("уже есть:", rid)
        continue
    r = {k: "" for k in dcols}
    r.update({
        "id": rid, "stage": "f1", "stage_entered": "2026-10-04",
        "next_action_date": "2026-10-11",
        "company": src.get("company", ""),
        "okved": src.get("okved", ""),
        "score": src.get("score", ""),
        "email": src["email"],
        "source_url": src.get("source_url", ""),
        "notes": "follow-up 1 (4 дня), исходная %s" % bid,
    })
    deals.append(r)
    # вложения те же, что в первом письме - префлайт требует оба примера
    shutil.copyfile("outbox/sample/%s-example.html" % bid,
                    "outbox/sample/%s-example.html" % rid)
    shutil.copyfile("outbox/sample/%s-admin-example.html" % bid,
                    "outbox/sample/%s-admin-example.html" % rid)
    made.append((rid, src["email"]))

write("deals.csv", deals, dcols)

print("")
print("follow-up 1 готов на 07.10:")
for rid, email in made:
    print("   %-6s %s" % (rid, email))
print("сделок всего: %d" % len(deals))
