@echo off
rem Ставит Piper (локальный TTS) и голоса. Запуск: tools\install_piper.bat
rem Нужен Python 3.10-3.12 (на самых свежих Python нет готовых сборок).
chcp 65001 >nul
cd /d "%~dp0.."
set PYV=
for %%V in (3.12 3.11 3.10) do if not defined PYV (py -%%V --version >nul 2>nul && set PYV=-%%V)
if not defined PYV (
  echo.
  echo Не нашёл Python 3.12 ^(3.11 / 3.10^). Поставьте: winget install Python.Python.3.12
  echo затем откройте новое окно и запустите tools\install_piper.bat снова.
  pause
  exit /b 1
)
echo Использую Python %PYV%. Ставлю Piper...
if exist .venv\Scripts\python.exe (echo Использую готовое окружение .venv) else (py %PYV% -m venv .venv)
.venv\Scripts\python.exe -m pip install --upgrade pip piper-tts
if errorlevel 1 (echo ОШИБКА установки Piper & pause & exit /b 1)
rem голос синтезируется на видеокарте: onnxruntime-gpu вместо обычного onnxruntime
.venv\Scripts\python.exe -m pip uninstall -y onnxruntime >nul 2>nul
.venv\Scripts\python.exe -m pip install --upgrade onnxruntime-gpu nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
if not exist voices mkdir voices
echo Скачиваю голоса...
call :get ru ru_RU irina medium
call :get ru ru_RU denis medium
call :get kk kk_KZ issai high
call :get kk kk_KZ raya x_low
call :get kk kk_KZ iseke x_low
call :get en en_US lessac medium
call :get en en_US ryan medium
echo.
echo Готово. Перезапустите движок ^(start_all.bat^) и обновите страницу ^(Ctrl+Shift+R^).
dir /b voices\*.onnx 2>nul
pause
exit /b 0

:get
set ID=%2-%3-%4
if exist voices\%ID%.onnx goto :eof
set URL=https://huggingface.co/rhasspy/piper-voices/resolve/main/%1/%2/%3/%4/%ID%
curl -fL --progress-bar -o voices\%ID%.onnx %URL%.onnx
if errorlevel 1 goto :fail
curl -fsSL -o voices\%ID%.onnx.json %URL%.onnx.json
if errorlevel 1 goto :fail
echo ok  %ID%
goto :eof
:fail
echo ПРОПУЩЕН %ID% ^(нет такого файла^)
del voices\%ID%.onnx voices\%ID%.onnx.json 2>nul
goto :eof
