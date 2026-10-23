<#
  make-send-page.ps1 - страница для отправки писем руками, без почтового клиента.

  Зачем: если ящик недоступен для скрипта, остаётся только ручная отправка.
  Но ручная отправка - это обычно 15 минут на письмо: копировать адрес, тему,
  тело, искать файлы вложений. Здесь нажатие одной кнопки кладёт в буфер
  обмена получателя / тему / текст, рядом лежит путь к обоим вложениям.
  Остаётся: вставить, перетащить два файла, нажать "Отправить".

  Страница работает офлайн, без интернета и без библиотек.

  Run:
    powershell -ExecutionPolicy Bypass -File make-send-page.ps1
#>
[CmdletBinding()]
param(
  [string]$OutFile = 'copy-letters.html'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$indexPath = Join-Path $root 'outbox\eml-index.csv'
if (-not (Test-Path $indexPath)) { throw "нет писем: сначала make-eml.ps1 -All" }

function Read-Part([string]$emlPath, [string]$kind) {
  if (-not (Test-Path $emlPath)) { return '' }
  $raw = [IO.File]::ReadAllText($emlPath, [Text.Encoding]::UTF8)
  $m = [regex]::Match($raw, "(?s)--alt-[a-f0-9]+\r?\nContent-Type: $kind; charset=utf-8\r?\nContent-Transfer-Encoding: base64\r?\n\r?\n(.*?)\r?\n\r?\n--alt-")
  if (-not $m.Success) { return '' }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($m.Groups[1].Value -replace '\s', '')))
}
function Esc([string]$s) {
  if (-not $s) { return '' }
  $s = $s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;'
  return $s
}

$rows = @(Import-Csv $indexPath)
$cards = @()
$n = 0
foreach ($r in $rows) {
  $n++
  $emlPath = Join-Path $root ('outbox\{0}.eml' -f $r.id)
  $body = Read-Part $emlPath 'text/plain'
  if (-not $body) { Write-Host ("  {0}: письмо не прочитано, пропускаю" -f $r.id) -ForegroundColor Yellow; continue }
  $ph = @([regex]::Matches($body, '\{\w+\}')).Count
  $atts = @($r.attach, $r.attach2) | Where-Object { $_ }
  $cards += [pscustomobject]@{
    n = $n
    id = $r.id
    to = $r.to
    company = $r.company
    subject = $r.subject
    body = $body
    atts = $atts
    placeholders = $ph
    chars = $body.Length
  }
  Write-Host ("  {0}  {1,-26} {2,5} симв., вложений: {3}" -f $r.id, $r.to, $body.Length, $atts.Count)
}

if ($cards.Count -eq 0) { throw 'ни одного письма не прочиталось' }

$dataJson = ($cards | ForEach-Object {
  [pscustomobject]@{ n = $_.n; id = $_.id; to = $_.to; company = $_.company; subject = $_.subject; body = $_.body; atts = $_.atts }
} | ConvertTo-Json -Compress -Depth 4)
$dataJson = $dataJson -replace '</', '<\\/'

