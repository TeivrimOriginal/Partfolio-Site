import glob, os

fixed = []
for p in sorted(glob.glob("*.ps1")):
    raw = open(p, "rb").read()
    if raw[:3] == b"\xef\xbb\xbf":
        continue
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        fixed.append("%-22s не UTF-8, пропущен" % p)
        continue
    open(p, "wb").write(b"\xef\xbb\xbf" + raw)
    fixed.append("%-22s BOM добавлен (%d байт)" % (p, len(raw)))

# проверка: файл должен парситься в PowerShell
print("\n".join(fixed) if fixed else "все .ps1 уже с BOM")

# итоговый контроль
bad = []
for p in sorted(glob.glob("*.ps1")):
    raw = open(p, "rb").read()
    if raw[:3] != b"\xef\xbb\xbf":
        bad.append(p)
print("")
print("без BOM осталось: %d %s" % (len(bad), bad if bad else ""))
