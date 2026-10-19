# Piper + голоса для Windows (вызывается из install_piper.bat)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$pyv = $null
foreach ($v in "3.12", "3.11", "3.10") { & py "-$v" --version 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $pyv = "-$v"; break } }
if (-not $pyv) { Write-Host "Не нашёл Python 3.12 (3.11 / 3.10). Поставьте: winget install Python.Python.3.12 — и запустите снова."; exit 1 }
if (Test-Path .venv) { Remove-Item .venv -Recurse -Force }
& py $pyv -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -q --upgrade pip piper-tts
New-Item -ItemType Directory -Force -Path voices | Out-Null
$base = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
$voices = @("ru/ru_RU/irina/medium", "ru/ru_RU/denis/medium", "kk/kk_KZ/issai/high", "kk/kk_KZ/raya/x_low", "kk/kk_KZ/iseke/x_low")
foreach ($v in $voices) {
  $l, $f, $n, $q = $v.Split("/"); $id = "$f-$n-$q"
  if (Test-Path "voices\$id.onnx") { continue }
  try {
    Invoke-WebRequest "$base/$l/$f/$n/$q/$id.onnx" -OutFile "voices\$id.onnx"
    Invoke-WebRequest "$base/$l/$f/$n/$q/$id.onnx.json" -OutFile "voices\$id.onnx.json"
    Write-Host "ok  $id"
  } catch {
    Write-Host "ПРОПУЩЕН $id (нет такого файла)"
    Remove-Item "voices\$id.onnx", "voices\$id.onnx.json" -ErrorAction SilentlyContinue
  }
}
Write-Host "Готово. Голосов: $((Get-ChildItem voices\*.onnx -ErrorAction SilentlyContinue).Count)"
