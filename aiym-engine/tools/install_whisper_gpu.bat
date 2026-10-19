@echo off
rem НЕобязательно: библиотеки CUDA для запуска Whisper на видеокарте NVIDIA (быстрее, можно модель large-v3-turbo).
rem Без них Whisper работает на процессоре. Запуск: tools\install_whisper_gpu.bat
chcp 65001 >nul
cd /d "%~dp0.."
if not exist .venv\Scripts\python.exe (echo Сначала tools\install_whisper.bat & pause & exit /b 1)
.venv\Scripts\python.exe -m pip install --upgrade nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
if errorlevel 1 (echo ОШИБКА установки & pause & exit /b 1)
echo.
echo Готово. Перезапустите Whisper (start_all.bat). Модель получше:  set WHISPER_MODEL=large-v3-turbo
pause
