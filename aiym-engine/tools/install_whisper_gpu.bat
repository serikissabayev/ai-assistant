@echo off
rem Библиотеки CUDA для работы на видеокарте NVIDIA: Whisper (cuBLAS, cuDNN) и Piper (onnxruntime-gpu).
rem Ассистент работает только на GPU. Запуск: tools\install_whisper_gpu.bat
chcp 65001 >nul
cd /d "%~dp0.."
if not exist .venv\Scripts\python.exe (echo Сначала tools\install_whisper.bat & pause & exit /b 1)
.venv\Scripts\python.exe -m pip install --upgrade nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
if errorlevel 1 (echo ОШИБКА установки & pause & exit /b 1)
.venv\Scripts\python.exe -m pip uninstall -y onnxruntime >nul 2>nul
.venv\Scripts\python.exe -m pip install --upgrade onnxruntime-gpu
if errorlevel 1 (echo ОШИБКА установки onnxruntime-gpu & pause & exit /b 1)
echo.
echo Готово. Перезапустите всё: start_all.bat
pause
