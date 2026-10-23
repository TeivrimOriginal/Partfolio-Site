import csv, io

P = "dead-addresses.csv"
with io.open(P, encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))
    cols = list(rows[0].keys())

# дедуп по адресу: оставляем самую свежую запись с максимальной информацией
best = {}
for r in rows:
    e = (r.get("email") or "").strip().lower()
    if not e:
        continue
    cur = best.get(e)
    if cur is None:
        best[e] = r
        continue
    # предпочитаем запись с заполненным smtp и датой отказа
    score = lambda x: (1 if x.get("smtp") else 0) + (1 if x.get("bounced_at") else 0)
    if score(r) > score(cur):
        best[e] = r

out = [best[e] for e in sorted(best)]
with io.open(P, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writeheader()
    for r in out:
        w.writerow(r)

print("было строк: %d, стало: %d" % (len(rows), len(out)))
for r in out:
    print("   %-26s %s" % (r["email"], (r.get("smtp") or "")[:52]))

# контроль: каждый мёртвый адрес реально есть в deals и помечен
with io.open("deals.csv", encoding="utf-8-sig", newline="") as f:
    deals = list(csv.DictReader(f))
for r in out:
    hit = [d for d in deals if (d.get("email") or "").lower() == r["email"]]
    print("   deals -> %-26s %s" % (
        r["email"],
        ", ".join("%s:%s" % (d["id"], d["stage"]) for d in hit) or "НЕТ СДЕЛКИ"))
