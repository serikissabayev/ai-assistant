@echo off
rem Запуск всего одним кликом: Whisper (распознавание речи) + движок + браузер Edge.
rem LM Studio (мозг) запускается отдельно: Developer -> Start Server (порт 1235).
chcp 65001 >nul
cd /d "%~dp0"
if exist .venv\Scripts\python.exe (
  start "Whisper (не закрывать)" cmd /k "tools\start_whisper.bat"
) else (
  echo Whisper не установлен ^(tools\install_whisper.bat^) — запускаю без него.
)
start "Aiym engine (не закрывать)" cmd /k "start.bat"
timeout /t 4 /nobreak >nul
start msedge http://localhost:8080
