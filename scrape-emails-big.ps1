# Parallel collector of public emails of Russian IT companies (03.10.2026)
# Run:  powershell -ExecutionPolicy Bypass -File scrape-emails-big.ps1
# Two PS 5.1 pitfalls handled here:
#   1) Invoke-WebRequest without -UseBasicParsing throws NotSupportedException (no IE engine)
#   2) runspace jobs do NOT inherit TLS settings -> set them inside the job script
# Outputs emails-big.txt / emails-big.csv
# ASCII only: PS 5.1 reads .ps1 as ANSI and mangles UTF-8 comments.

$domains = @(
  # ---- small/mid game dev studios ----
  'parapaht.ru','madmind.ru','gamedev.ru','cgstudio.ru','gamepush.com','gamesjobs.ru',
  'xgamer.ru','vrmaster.ru','vsdrive.ru','critical-force.ru','xtale.ru','blizgames.ru',
  'gamedevmarket.ru','gamejobs.ru','gamekong.ru','gamedevclub.ru',
  # ---- graphics / rendering / CAD / DCC ----
  'nanorender.ru','splatglobal.ru','center-tek.ru','tekforpro.ru','cad.ru','compass.ru',
  'nanocad.ru','gostcad.ru','indez.ru','scanex.ru','gmx.ru','basecef.ru','fem.ru',
  'cfd.ru','render.ru','krita.org','shaderslab.com',
  # ---- AI / ML / data ----
  'servionica.ru','mlcloud.ru','datalens.ru','visionlabs.ru','neuro.ru','deepcake.ru',
  'ai-jet.ru','sberdevices.ru','neurovis.io','tsquared.ai','intellivision.ai',
  # ---- fintech / bank IT ----
  'tinkoff.ru','tbank.ru','alfabank.ru','vtb.ru','gazprombank.ru','sovcombank.ru',
  'psbank.ru','rossbank.ru','modulbank.ru','tochbank.ru','b2b-center.ru','kontur.ru',
  'r7-office.ru','myoffice.ru','fns.ru','nalog.ru','kb.ru','garant.ru','consultant.ru',
  'naumen.ru','sbis.ru','avanpost.ru','datamart.ru',
  # ---- 1C / ERP / enterprise software ----
  '1c.ru','1cv.ru','bitrix24.ru','bitrix.ru','frank.ru','stackgroup.ru','rvk.ru',
  # ---- infra / cloud / hosting ----
  'timeweb.ru','timeweb.com','beget.com','beget.ru','selectel.ru','selectel.com',
  'firstvds.ru','ihor.ru','vpsina.ru','hosting.ru','masterhost.ru','webhost.ru','reg.ru',
  'nic.ru','cloud.ru','yandex.cloud','mws.ru','mtscloud.ru','sbercloud.ru','sbercloud.com',
  'cloudbeaver.io','sberrequests.ru','selectelgroup.ru',
  # ---- banks / telco / retail IT ----
  'sber.ru','sberbank.ru','sbermarketing.ru','sbersales.ru','t2.ru','tele2.ru',
  'beeline.ru','megafon.ru','mts.ru','dom.ru','rostelecom.ru','rt.ru','nbi.ru',
  'avito.ru','ozon.ru','wildberries.ru','dns-shop.ru','citilink.ru','lamoda.ru',
  'aliexpress.ru','vk.team','vk.com','ok.ru','mail.ru','rambler.ru','list.ru','bk.ru',
  # ---- logistics / geo / maps ----
  '2gis.ru','2gis.com','flamp.ru','nextgis.ru','geosam.ru','sbergeo.ru','scanex.ru',
  'pochta.ru','russianpost.ru','cde.ru','gtd.ru','deliv.ru','cargolink.ru','expeditor.ru',
  # ---- media / streaming ----
  'rutube.ru','ivi.ru','okko.ru','megogo.net','vc.ru','dtf.ru','habr.com','nplus1.ru',
  'tjournal.ru','meduza.io','afisha.ru','stopgame.ru','destructoid.ru','gamedevhq.com',
  # ---- job boards / recruiting ----
  'career.habr.com','hh.ru','getmatch.ru','gorod.work','dreamjob.ru','jobers.ru',
  'rabota.ru','superjob.ru','zarplata.ru','zarplata.ru','monster.ru','pracwork.ru',
  'avitorabota.ru','career.ru','joblab.ru','rasp.ru','trudvsem.ru','jobfilter.ru',
  'jooble.org','rabota.yandex.ru','gogolang.ru','jobs.tut.by','dev.by','hackerrank.com',
  # ---- accelerators / IT parks ----
  'innopolis.ru','itmopark.ru','sk.ru','iidf.ru','friffiy.ru','itmo.ru','skoltech.ru',
  'technopark.skol.ru','morozovpark.ru','technomoscow.ru','startup-russia.ru',
  'aftershock.ru','vsales.ru','sektor.ru','goststartup.ru','startupacademy.ru','skolkovo.ru',
  # ---- db / infra software ----
  'postgrespro.ru','clickhouse.ru','yandexdb.ru','redis.ru','elasticsearch.ru','nginx.com.ru',
  'postgresql.ru','linux.org.ru','kernel.ru','mysql.ru','mariadb.org','clickhouse.com',
  'timescale.com','yugabyte.com','questdb.io','questdb.com','tarantool.io',
  # ---- payments / fintech startups ----
  'yookassa.ru','cloudpayments.ru','paymentgate.ru','sbp.ru','miraccept.ru','acquirer.ru',
  'robokassa.ru','uniteller.ru','payeer.com','perfect.money','qiwi.ru','webmoney.ru',
  # ---- ecommerce / retail SaaS / marketing ----
  'mindbox.ru','pepperplate.ru','xcassa.ru','loyalty.ru','giftcard.ru','eskarta.ru',
  'retail.ru','cdek.ru','cdekpaketa.ru','ozon.ru','beru.ru','megamarket.ru',
  'unisender.com','sendsay.ru','letonshops.ru','esputnik.com','mindbox.ru',
  # ---- dev tools / SaaS / docs / design ----
  'jetbrains.com','sublimetext.com','notion.so','obsidian.md','miro.com','figma.com',
  'tldraw.com','excalidraw.com','cobalt.tools','ray.so','vercel.com','netlify.com',
  'digitalocean.com','hetzner.com','linode.com','render.com','fly.io','railway.app',
  'supabase.com','planetscale.com','neon.tech','upstash.com','cockroachlabs.com',
  'grafana.com','sentry.io','datadoghq.com','newrelic.com','rollbar.com',
  'elastic.co','kibana.dev','logstash.net','graylog.org','splunk.com',
  # ---- docs / learning / OSS hosting ----
  'stepik.org','coursera.org','udemy.com','javarush.ru','hexlet.io','netology.ru',
  'skillbox.ru','geekbrains.ru','prakticum.ru','yandex.ru','docs.rs','crates.io',
  'lib.rs','rust-lang.org','ziglang.org','go.dev','python.org','nodejs.org',
  'codeberg.org','git.sr.ht','sourceforge.net','launchpad.net','code.visualstudio.com',
  # ---- gamedev asset / marketplaces ----
  'itch.io','opengameart.org','polyhaven.com','ambientcg.com','sketchfab.com',
  'blendermarket.com','artstation.com','cgtrader.com','reallusion.com',
  # ---- misc software vendors ----
  'datamart.ru','deeplink.ru','goodie.io','mindup.ru','karpov.courses','netology-group.ru',
  'speakout.ru','englishviz.ru','linguaboost.ru','puzzleenglish.ru','skyeng.ru',
  'englex.ru','lingvocab.ru','galampro.ru','tanka.ru','studarium.ru','uraitest.ru'
)

