<#
  render-base.ps1
  Renders the lead base into a single self-contained base.html: sortable table,
  live filter, no CDN and no network. The workspace already ships an HTML site,
  so this stays consistent with it and works with the file double-clicked.

  Input prefers the domain-verified file (noweb-leads-verified.csv), because that
  is the one where "no website" was checked against the domain itself. Falls back
  to noweb-leads.csv.

  Run:
    powershell -ExecutionPolicy Bypass -File render-base.ps1
#>
[CmdletBinding()]
param(
  [string]$Verified = 'noweb-leads-verified.csv',
  [string]$Leads = 'noweb-leads.csv',
  [string]$Stats = 'noweb-stats.txt',
  [string]$OutFile = 'base.html'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Load-Leads($name) {
  $p = Join-Path $root $name
  if (-not (Test-Path $p)) { return $null }
  $rows = @(Import-Csv $p)
  foreach ($r in $rows) {
    if (-not $r.PSObject.Properties['okved']) { $r | Add-Member -NotePropertyName 'okved' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['region']) { $r | Add-Member -NotePropertyName 'region' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['okved_section']) { $r | Add-Member -NotePropertyName 'okved_section' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['email_best']) { $r | Add-Member -NotePropertyName 'email_best' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['email_free']) { $r | Add-Member -NotePropertyName 'email_free' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['revenue']) { $r | Add-Member -NotePropertyName 'revenue' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['phone']) { $r | Add-Member -NotePropertyName 'phone' -NotePropertyValue '' -Force }
    if (-not $r.PSObject.Properties['msp']) { $r | Add-Member -NotePropertyName 'msp' -NotePropertyValue '' -Force }
  }
  return $rows
}

$src = $null; $usedFile = ''
if (Test-Path (Join-Path $root $Verified)) { $src = Load-Leads $Verified; $usedFile = $Verified }
elseif (Test-Path (Join-Path $root $Leads)) { $src = Load-Leads $Leads; $usedFile = $Leads }
if (-not $src) { throw 'no leads file to render' }

Write-Host "rendering $($src.Count) leads from $usedFile"

# NOTE: PowerShell variable names are case-insensitive, so a local $stats would
# silently overwrite the $Stats parameter and Join-Path would get an empty path.
$statsText = ''
$statsPath = Join-Path $root $Stats
if (Test-Path $statsPath) { $statsText = [IO.File]::ReadAllText($statsPath, [Text.Encoding]::UTF8) }

$data = @()
foreach ($r in $src) {
  $mails = @()
  if ($r.email_best) { $mails += ($r.email_best -split '\|') }
  if ($r.email_free) { $mails += ($r.email_free -split '\|') }
  $mails = @($mails | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
  $data += [ordered]@{
    score = [int]$r.score
    name = $r.name
    city = $r.city
    region = $r.region
    section = $r.okved_section
    okved = $r.okved
    revenue = $r.revenue
    msp = [bool]($r.msp -match 'входит в реестр')
    mail = $mails[0]
    allMails = ($mails -join ' | ')
    phone = (($r.phone -split '\|')[0]).Trim()
    dstate = $r.domain_state
    verdict = $r.verdict
    url = $r.url
  }
}
$json = ($data | ConvertTo-Json -Compress -Depth 4)
# </script> inside JSON would close the tag early
$json = $json -replace '</', '<\\/'

$statsHtml = ''
if ($statsText) {
  $esc = $statsText -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;'
  $statsHtml = '<details class="stats"><summary>Статистика прогона</summary><pre>' + $esc + '</pre></details>'
}

$html = @"
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>База предприятий без сайта — $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm'))</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e6e9ef; --dim:#9aa4b2; --ok:#3ddc97; --warn:#ffb454; --bad:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
  header { padding:22px 24px 14px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 6px; font-size:21px; }
  .sub { color:var(--dim); font-size:13px; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; padding:16px 24px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:118px; }
  .card b { display:block; font-size:22px; }
  .card span { color:var(--dim); font-size:12px; }
  .tools { display:flex; gap:10px; flex-wrap:wrap; padding:0 24px 14px; }
  input[type=search], select { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 11px; font-size:14px; }
  input[type=search] { min-width:280px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { padding:9px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
  th { position:sticky; top:0; background:#12151b; cursor:pointer; user-select:none; white-space:nowrap; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--dim); }
  th:hover { color:var(--text); }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid var(--line); }
  .ok { color:var(--ok); border-color:#1f5c46; }
  .warn { color:var(--warn); border-color:#5c4a1f; }
  .bad { color:var(--bad); border-color:#5c2727; }
  a { color:#7fb2ff; text-decoration:none; }
  a:hover { text-decoration:underline; }
  .wrap { overflow:auto; max-height:calc(100vh - 250px); }
  .stats { padding:0 24px 28px; color:var(--dim); }
  .stats pre { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; font-size:12px; }
  .empty { padding:30px 24px; color:var(--dim); }
</style>
</head>
<body>
<header>
  <h1>Предприятия без своего сайта</h1>
  <div class="sub">источник: checko.ru (открытый реестр, только опубликованные контакты) · сгенерировано $(Get-Date -Format 'yyyy-MM-dd HH:mm') · файл: $usedFile</div>
</header>
<div class="cards" id="cards"></div>
<div class="tools">
  <input type="search" id="q" placeholder="поиск: название, город, деятельность, почта">
  <select id="fk"><option value="">любая почта</option><option value="biz">бизнес-почта (корпоративный домен)</option><option value="free">только фримейл</option></select>
  <select id="fmsp"><option value="">все</option><option value="1">только из реестра МСП</option></select>
  <select id="fv"><option value="">любой вердикт по домену</option><option value="KEEP">KEEP</option><option value="REVIEW">REVIEW</option><option value="DROP">DROP</option></select>
</div>
<div class="wrap"><table id="t">
<thead><tr>
  <th data-k="score">score</th><th data-k="name">компания</th><th data-k="city">город</th>
  <th data-k="okved">деятельность</th><th data-k="revenue">выручка</th>
  <th data-k="mail">почта</th><th data-k="phone">телефон</th><th data-k="verdict">домен</th>
</tr></thead><tbody></tbody></table></div>
<div class="empty" id="empty" style="display:none">Ничего не найдено.</div>
$statsHtml
<script>
var DATA = $json;
var FREE = /^(mail\.ru|yandex\.ru|yandex\.com|ya\.ru|bk\.ru|inbox\.ru|list\.ru|live\.ru|internet\.ru|rambler\.ru|gmail\.com|outlook\.com|hotmail\.com|icloud\.com)$/i;
var FRT = '(mail\\.ru|yandex\\.ru|yandex\\.com|ya\\.ru|bk\\.ru|inbox\\.ru|list\\.ru|live\\.ru|internet\\.ru|rambler\\.ru|gmail\\.com|outlook\\.com|hotmail\\.com|icloud\\.com)';
var freeRe = new RegExp('^' + FRT + '$', 'i');
var tb = document.querySelector('#t tbody'), q = document.getElementById('q');
var fk = document.getElementById('fk'), fmsp = document.getElementById('fmsp'), fv = document.getElementById('fv');
var sortK = 'score', sortDir = -1;

function esc(s) { return (s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function verdictClass(v) {
  if (!v) return '';
  if (v.indexOf('DROP') === 0) return 'bad';
  if (v.indexOf('REVIEW') === 0) return 'warn';
  if (v.indexOf('KEEP') === 0) return 'ok';
  return '';
}

function row(d) {
  var dom = d.mail ? d.mail.split('@')[1] : '';
  var isFree = dom ? freeRe.test(dom) : false;
  var mailCell = d.mail
    ? '<a href="mailto:' + esc(d.mail) + '">' + esc(d.mail) + '</a>' +
      (d.allMails.indexOf('|') > -1 ? '<br><span class="sub">' + d.allMails.split(' | ').length + ' адреса</span>' : '')
    : '<span class="sub">—</span>';
  var nameCell = '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.name) + '</a>' +
    (d.msp ? ' <span class="pill ok">МСП</span>' : '');
  return '<tr>' +
    '<td class="num">' + d.score + '</td>' +
    '<td>' + nameCell + '</td>' +
    '<td>' + esc(d.city) + (d.region && d.region !== d.city ? '<br><span class="sub">' + esc(d.region) + '</span>' : '') + '</td>' +
    '<td>' + esc(d.okved) + (d.section ? ' <span class="sub">' + esc(d.section) + '</span>' : '') + '</td>' +
    '<td>' + esc(d.revenue || '—') + '</td>' +
    '<td>' + mailCell + (isFree ? ' <span class="pill warn">фримейл</span>' : ' <span class="pill ok">бизнес</span>') + '</td>' +
    '<td>' + esc(d.phone || '—') + '</td>' +
    '<td><span class="pill ' + verdictClass(d.verdict) + '">' + esc(d.dstate || '—') + '</span></td>' +
    '</tr>';
}

function filtered() {
  var s = q.value.toLowerCase().trim();
  return DATA.filter(function (d) {
    if (s) {
      var hay = (d.name + ' ' + d.city + ' ' + d.region + ' ' + d.okved + ' ' + d.allMails + ' ' + (d.phone || '')).toLowerCase();
      if (hay.indexOf(s) === -1) return false;
    }
    var dom = d.mail ? d.mail.split('@')[1] : '';
    var isFree = dom ? freeRe.test(dom) : false;
    if (fk.value === 'biz' && isFree) return false;
    if (fk.value === 'free' && !isFree) return false;
    if (fmsp.value === '1' && !d.msp) return false;
    if (fv.value && (d.verdict || '').indexOf(fv.value) !== 0) return false;
    return true;
  });
}

function render() {
  var rows = filtered();
  rows.sort(function (a, b) {
    var x = a[sortK], y = b[sortK];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sortDir;
    x = (x || '').toString().toLowerCase(); y = (y || '').toString().toLowerCase();
    return x < y ? -sortDir : (x > y ? sortDir : 0);
  });
  tb.innerHTML = rows.map(row).join('');
  document.getElementById('empty').style.display = rows.length ? 'none' : 'block';
  var biz = rows.filter(function (d) { var dm = d.mail ? d.mail.split('@')[1] : ''; return dm && !freeRe.test(dm); }).length;
  var withPhone = rows.filter(function (d) { return d.phone; }).length;
  document.getElementById('cards').innerHTML =
    '<div class="card"><b>' + rows.length + '</b><span>лидов</span></div>' +
    '<div class="card"><b>' + biz + '</b><span>бизнес-почта</span></div>' +
    '<div class="card"><b>' + (rows.length - biz) + '</b><span>фримейл</span></div>' +
    '<div class="card"><b>' + withPhone + '</b><span>с телефоном</span></div>' +
    '<div class="card"><b>' + new Set(rows.map(function (d) { return d.region || '?'; })).size + '</b><span>регионов</span></div>';
}

document.querySelectorAll('th').forEach(function (th) {
  th.addEventListener('click', function () {
    var k = th.getAttribute('data-k');
    sortDir = (k === sortK) ? -sortDir : -1;
    sortK = k;
    render();
  });
});
q.addEventListener('input', render);
fk.addEventListener('change', render);
fmsp.addEventListener('change', render);
fv.addEventListener('change', render);
render();
</script>
</body>
</html>
"@

[IO.File]::WriteAllText((Join-Path $root $OutFile), $html, (New-Object Text.UTF8Encoding $false))
Write-Host "wrote $OutFile ($([Math]::Round($html.Length / 1024, 1)) KB)"
