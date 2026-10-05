# Перечисляет ВСЕ окна процесса, а не только MainWindowHandle.
#
# Причина: у процесса powershell, запущенного с -File, MainWindowHandle указал
# на служебное окно 160x28, а не на окно HardSearchWork 1180x720. PrintWindow
# по нему отработал успешно и вернул картинку 1063 байт — то есть «снимок
# сделан» было верно, а «снимок окна приложения» — нет. Ровно тот случай, когда
# проверка проходит, ничего не проверяя.
#
# Отбираем окно по площади и по заголовку, и печатаем все найденные, чтобы
# выбор был виден.
param(
    [int]$ProcId,
    [string]$Out = 'hsw-window.png'
)

Add-Type -AssemblyName System.Drawing

$src = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

public class WinList {
    public delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public class Info {
        public IntPtr Handle;
        public string Title;
        public int Width, Height;
        public bool Visible;
        public long Area { get { return (long)Width * Height; } }
    }

    public static List<Info> ForPid(uint target) {
        var list = new List<Info>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid != target) return true;
            RECT r;
            GetWindowRect(h, out r);
            var sb = new StringBuilder(512);
            GetWindowTextW(h, sb, 512);
            list.Add(new Info {
                Handle = h, Title = sb.ToString(),
                Width = r.Right - r.Left, Height = r.Bottom - r.Top,
                Visible = IsWindowVisible(h)
            });
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static string Shoot(IntPtr hwnd, string path) {
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return "GetWindowRect failed";
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        using (Bitmap bmp = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            bool ok = PrintWindow(hwnd, hdc, 2);
            g.ReleaseHdc(hdc);
            bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
            return (ok ? "OK" : "PrintWindow=false") + " " + w + "x" + h;
        }
    }
}
'@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing

if (-not $ProcId) {
    $p = Get-Process powershell -ErrorAction SilentlyContinue |
         Where-Object { $_.MainWindowTitle -like '*HardSearchWork*' } | Select-Object -First 1
    if (-not $p) { Write-Host 'WINDOW NOT FOUND'; exit 1 }
    $ProcId = $p.Id
}

Write-Host "процесс: $ProcId"
$wins = [WinList]::ForPid([uint32]$ProcId)
Write-Host ("окон у процесса: " + $wins.Count)
foreach ($w in $wins) {
    Write-Host ("  hwnd={0}  {1}x{2}  visible={3}  area={4}  «{5}»" -f $w.Handle, $w.Width, $w.Height, $w.Visible, $w.Area, $w.Title)
}

# Выбираем по ЗАГОЛОВКУ, а не по площади. Первая версия брала самое большое
# видимое окно и выбрала консоль PowerShell 1233x839, потому что она больше
# окна приложения 1180x720. Снимок получился «успешным» и был не тем окном —
# проверка, которая проходит, ничего не проверяя.
# Запасной вариант (окна с нужным заголовком нет) — самое большое видимое,
# но тогда это обязано быть видно в выводе.
$want = 'HardSearchWork'
$best = $wins | Where-Object { $_.Visible -and $_.Title -like "*$want*" } |
        Sort-Object -Property Area -Descending | Select-Object -First 1
$how = 'по заголовку «' + $want + '»'
if (-not $best) {
    $best = $wins | Where-Object { $_.Visible -and $_.Title -ne '' } |
            Sort-Object -Property Area -Descending | Select-Object -First 1
    $how = 'ЗАПАСНОЙ ВЫБОР: окна с нужным заголовком нет, взято самое большое'
}
if (-not $best) {
    Write-Host 'подходящего окна нет'
    exit 2
}
Write-Host ("выбрано ({0}): {1}x{2}  «{3}»" -f $how, $best.Width, $best.Height, $best.Title)
Write-Host ("PrintWindow: " + [WinList]::Shoot($best.Handle, (Join-Path $PSScriptRoot $Out)))
Write-Host ("файл: {0} Б" -f (Get-Item $Out).Length)