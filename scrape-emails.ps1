# Collector of public emails of small IT companies (03.10.2026)
# Run: powershell -ExecutionPolicy Bypass -File scrape-emails.ps1
# -UseBasicParsing is required: PS 5.1 without the IE engine throws NotSupportedException.
# Lean version: focused domain list, 4 pages each, 8s timeout -> finishes in a few minutes.
# Outputs emails.txt (addresses only) and emails.csv (domain/email/source).

$domains = @(
  'reaktiv.ru','jetlin.ru','sm-lab.ru','azr.ru','gri.ru','itkontakt.ru','buro1440.ru',
  'mindsoftware.ru','agima.ru','aston.ru','bgrating.ru','servionica.ru','farpost.ru',
  'playstudios.io','parapaht.ru','madmind.ru','nanorender.ru','splatglobal.ru',
  'center-tek.ru','tekforpro.ru','compass.ru','itmopark.ru','innopolis.ru','sk.ru',
  'iidf.ru','friffiy.ru','yadro.ru','inno.tech','t1-cloud.ru','t1-academy.ru',
  'gamedev.ru','unity3d.ru','godotgames.ru','indiedb.com','gamedevmarket.com',
  'gamepush.ru','gamesjobs.ru','xgamer.ru','dtf.ru','stopgame.ru','destructoid.ru',
  'vsdrive.ru','vrmaster.ru','blender.org','krita.org','cgstudio.ru','render.ru',
  'shaderslab.com','learnopengl.com','opengl-tutorial.org','vulkan-tutorial.com',
  'gamedevhq.com','gamedevconf.com','khabr.ru','dtf.ru','habr.com','vc.ru',
  'career.habr.com','hh.ru','getmatch.ru','gorod.work','dreamjob.ru','rabota.ru',
  'superjob.ru','zarplata.ru','indeed.com','glassdoor.ru','monster.ru',
  'devlop.ru','livejournal.ru','pikabu.ru','t.me','rutube.ru','youtube.com',
  'itch.io','godotengine.org','rust-lang.org','ziglang.org','learncpp.com',
  'stepik.org','coursera.org','udemy.com','javarush.ru','hexlet.io','netology.ru',
  'yandex.ru','mail.ru','bk.ru','inbox.ru','list.ru','rambler.ru','yandex.ru'
)

$pages = @('', '/contacts', '/contact', '/about')
$bad   = 'example|sentry|wixpress|schema\.org|@2x|\.png|\.jpg|\.svg|domain\.com|@localhost|noreply|no-reply|your|email@|\.js$|antcorruption|anticorruption|securityhotline|zakupka|zakupki|compliance|copyright|abuse|dmca|legal@|press@|pressa@|pr@|adv@|event@|counter@|copy@|partners@|ventures@|now@|team@|helpme@|sitehelp@|accelerator@|sprint@|support@|info@'

$found = @{}
$errors = @()
$ok = @()
$i = 0
$total = ($domains | Sort-Object -Unique).Count

foreach ($d in ($domains | Sort-Object -Unique)) {
  $i++
  Write-Progress -Activity "Scraping" -Status "$i/$total $d" -PercentComplete (($i/$total)*100)
  $hit = $false
  foreach ($p in $pages) {
    $u = "https://$d$p"
    try {
      $r = Invoke-WebRequest -Uri $u -TimeoutSec 8 -UseBasicParsing -MaximumRedirection 3 -ErrorAction Stop
      $hit = $true
      $m = [regex]::Matches($r.Content, '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
      foreach ($x in $m) {
        $mail = $x.Value.ToLower()
        if ($mail -match $bad) { continue }
        if (-not $found.ContainsKey($mail)) { $found[$mail] = $u }
      }
    } catch {
      $errors += "$u -> $($_.Exception.Message -replace "`n",' ')"
    }
    Start-Sleep -Milliseconds 150
  }
  if ($hit) { $ok += $d }
}
Write-Progress -Activity "Scraping" -Completed

$rows = foreach ($k in ($found.Keys | Sort-Object)) {
  $dm = $k -split '@' | Select-Object -Last 1
  [pscustomobject]@{ domain = $dm; email = $k; source = $found[$k] }
}

$rows | Export-Csv -Path 'emails.csv' -NoTypeInformation -Encoding UTF8
$rows | ForEach-Object { $_.email } | Set-Content 'emails.txt' -Encoding UTF8
$errors | Set-Content 'emails-errors.txt' -Encoding UTF8

Write-Host "Domains in list:   $total"
Write-Host "Domains reachable: $($ok.Count)"
Write-Host "Unique emails:     $($rows.Count)"
Write-Host "Fetch errors:      $($errors.Count)"
Write-Host "Files: emails.txt, emails.csv"