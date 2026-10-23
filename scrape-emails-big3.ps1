# Collector of public emails - batch 3: fresh domains not touched by big/big2 (03.10.2026)
# Run: powershell -ExecutionPolicy Bypass -File scrape-emails-big3.ps1
# PS 5.1 requirements: -UseBasicParsing; TLS set inside runspace job; ASCII-only file.
# Outputs emails-big3.txt / emails-big3.csv

$domains = @(
  # ---- Russian gamedev: studios, publishers, devtools ----
  'gamedev.ru','stopgame.ru','destructoid.ru','gamespot.ru',
  'igromania.ru','3dnews.ru','ixbt.games','gamer.ru','pixabay.com','giphy.com','lemonade.dev','indie.io','gamedevshowcase.com',
  'sega.ru','nintendo.ru','playstation.ru','xbox.ru','epicgames.ru',
  'uc.ru','mail.ru','my.com','vk-games.ru','gmail.games',
  'gamedevjob.ru','gamejob.ru','gamesjobs.ru','gamedevcareer.ru','gamedevresume.ru',
  'cgwars.ru','gameart.ru','3dart.ru','render.ru','vfx.ru','motion.ru',
  'animation.ru','3dmodels.ru','turbosquid.ru','cgtrader.ru','cgchannel.com',
  'rebus-illustration.com','kroogi.com','flaticon.com','freepik.com','shutterstock.com',
  # ---- Russian indie/mobile game devs ----
  'mobigames.com','gamedevbiz.com','gamebiz.ru','igromania.ru','app2top.ru',
  'spark-interfax.ru','cnews.ru','ixbt.com','3dnews.ru',
  'dzen.ru',# ---- Rust / C++ / systems companies RU ----
  'rust-lang.ru','rust.pro','rustup.ru','crates.io','docs.rs','lib.rs',
  'oxidecomputer.com','ferrous-systems.com','tangram.dev','pingcap.com',
  'clickhouse.com','yandex.cloud','sbercloud.ru','vkcloud.ru','selectel.ru',
  'reg.ru','timeweb.ru','beget.ru','ihor.ru','masterhost.ru','webhost.ru',
  'firstvds.ru','ispserver.ru','justhost.ru','vpsina.ru','savvyhost.com',
  'z-com.ru','cloudking.ru','nobl.ru','justcloud.ru','stack.ru','ferra.ru',
  'yota.ru','beeline.ru','mts.ru','megafon.ru','tele2.ru','dom.ru',
  # ---- Backend / API / SaaS RU ----
  'selectel.ru','cloud.ru','mws.ru','mtscloud.ru','vkontakte.ru',
  'avito.ru','ozon.ru','wildberries.ru','dns-shop.ru','lamoda.ru',
  'aliexpress.ru','ozon.ru','sbermegamarket.ru','beru.ru','megamarket.ru',
  'citilink.ru','mvideo.ru','eldorado.ru','technomarket.ru','dns-shop.ru',
  'sbermarket.ru','sberdevices.ru','yandex.market.ru','ya.ru',
  # ---- Fintech / banking IT RU ----
  'tinkoff.ru','tbank.ru','alfabank.ru','vtb.ru','gazprombank.ru','sovcombank.ru',
  'psbank.ru','rossbank.ru','akbars.ru','modulbank.ru','tochbank.ru',
  'b2b-center.ru','yookassa.ru','cloudpayments.ru','robokassa.ru','uniteller.ru',
  'sbp.ru','mir-acceptance.ru','paymentgate.ru','freekassa.ru','paysera.com',
  'cbr.ru','cbrf.ru','nscbr.ru','cfe.ru','finusl.ru','zebra-pay.ru',
  # ---- IT education / courses RU ----
  'netology.ru','skillbox.ru','geekbrains.ru','prakticum.ru','hexlet.io',
  'javarush.ru','yandex.ru','practicum.ru','skillbox.ru','coursera.org',
  'stepik.org','udemy.com','pluralsight.com',
  'coursera.org','bootcamp.ru','school.brk.ru','gb.ru','academy.gov.ru',
  # ---- Job boards / recruiting RU ----
  'hh.ru','getmatch.ru','gorod.work','career.habr.com','dreamjob.ru',
  'jobers.ru','rabota.ru','superjob.ru','zarplata.ru','zarplata.com',
  'avitorabota.ru','career.ru','joblab.ru','rasp.ru','trudvsem.ru',
  'jobfilter.ru','jooble.org','rabota.yandex.ru','jobvacs.ru','rjob.ru',
  'hhcdn.ru','indeed.com','glassdoor.com','monster.ru','pracwork.ru',
  'devjobs.ru','gogolang.ru','jobs.tut.by','dev.by','remotejob.ru',
  'workzilla.ru','kwork.ru','youdo.com','profi.ru','liveprof.ru',
  'fl.ru','freelance.ru','weblancer.ru','kant.ru','dj.ru','fiverr.com',
  'upwork.com','freelancer.com','toptal.com','arc.com',
  # ---- Accelerators / parks RU ----
  'innopolis.ru','itmopark.ru','sk.ru','iidf.ru','friffiy.ru','itmo.ru',
  'skoltech.ru','technopark.skol.ru','morozovpark.ru','technomoscow.ru',
  'startup-russia.ru','aftershock.ru','vsales.ru','sektor.ru','goststartup.ru',
  'startupacademy.ru','skolkovo.ru','leader.ru','eda.ru','sk.ru',
  'rusaccelerator.ru','startup-school.ru','ycombinator.com','techstars.com',
  # ---- Enterprise software RU ----
  '1c.ru','1cv.ru','1c-bitrix.ru','bitrix24.ru','bitrix.ru','frank.ru',
  'r7-office.ru','myoffice.ru','myoffice.team','mydocuments.ru',
  'kontur.ru','avanpost.ru','naumen.ru','sbis.ru','sbis.pro','datamart.ru',
  'docsvision.ru','directum.ru','elmade.ru','codex.ru','base24.ru',
  'scs.ru','luxoft.com','epam.com','nagarro.com','softline.ru',
  'usolgov.ru','astrum.ru','devoteam.ru','innostage.ru','crocs.ru',
  'croc.ru','usm.ru','b-com.ru','gala.ru','kb.ru','garant.ru',
  'consultant.ru','fns.ru','nalog.ru','gosuslugi.ru',
  # ---- Geo / logistics / maps RU ----
  '2gis.ru','2gis.com','flamp.ru','nextgis.ru','geosam.ru','sbergeo.ru',
  'scanex.ru','pochta.ru','russianpost.ru','cde.ru','cdekpaketa.ru',
  'deliv.ru','gtd.ru','cargolink.ru','expeditor.ru','boxberry.ru',
  'dostavista.ru','sberlogistics.ru','svoe.ru','dymandi.ru','kargo.ru',
  'russianpost.ru','pochtabank.ru','postoi.ru','group.ru',
  # ---- Media / content RU ----
  'rutube.ru','ivi.ru','okko.ru','megogo.net','kino.mail.ru','video.mail.ru',
  'boosty.to','donationalerts.ru','sponsr.ru','boomstream.ru','wasd.tv',
  'vc.ru','dtf.ru','habr.com','nplus1.ru','tjournal.ru','meduza.io',
  'afisha.ru','the-village.ru','netology.ru','rbth.com','rbc.ru',
  'kommersant.ru','vedomosti.ru','gazeta.ru','lenta.ru','ria.ru',
  # ---- Retail / e-commerce RU ----
  'ozon.ru','wildberries.ru','avito.ru','dns-shop.ru','citilink.ru',
  'mvideo.ru','eldorado.ru','technomarket.ru','megamarket.ru','beru.ru',
  'lamoda.ru','rendez-vous.ru','e2e4.ru','ulmart.ru','sbermegamarket.ru',
  'ya.ru','dzen.ru','foodcloud.ru','samokat.ru',
  'sbermarket.ru','pervoe.com','vprokat.ru','avtodor.ru','drom.ru',
  'auto.ru','avtocod.ru','youla.ru','realty.yandex.ru','domclick.ru',
  'avitorabota.ru','sberbank.ru','tbank.ru','alfabank.ru',
  # ---- Telecom / mobile RU ----
  'mts.ru','beeline.ru','megafon.ru','tele2.ru','dom.ru','rostelecom.ru',
  'rt.ru','nbi.ru','wire.ru','sberdevices.ru','yandex.device',
  'honor.ru',# ---- Dev tools / OSS RU hosts ----
  'gitlab.com','github.com','bitbucket.org','codeberg.org','sourceforge.net',
  'launchpad.net','gitee.com','git.sr.ht','sourcehut.org','notabug.org',
  'tproger.ru','softwareengineering.ru',
  'golangweekly.ru','rustweekly.ru','cppweekly.ru','highload.ru','nodesk.ru',
  # ---- Security RU ----
  'ptsecurity.ru','ptsecurity.com','group-ib.ru','groupib.com',
  'kaspersky.ru','avast.com','eset.com','drweb.com',
  'solar-doctors.ru','infozavr.ru','secretstack.io','wallarm.com','zlab.com',
  # ---- Cloud / k8s / SRE RU ----
  'cloud.ru','selectel.ru','sbercloud.ru','mws.ru','vkcloud.ru','yandex.cloud',
  'deckhouse.ru','fluxcd.io','argocd.io','cilium.io','traefik.io',
  'hashicorp.com','vaultproject.io','consul.io','nomad.io','terraform.io',
  'kubernetes.io','docker.com','rancher.com','istio.io','linkerd.io',
  # ---- HR tech RU ----
  'hh.ru','getmatch.ru','dreamjob.ru','jobers.ru','gorod.work','rabota.ru','zarplata.ru','hrlink.ru','sdelano.ru',
  'talenttech.ru','sberpeople.ru','people.rambler.ru','kandisy.ru',
  'hunters.one','rekry.ru','career.habr.com','jooble.org',# ---- Additional RU software companies ----
  'ru.postgresql.org','postgrespro.ru','yandexdb.ru','clickhouse.ru',
  'tarantool.io','nginx.ru','apache.ru','linux.org.ru','kernel.ru',
  'zabbix.com','grafana.com','prometheus.io','elastic.co','splunk.com',
  'newrelic.com','datadoghq.com','sentry.io','rollbar.com','pagerduty.com',
  'atlassian.com','slack.com','notion.so','obsidian.md','figma.com',
  # ---- Cloud providers / SaaS RU ----
  'mail.ru','rambler.ru','bk.ru','list.ru','inbox.ru','ya.ru','yandex.ru',
  'alibabacloud.com','tencentcloud.com','huaweicloud.com','scaleway.com',
  'hetzner.com','digitalocean.com','linode.com','vultr.com','cloudflare.com'
)

