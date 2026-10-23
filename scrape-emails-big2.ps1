# Collector of public emails of Russian IT companies - batch 2 (03.10.2026)
# Run: powershell -ExecutionPolicy Bypass -File scrape-emails-big2.ps1
# Same PS 5.1 workarounds: -UseBasicParsing, TLS set inside the runspace job.
# ASCII only: PS 5.1 reads .ps1 as ANSI.
# Outputs emails-big2.txt / emails-big2.csv

$domains = @(
  # ---- gamedev studios & tools (new batch) ----
  'cgtechnologies.ru','paintfx.ru','pixelstorm.ru','gamerone.ru','gamevision.ru',
  'indie-games.ru','gamedevtools.ru','unitydev.ru','godotgames.ru','raylib.ru',
  'sfml.ru','sokol.ru','bgfx.ru','stb.ru','lodepng.ru','nlohmann.github.io',
  'gamedevsnow.ru','gamedevdigest.ru','indiepanda.ru','gameconf.ru','devgames.ru',
  'crossteam.ru','steamworks.dev','gamedev-job.ru','gamedevjob.ru','gamedevmarket.com',
  'keygen.games','gamemaker.com','construct.net','lumion.com','d5render.com',
  'unrealengine.com','epicgames.com','gamestudio.ru','gamestudio.dev',
  # ---- DCC / graphics / 3D / render ----
  'blendermarket.com','cgwiki.ru','3dsmax.ru','autodesk-ru.ru','solidworks.com',
  'ketchapp.ru','retopology.ru','zbrushcentral.com','substance3d.com','quixel.com',
  'evermotion.ru','maxon.net','c4d.ru','cinema4d.ru','octane.render.ru','vray.com',
  'lumionrender.ru','d5.ru','turbogarden.ru','physicallybased.info','gltrs.io',
  'hdrihaven.com','polyhaven.com','ambientcg.com','sketchfab.com','cgtrader.com',
  'artstation.com','behance.net','dribbble.com','render.ru','rendering.ru',
  # ---- CAD / BIM / engineering software ----
  'nanocad.ru','gostcad.ru','combar.ru','indez.ru','tekforpro.ru','cad.ru',
  'bim.rus.ru','bim-pro.ru','nanocad.com','acad.ru','autodesk.ru','solidworks.ru',
  'kompas.ru','komp3d.ru','tekla.ru','ptc.com','ptcparametric.com','splinter.ru',
  'splinter.pro','center-tek.ru','basecef.ru','fem.ru','cfd.ru','ansys.ru',
  'comsol.ru','star-ccmplus.ru','scad.uz','scanhatch.com','dxf2svg.com',
  # ---- AI / ML / data / CV ----
  'neuro.ru','neurotech.ru','neuroscan.ru','deepcake.ru','ai-jet.ru','ai.ru',
  'sberai.ru','sberdevices.ru','visionlabs.ru','visiontech.ru','mlcloud.ru',
  'datalens.ru','datamart.ru','data???.ru','just-ai.com','justai.ru',
  'elliptic.ru','sberml.ru','ai.com.ru','mlbootcamp.ru','ods.ai','ai-academy.ru',
  'computervision.ru','opencv.ru','pytorch.ru','tensorflow.ru','keras.io',
  # ---- backend / api / devops / infra software ----
  'clickhouse.ru','yandexdb.ru','postgrespro.ru','timescale.com','yugabyte.com',
  'questdb.io','questdb.com','tarantool.io','tarantool.org','pgbouncer.ru',
  'nginx.ru','nginx.com.ru','apache.ru','haproxy.ru','envoyproxy.io','traefik.io',
  'vault.hashicorp.com','consul.io','nomad.io','k8s.ru','kubernetes.io',
  'docker.ru','gitlab.ru','gitlab.com','gitea.ru','gitea.com','drone.io','woodpecker-ci.org',
  'argocd.io','fluxcd.io','tekton.dev','spinnaker.io','jenkins.ru','jenkins.io',
  'teamcity.ru','buildkite.com','circleci.com','travis-ci.org','github.ru',
  # ---- hosting / cloud / domains ----
  'yandex.ru','cloud.ru','sbercloud.ru','sbercloud.com','mws.ru','mtscloud.ru',
  'vkcloud.ru','selectel.ru','selectel.com','firstvds.ru','firstvds.com',
  'timeweb.ru','timeweb.com','beget.com','beget.ru','reg.ru','regru.ru',
  'masterhost.ru','masterhost.com','webhost.ru','host.ru','ihor.ru','ihor-hosting.ru',
  'vpsina.ru','vdsina.ru','ispserver.ru','ispserver.com','just-host.ru',
  'justhost.ru','savvyhost.com','steadyhost.ru','vdsina.ru','cloud-vps.ru',
  'nobl.ru','firstcloud.ru','cloudking.ru','z-com.ru','zcloud.ru','cloudflare.com',
  'nic.ru','nic.ru','tass.ru','internet.ru','mail.ru','rambler.ru','yandex.com',
  # ---- fintech / payments / banks IT ----
  'tinkoff.ru','tbank.ru','tinkoff.com','alfabank.ru','alfa-bank.ru','vtb.ru',
  'gazprombank.ru','sovcombank.ru','psbank.ru','rossbank.ru','akbars.ru',
  'modulbank.ru','tochbank.ru','b2b-center.ru','yookassa.ru','cloudpayments.ru',
  'robokassa.ru','uniteller.ru','qiwi.ru','webmoney.ru','sbp.ru','miraccept.ru',
  'paymentgate.ru','payeer.com','perfect.money','freekassa.ru','paysera.com',
  'rupeek.com','ru.capital','carusfin.ru','bravura.ru','cbr.ru','cbr.ru',
  # ---- gamedev-adjacent: media, streaming, marketplaces ----
  'rutube.ru','ivi.ru','okko.ru','megogo.net','kino.mail.ru','video.mail.ru',
  'boosty.to','donationalerts.ru','sponsr.ru','boomstream.ru','wasd.tv',
  'gog.com','rawg.io','rawgamedata.com','itch.io','mobygames.com','igdb.com',
  # ---- job boards & recruiting channels ----
  'hh.ru','getmatch.ru','gorod.work','career.habr.com','dreamjob.ru','jobers.ru',
  'rabota.ru','superjob.ru','zarplata.ru','zarplata.com','avitorabota.ru','career.ru',
  'joblab.ru','rasp.ru','trudvsem.ru','jobfilter.ru','jooble.org','rabota.yandex.ru',
  'jobvacs.ru','rjob.ru','hhcdn.ru','zarplata.ru','indeed.com','glassdoor.com',
  'monster.ru','pracwork.ru','devjobs.ru','gogolang.ru','jobs.tut.by','dev.by',
  'remotejob.ru','workzilla.ru','kwork.ru','youdo.com','profi.ru','liveprof.ru',
  'fl.ru','freelance.ru','weblancer.ru','kant.ru','dj.ru',
  # ---- accelerators / IT parks / edu ----
  'innopolis.ru','itmopark.ru','sk.ru','iidf.ru','friffiy.ru','itmo.ru',
  'skoltech.ru','technopark.skol.ru','morozovpark.ru','technomoscow.ru',
  'startup-russia.ru','aftershock.ru','vsales.ru','sektor.ru','goststartup.ru',
  'startupacademy.ru','skolkovo.ru','leader.ru','eda.ru','alumni.skol.ru',
  'netology.ru','skillbox.ru','geekbrains.ru','prakticum.ru','hexlet.io',
  'javarush.ru','yandex.ru','mail.ru','stepik.org','coursera.org','udemy.com',
  # ---- software vendors / enterprise IT ----
  '1c.ru','1cv.ru','1c-bitrix.ru','bitrix24.ru','bitrix.ru','frank.ru',
  'r7-office.ru','myoffice.ru','myoffice.team','mydocuments.ru','kontur.ru',
  'avanpost.ru','naumen.ru','sbis.ru','sbis.pro','datamart.ru','1s-erp.ru',
  'galex.uz','docsvision.ru','directum.ru','elmade.ru','codex.ru','base24.ru',
  'scs.ru',' IBS.ru','ibs.ru','lanit.ru','t1.ru','t1-cloud.ru','t1-academy.ru',
  'yadro.ru','yadro.me','innostage.ru','usolgov.ru','zvezda.ru','devoteam.ru',
  'astrum.ru','luxoft.com','epam.com','nagarro.com','softline.ru','klever.ru',
  'usolgov.ru','CIS.Asterisk.ru','gala.ru','bcom.ru','croc.ru','usm.ru',
  # ---- misc tech / media / retail ----
  'ozon.ru','wildberries.ru','avito.ru','lamoda.ru','dns-shop.ru','citilink.ru',
  'mvideo.ru','eldorado.ru','technomarket.ru','megamarket.ru','beru.ru',
  'vk.team','vk.com','ok.ru','sberdevices.ru','sbermarket.ru',
  'megafon.ru','beeline.ru','mts.ru','tele2.ru','dom.ru','rostelecom.ru','rt.ru',
  '2gis.ru','2gis.com','flamp.ru','nextgis.ru','geosam.ru','sbergeo.ru',
  'pochta.ru','russianpost.ru','cde.ru','cdekpaketa.ru','cdek.ru','deliv.ru',
  'gtd.ru','cargolink.ru','expeditor.ru','boxberry.ru','dostavista.ru','sberlogistics.ru',
  'avtosales.ru','drom.ru','auto.ru','avtocod.ru','sberauto.ru','yamagata.ru',
  'tourvisor.ru','level.travel','sletat.ru','travelata.ru','ostrovok.ru','tutu.ru',
  'gosuslugi.ru','nalog.ru','fns.ru','consultant.ru','garant.ru'
)

