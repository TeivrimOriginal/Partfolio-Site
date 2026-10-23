import csv, io, shutil

SRC = "deals.csv"
shutil.copyfile(SRC, "deals.csv.recover-20261004")

with io.open(SRC, encoding="utf-8", newline="") as f:
    rows = list(csv.DictReader(f))
    cols = list(rows[0].keys())

# --- 1. статусы, которые выставил параллельный цикл (их затёр бэкап) ---
for r in rows:
    if r["id"] in ("d003", "d005", "d006"):
        r["stage"] = "a2"
        r["next_action_date"] = "2026-10-07"
    if r["id"] == "d002":
        r["stage"] = "a2"
        r["next_action_date"] = "2026-10-07"

# --- 2. отказы почты, найденные по IMAP 04.10 ---
bounce = {
    "d001": "aspmk@astranet.ru: 550 5.1.1 User unknown",
    "d004": "24mpe@mail.ru: 550 5.2.1 mailbox terminated, user is terminated",
}
for r in rows:
    if r["id"] in bounce:
        r["stage"] = "dead"
        r["next_action_date"] = ""
        note = (r.get("notes") or "").strip().strip("; ")
        msg = "bounce " + bounce[r["id"]]
        if msg not in note:
            r["notes"] = (note + "; " + msg).strip("; ")

# --- 3. завтрашняя партия ---
new_ids = {"i003", "i004", "i005"}
have = {r["id"] for r in rows}
targets = [
    ("i003", "manager@it-klaster.com", "79"),
    ("i004", "admin@orsodin.ru", "75"),
    ("i005", "dov@it-service-guk.ru", "54"),
]
for rid, email, score in targets:
    if rid in have:
        continue
    r = {c: "" for c in cols}
    r.update({
        "id": rid, "stage": "a1", "stage_entered": "2026-10-04",
        "next_action_date": "2026-10-07",
        "okved": "Разработка программного обеспечения",
        "score": score, "email": email,
        "source_url": "https://kontur.ru/contacts",
        "notes": "оффер ИТ: парсер и автоматизация",
    })
    rows.append(r)

with io.open(SRC, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)

# --- контроль: не потерялись ли значения ---
bad = [r["id"] for r in rows if r["id"].startswith("d") and not r["email"]]
print("строк: %d, битых (нет email): %s" % (len(rows), bad or "нет"))
for r in rows:
    print("%-5s %-26s stage=%-5s next=%-11s %s" % (
        r["id"], r["email"], r["stage"], r["next_action_date"] or "-",
        (r["notes"] or "")[:38]))
