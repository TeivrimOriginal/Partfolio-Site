import csv, io, os, shutil, glob, re

TODAY = "2026-10-04"
FOLLOWUP = "2026-10-08"   # день 4 после отправки

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
have = {d["id"] for d in deals}

# --- кто реально отправлен сегодня: смотрим журнал, а не догадки ---
sent_today = set()
with io.open("sent-log.csv", encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        if (r.get("status") == "sent") and (r.get("sent_at") or "").startswith(TODAY):
            sent_today.add((r.get("email") or "").strip().lower())

# --- 1. проставить sent_date тем ИТ-сделкам, чей адрес реально в журнале ---
marked = []
for d in deals:
    if not d["id"].startswith("i"):
        continue
    if d.get("sent_date"):
        continue
    if (d.get("email") or "").strip().lower() in sent_today:
        d["sent_date"] = TODAY
        d["stage"] = "a1"
        d["stage_entered"] = TODAY
        d["next_action_date"] = FOLLOWUP
        marked.append(d["id"])

# --- 2. follow-up 1 для всех, кто получил ИТ-оффер сегодня ---
made = []
for d in deals:
    if d.get("sent_date") != TODAY or not d["id"].startswith("i"):
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

print("sent_date проставлен: %s" % (", ".join(marked) if marked else "нечего"))
print("")
print("follow-up 1 на %s:" % FOLLOWUP)
for rid, email in sorted(made):
    print("   %-6s %s" % (rid, email))
print("")
print("ИТ-отправлено %s: %d | follow-up готов: %d" % (
    TODAY, len([d for d in deals if d.get("sent_date") == TODAY and d["id"].startswith("i")]),
    len([d for d in deals if d["id"].startswith("fi")])))