$pages = @('', '/contacts', '/contact', '/about')
$bad = 'example|sentry|wixpress|schema\.org|@2x|\.png|\.jpg|\.svg|\.gif|\.webp|domain\.com|@localhost|noreply|no-reply|your|email@|antcorruption|anticorruption|securityhotline|zakupka|zakupki|compliance|copyright|abuse|dmca|legal@|moderation|secret@|u00[0-9a-f]|jquery|gstatic|cloudflare|sentry|w3\.org|example\.|test@|@2x|\.js|jquery|beacons|@sentry'

$unique = $domains | Sort-Object -Unique

$pool = [runspacefactory]::CreateRunspacePool(1, 24)
$pool.Open()

$results = New-Object System.Collections.ArrayList
$i = 0
$pending = New-Object System.Collections.ArrayList

# Launch everything first; the runspace pool throttles to 24 concurrent jobs.
# Waiting per-job (as in an earlier revision) serialized the whole run.
foreach ($d in $unique) {
  $i++
  $ps = [powershell]::Create()
  $ps.AddScript({
    param($d, $pages, $bad)
    # runspaces do not inherit TLS settings
    try {
      [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
    } catch { }
    $out = @()
    foreach ($p in $pages) {
      $u = "https://$d$p"
      try {
        $r = Invoke-WebRequest -Uri $u -TimeoutSec 8 -UseBasicParsing -MaximumRedirection 3 -ErrorAction Stop
        $m = [regex]::Matches($r.Content, '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
        foreach ($x in $m) {
          $mail = $x.Value.ToLower()
          if ($mail -match $bad) { continue }
          $out += [pscustomobject]@{ email = $mail; url = $u }
        }
      } catch { }
    }
    $out
  }).AddArgument($d).AddArgument($pages).AddArgument($bad) | Out-Null

  $ps.RunspacePool = $pool
  $null = $pending.Add(@{ ps = $ps; handle = $ps.BeginInvoke() })
}

# Collect in submission order; a domain finishes when its handle completes.
$i = 0
foreach ($item in $pending) {
  $i++
  Write-Progress -Activity 'Collecting' -Status "$i/$($pending.Count)" -PercentComplete (($i / $pending.Count) * 100)
  while (-not $item.handle.IsCompleted) { Start-Sleep -Milliseconds 120 }
  try { foreach ($r in $item.ps.EndInvoke($item.handle)) { $null = $results.Add($r) } } catch { }
  $item.ps.Dispose()
}
Write-Progress -Activity 'Collecting' -Completed
$pool.Close()
$pool.Dispose()

$seen = @{}
$rows = @()
foreach ($r in $results) {
  if ($seen.ContainsKey($r.email)) { continue }
  $seen[$r.email] = $true
  $dm = ($r.email -split '@') | Select-Object -Last 1
  $rows += [pscustomobject]@{ domain = $dm; email = $r.email; source = $r.url }
}
$rows = $rows | Sort-Object email

$rows | Export-Csv -Path 'emails-big.csv' -NoTypeInformation -Encoding UTF8
$rows | ForEach-Object { $_.email } | Set-Content 'emails-big.txt' -Encoding UTF8
Write-Host "Domains: $($unique.Count)  Unique emails: $($rows.Count)"
Write-Host "Files: emails-big.txt, emails-big.csv"