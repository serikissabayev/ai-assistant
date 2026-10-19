@echo off
rem Запуск локального Whisper (http://localhost:8000/v1). Модель: set WHISPER_MODEL=medium  (small | medium | large-v3-turbo)
chcp 65001 >nul
cd /d "%~dp0.."
if "%WHISPER_MODEL%"=="" (
  if exist .venv\Lib\site-packages\nvidia\cublas (set WHISPER_MODEL=large-v3-turbo) else (set WHISPER_MODEL=small)
)
.venv\Scripts\python.exe tools\whisper_server.py
pause
