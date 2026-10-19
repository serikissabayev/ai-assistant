@echo off
rem Запуск локального Whisper на видеокарте (http://localhost:8000/v1). Модель: set WHISPER_MODEL=large-v3 (по умолчанию large-v3-turbo)
chcp 65001 >nul
cd /d "%~dp0.."
if not exist .venv\Lib\site-packages\nvidia\cublas (
  echo Нет библиотек CUDA — ставлю их ^(один раз, пара минут^)...
  .venv\Scripts\python.exe -m pip install --upgrade nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
)
if "%WHISPER_MODEL%"=="" set WHISPER_MODEL=large-v3-turbo
.venv\Scripts\python.exe tools\whisper_server.py
pause
