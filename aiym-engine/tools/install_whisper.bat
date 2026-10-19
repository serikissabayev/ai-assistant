@echo off
rem Ставит локальное распознавание речи (faster-whisper). Запуск: tools\install_whisper.bat
chcp 65001 >nul
cd /d "%~dp0.."
where py >nul 2>nul
if %errorlevel%==0 (py -3 -m venv .venv) else (python -m venv .venv)
.venv\Scripts\python.exe -m pip install -q --upgrade pip faster-whisper
echo.
echo Готово. Запуск сервера:  tools\start_whisper.bat
pause
