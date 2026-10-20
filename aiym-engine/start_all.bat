@echo off
rem Запуск всего одним кликом: Whisper (распознавание речи) + движок + браузер Edge.
rem LM Studio (мозг) запускается отдельно: Developer -> Start Server (порт 1235).
chcp 65001 >nul
cd /d "%~dp0"
set "REMOTE_STT="
set "PYX=.venv\Scripts\python.exe"
if not exist %PYX% set "PYX=py -3"
for /f "usebackq delims=" %%u in (`%PYX% tools\stt_remote.py 2^>nul`) do set "REMOTE_STT=%%u"
if defined REMOTE_STT (
  echo Whisper - на сервере: %REMOTE_STT% ^(локально не запускаю^)
) else if exist .venv\Scripts\python.exe (
  start "Whisper (не закрывать)" cmd /k "tools\start_whisper.bat"
) else (
  echo Whisper не установлен ^(install_all.bat^) - запускаю без него.
)
start "Adina engine (не закрывать)" cmd /k "start.bat"
timeout /t 4 /nobreak >nul
start msedge http://localhost:8080