$html = @"
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отправка писем - руками ($($cards.Count) шт)</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e6e9ef;--dim:#98a2b3;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b;--acc:#4c8dff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  header{padding:20px 24px 12px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
  h1{margin:0 0 4px;font-size:20px}
  .sub{color:var(--dim);font-size:13px}
  .bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}
  .btn{background:var(--acc);color:#fff;border:0;border-radius:9px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
  .btn:hover{filter:brightness(.92)}
  .btn.g{background:transparent;border:1px solid var(--acc);color:var(--acc)}
  .btn.s{padding:6px 11px;font-size:13px}
  .ok{color:var(--ok)}
  main{padding:18px 24px 60px;max-width:1000px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
  .card h2{margin:0 0 4px;font-size:17px}
  .co{color:var(--dim);font-size:13px;margin-bottom:14px}
  .row{display:grid;gap:10px;grid-template-columns:110px 1fr;align-items:start;margin-bottom:10px}
  .lbl{color:var(--dim);font-size:13px;padding-top:8px}
  .val{background:#0e1014;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:14px;word-break:break-all;display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
  .val span{flex:1}
  pre{white-space:pre-wrap;word-break:break-word;background:#0e1014;border:1px solid var(--line);border-radius:8px;padding:12px;font:13.5px/1.55 ui-monospace,Consolas,monospace;max-height:340px;overflow:auto;margin:0}
  .att{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .pill{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12.5px;color:var(--dim)}
  .pill b{color:var(--text);font-weight:600}
  .warn{border-left:3px solid var(--warn);padding:10px 13px;background:#1a1509;border-radius:0 8px 8px 0;font-size:13.5px;margin:0 0 14px;color:#f5d9a8}
  .check{display:flex;gap:9px;align-items:center;font-size:13.5px;color:var(--dim);margin-top:10px}
  input[type=checkbox]{width:17px;height:17px;accent-color:var(--ok)}
  .done{opacity:.45}
  .done h2::after{content:" - отправлено";color:var(--ok);font-size:13px;font-weight:400}
  .hint{color:var(--dim);font-size:12.5px;margin-top:6px}
</style>
</head>
<body>
<header>
  <h1>Отправка писем вручную</h1>
  <div class="sub">$($cards.Count) писем · нажатие кнопки кладёт текст в буфер · вложение прикрепляется перетаскиванием</div>
  <div class="bar">
    <button class="btn" onclick="copyAll()">Скопировать всё (по очереди)</button>
    <button class="btn g s" onclick="reset()">Снять все отметки</button>
    <span id="prog" class="sub"></span>
  </div>
</header>
<main>
  <div class="warn">
    <b>Правила, из-за которых письмо не улетает в спам:</b> один получатель (никогда не списком),
    копии и скрытые получатели пустые, приложение <b>перетаскиванием</b> (не кнопкой «вложить» из письма),
    отправка не чаще 3 в день. В каждом письме уже есть выход «стоп» и указание источника контакта.
  </div>
  <div id="list"></div>
</main>
<script>
var DATA = $dataJson;

function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}

function copy(txt,btn,label){
  var done=function(){
    var old=btn.textContent; btn.textContent='скопировано';
    btn.classList.add('ok');
    setTimeout(function(){btn.textContent=old;btn.classList.remove('ok')},1400);
  };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,fallback);
  } else fallback();
  function fallback(){
    var ta=document.createElement('textarea');
    ta.value=txt; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select();
    try{document.execCommand('copy');done()}catch(e){}
    document.body.removeChild(ta);
  }
}

function build(){
  document.getElementById('list').innerHTML = DATA.map(function(d,i){
    return '<div class="card" id="c'+d.id+'">'+
      '<h2>'+d.n+'. '+esc(d.company)+'</h2>'+
      '<div class="co">'+esc(d.id)+' · '+d.chars+' симв. вложений: '+d.atts.length+'</div>'+
      '<div class="row"><div class="lbl">Кому</div><div class="val"><span id="to'+d.id+'">'+esc(d.to)+'</span>'+
        '<button class="btn g s" onclick="copy(document.getElementById(\'to'+d.id+'\').textContent,this)">копировать</button></div></div>'+
      '<div class="row"><div class="lbl">Тема</div><div class="val"><span id="sb'+d.id+'">'+esc(d.subject)+'</span>'+
        '<button class="btn g s" onclick="copy(document.getElementById(\'sb'+d.id+'\').textContent,this)">копировать</button></div></div>'+
      '<div class="row"><div class="lbl">Текст</div><div>'+
        '<pre id="bd'+d.id+'">'+esc(d.body)+'</pre>'+
        '<div class="att"><button class="btn s" onclick="copy(document.getElementById(\'bd'+d.id+'\').textContent,this)">скопировать текст</button></div>'+
      '</div></div>'+
      '<div class="row"><div class="lbl">Приложить</div><div><div class="att">'+
        d.atts.map(function(a){return '<span class="pill"><b>'+esc(a)+'</b> · outbox\\sample\\</span>'}).join('')+
      '</div><div class="hint">перетащи оба файла из папки <code>outbox\\sample\\</code> в окно письма</div></div></div>'+
      '<label class="check"><input type="checkbox" onchange="mark(this,\''+d.id+'\')"> отправлено</label>'+
    '</div>';
  }).join('');
  prog();
}

function mark(cb,id){
  cb.closest('.card').classList.toggle('done',cb.checked);
  try{localStorage.setItem('sent-'+id,cb.checked?'1':'0')}catch(e){}
  prog();
}

function prog(){
  var boxes=document.querySelectorAll('.check input');
  var n=0; boxes.forEach(function(b){if(b.checked)n++});
  document.getElementById('prog').textContent='отправлено '+n+' из '+boxes.length;
}

function reset(){
  document.querySelectorAll('.check input').forEach(function(b){
    b.checked=false; b.closest('.card').classList.remove('done');
  });
  DATA.forEach(function(d){try{localStorage.setItem('sent-'+d.id,'0')}catch(e){}});
  prog();
}

function copyAll(){
  DATA.forEach(function(d,i){
    setTimeout(function(){copy(d.to,document.querySelector('#c'+d.id+' .val .btn'))},i*3000);
    setTimeout(function(){copy(d.subject,document.querySelectorAll('#c'+d.id+' .val .btn')[1])},i*3000+900);
  });
  alert('Скопированы адреса и темы. Текст письма длинный - копируй кнопкой у каждого письма отдельно.');
}

build();
DATA.forEach(function(d){
  var k='sent-'+d.id;
  try{ if(localStorage.getItem(k)==='1'){ var cb=document.querySelector('#c'+d.id+' .check input'); if(cb){cb.checked=true;cb.closest('.card').classList.add('done')} } }catch(e){}
});
prog();
</script>
</body>
</html>
"@

[IO.File]::WriteAllText((Join-Path $root $OutFile), $html, (New-Object Text.UTF8Encoding $false))
Write-Host ''
Write-Host ("собрано писем: {0} -> {1} ({2:N0} КБ)" -f $cards.Count, $OutFile, ($html.Length / 1024))
$bad = @($cards | Where-Object { $_.placeholders -gt 0 })
if ($bad.Count -gt 0) { Write-Host ("ВНИМАНИЕ: в {0} письмах остались плейсхолдеры - не отправляй" -f $bad.Count) -ForegroundColor Red }
else { Write-Host 'плейсхолдеров нет ни в одном письме' }
Write-Host ''
Write-Host 'Открой файл двойным кликом, жми кнопки копирования и отправляй.'