$pages = @('', '/contacts', '/contact', '/about')
$bad = 'example|sentry|wixpress|w3\.org|schema|cloudflare|jquery|gstatic|beacon|noreply|no-reply|postmaster|abuse|dmca|privacy|legal|moderation|spam|u00[0-9a-f]|@2x|\.js$|\.avif|\.jpeg|\.jpg|\.png|\.svg|@users|unsubscribe|bounce|gmail|mail\.ru|yandex|list\.ru|inbox\.ru|bk\.ru|rambler|icloud|outlook|proton|ya\.ru|web\.ru|qip\.ru|front-errors|@1x|@d\.dfmx|kontur(feo|23|35|40|-tm|42)|@kontur|newsletter|marketing@|billing@|sales@|press@|pressa@|pr@|adv@|security|privacy@|zapros|zakaz|card-|sm-v[0-9]|\.jpeg|\.webp|beacons|tracking|utm_|/ru$|/games$|/developers$|/work$|/mobile$|/dev$|/hr$|/market\.ru|/goods$|/email$'

$unique = $domains | Sort-Object -Unique

$pool = [runspacefactory]::CreateRunspacePool(1, 24)
$pool.Open()

$results = New-Object System.Collections.ArrayList
$pending = New-Object System.Collections.ArrayList

foreach ($d in $unique) {
  $ps = [powershell]::Create()
  $ps.AddScript({
    param($d, $pages, $bad)
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

$rows | Export-Csv -Path 'emails-big3.csv' -NoTypeInformation -Encoding UTF8
$rows | ForEach-Object { $_.email } | Set-Content 'emails-big3.txt' -Encoding UTF8
Write-Host "Domains: $($unique.Count)  Unique emails: $($rows.Count)"
Write-Host "Files: emails-big3.txt, emails-big3.csv"