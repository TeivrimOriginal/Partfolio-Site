"""Восстановление sent-log.csv из папки отправленных.

Журнал потерян: первый прогон normalize_state.py упал ВНУТРИ записи, а
open(path,'w') обрезает файл до того, как что-то в него попадёт. Хорошо,
что папка отправленных - это сервер, а не локальный файл: список писем
восстанавливается оттуда и не зависит от того, что было в журнале.

Пишем атомарно: сначала во временный файл рядом, потом os.replace.
Так падение в любой момент не оставляет обрезанный файл.
"""
import csv, io, os, sys, json

USER = "teivrim21@gmail.com"
PASS = "ugbptbvtwjlpbknu"
ROOT = os.path.dirname(os.path.abspath(__file__))
SENT = "[Gmail]/&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"


def atomic_write_csv(path, cols, rows):
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
    os.replace(tmp, path)


def read_csv(path):
    if not os.path.exists(path):
        return [], []
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    cols = [c for c in rows[0].keys() if c is not None] if rows else []
    return rows, cols


def imap_sent():
    """Каждое письмо запрашиваем отдельно: при одной выборке на все UID
    заголовки разных писем слипаются и регулярки по порядку сопоставляют
    To с чужим Subject."""
    import subprocess
    script = r'''
$user = "%s"; $pass = "%s"
$tcp = [System.Net.Sockets.TcpClient]::new()
$ar = $tcp.BeginConnect("imap.gmail.com", 993, $null, $null)
if (-not $ar.AsyncWaitHandle.WaitOne(15000)) { Write-Output "[]"; exit 1 }
$tcp.EndConnect($ar)
$s = $tcp.GetStream(); $s.ReadTimeout = 40000
$ssl = [System.Net.Security.SslStream]::new($s, $false, ({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]))
$ssl.AuthenticateAsClient("imap.gmail.com")
$rd = [System.IO.StreamReader]::new($ssl); $wr = [System.IO.StreamWriter]::new($ssl); $wr.AutoFlush = $true
function U([string]$t) { $l=@(); while ($true) { $x=$rd.ReadLine(); if ($null -eq $x) { break }; if ($x.StartsWith($t+" ")) { return $l }; $l+=$x }; return $l }
$null = U "*"
$wr.WriteLine("a1 LOGIN `"$user`" `"$pass`""); $null = U "a1"
$wr.WriteLine('a2 SELECT "%s"'); $null = U "a2"
$wr.WriteLine("a3 UID SEARCH ALL")
$r = U "a3"
$uids = @()
foreach ($l in $r) { if ($l -match '^\* SEARCH') { $uids = (@($l -replace '^\* SEARCH\s*','') -join ' ') -split '\s+' | Where-Object { $_ } } }
$out = @()
foreach ($u in $uids) {
  $wr.WriteLine("a4 UID FETCH $u (BODY.PEEK[HEADER.FIELDS (TO SUBJECT DATE)])")
  $h = U "a4"
  $t = ($h -join "`n")
  $to = ''
  if ($t -match '(?im)^To:\s*(.+)$') { $to = $matches[1].Trim() }
  $dt = ''
  if ($t -match '(?im)^Date:\s*(.+)$') { $dt = $matches[1].Trim() }
  $out += ,@($u, $to, $dt)
}
ConvertTo-Json -Compress -InputObject @($out)
$ssl.Dispose(); $tcp.Close()
''' % (USER, PASS, SENT)

    p = subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, _ = p.communicate(timeout=180)
    txt = out.decode("utf-8", "replace").strip()
    if not txt.startswith("["):
        raise RuntimeError("IMAP вернул не JSON: %s" % txt[:200])
    data = json.loads(txt)
    if isinstance(data, dict):
        data = [data]
    return [tuple(x) for x in data]


def parse_date(hdr):
    """'Sun, 04 Oct 2026 04:16:02 -0700' -> '2026-10-04 04:16:02' в UTC+0"""
    if not hdr:
        return ""
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(hdr)
    except Exception:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def main():
    sent = imap_sent()
    print("писем в папке отправленных: %d" % len(sent))

    deals, _ = read_csv(os.path.join(ROOT, "deals.csv"))
    by_email = {}
    for d in deals:
        e = (d.get("email") or "").strip().lower()
        if e and e not in by_email:
            by_email[e] = d

    dead = {}
    rows_dead, _ = read_csv(os.path.join(ROOT, "dead-addresses.csv"))
    for r in rows_dead:
        dead[(r.get("email") or "").strip().lower()] = r

    old, old_cols = read_csv(os.path.join(ROOT, "sent-log.csv"))
    cols = old_cols or ["id", "to", "company", "subject", "sent_at",
                        "status", "error", "attach"]

    out = []
    used_emails = set()
    for uid, to, dthdr in sent:
        e = (to or "").strip().lower()
        if not e:
            continue
        d = by_email.get(e)
        rid = d["id"] if d else "?"
        used_emails.add(e)

        # был ли этот адрес уже описан в уцелевших строках журнала
        prior = next((r for r in old
                      if (r.get("to") or "").strip().lower() == e
                      and r.get("status") in ("sent", "sent-mistake")), None)

        if prior and prior.get("status") == "sent-mistake":
            st, note = "sent-mistake", prior.get("error", "")
        else:
            st, note = "sent", ""
            if e in dead:
                note = "bounce: " + (dead[e].get("smtp") or "")

        out.append({
            "id": rid,
            "to": to,
            "company": d.get("company", "") if d else "",
            "subject": prior.get("subject", "") if prior else "",
            "sent_at": parse_date(dthdr),
            "status": st,
            "error": note,
            "attach": (prior.get("attach", "") if prior else
                       ("%s-example.html + %s-admin-example.html" % (rid, rid))),
        })

    # письма, которых уже нет в папке отправленных (успешно отправленные,
    # но Gmail их скрыл) - сохраняем из уцелевших строк журнала
    for r in old:
        e = (r.get("to") or "").strip().lower()
        if e and e not in used_emails and r.get("status") in ("sent", "sent-mistake"):
            out.append(r)
            used_emails.add(e)

    out.sort(key=lambda r: r.get("sent_at") or "")

    atomic_write_csv(os.path.join(ROOT, "sent-log.csv"), cols, out)

    print("восстановлено записей: %d" % len(out))
    for r in out:
        print("   %-11s %-30s %-19s %s" % (
            r["id"], r["to"][:30], r["sent_at"], r["status"]))


if __name__ == "__main__":
    main()