$pages = @('', '/contacts', '/contact', '/about')
$bad = 'example|sentry|wixpress|w3\.org|schema|cloudflare|jquery|gstatic|beacon|noreply|no-reply|postmaster|abuse|dmca|privacy|legal|moderation|spam|u00[0-9a-f]|@2x|\.js$|\.avif|\.jpeg|\.jpg|\.png|\.svg|@users|unsubscribe|bounce|gmail|mail\.ru|yandex|list\.ru|inbox\.ru|bk\.ru|rambler|icloud|outlook|proton|ya\.ru|web\.ru|qip\.ru|front-errors|@1x|@d\.dfmx|kontur(feo|23|35|40|-tm|42)|@kontur|newsletter|marketing@|billing@|sales@|press@|pressa@|pr@|adv@|security|privacy@|zapros|zakaz|card-|sm-v[0-9]|\.jpeg|\.webp|beacons|tracking|utm_'

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

$rows | Export-Csv -Path 'emails-big2.csv' -NoTypeInformation -Encoding UTF8
$rows | ForEach-Object { $_.email } | Set-Content 'emails-big2.txt' -Encoding UTF8
Write-Host "Domains: $($unique.Count)  Unique emails: $($rows.Count)"
Write-Host "Files: emails-big2.txt, emails-big2.csv"