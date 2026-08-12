# Рендер секвенции для скролл-плёнки — вариант для Windows.
#
#   powershell -File render\sequence.ps1 -Frames 96 -Out D:\tmp\cafe-seq96 -Samples 128
#
# Зачем дубль к sequence.sh: длинный прогон нужно запускать процессом, который
# переживёт сессию агента, а Start-Process + git-bash на этой машине заводится
# через раз. Нативный PowerShell стартует стабильно.
#
# Готовые кадры пропускаются, поэтому прерванный прогон продолжается той же
# командой. Пока секвенция считается, scene.py править НЕЛЬЗЯ: Blender читает
# его заново на каждом кадре, и правка попадёт в середину плёнки.

param(
    [int]$Frames = 96,
    [string]$Out = "D:\tmp\cafe-seq96",
    [int]$RX = 1100,
    [int]$RY = 620,
    [int]$Samples = 128,
    [string]$Blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
    [string]$Project = "D:\Claude\projects\cafe-shachor"
)

if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Force -Path $Out | Out-Null }
Set-Location $Project

for ($i = 0; $i -lt $Frames; $i++) {
    $num = "{0:d3}" -f $i
    $file = Join-Path $Out "frame-$num.png"
    if (Test-Path $file) { continue }

    $phase = [math]::Round($i / ($Frames - 1), 4)
    # Пониженный приоритет: на шести ядрах рендер съедает машину целиком и
    # работать за ней становится невозможно. Свободные ядра Blender всё равно
    # заберёт — теряется только время, когда за компьютером реально работают.
    $proc = Start-Process -FilePath $Blender -PassThru -NoNewWindow -Wait:$false -ArgumentList @(
        '-b', '-P', 'render\scene.py', '--',
        '--phase', $phase, '--device', 'cpu', '--out', $file,
        '--samples', $Samples, '--rx', $RX, '--ry', $RY
    )
    try { $proc.PriorityClass = 'BelowNormal' } catch { }
    $proc.WaitForExit()

    "$(Get-Date -Format 'HH:mm:ss')  frame $num  phase $phase" |
        Add-Content -Path (Join-Path $Out "progress.log") -Encoding utf8
}

"$(Get-Date -Format 'HH:mm:ss')  SEQUENCE DONE $Frames frames" |
    Add-Content -Path (Join-Path $Out "progress.log") -Encoding utf8
