@echo off
rem Установка всего на новом Windows-компьютере: распознавание речи (Whisper), голос (Piper), голоса, модель, адрес сервера ИИ.
rem Нужны: Git, Python 3.10-3.12, драйвер NVIDIA. Запуск: install_all.bat
chcp 65001 >nul
cd /d "%~dp0"
set PYV=
for %%V in (3.12 3.11 3.10) do if not defined PYV (py -%%V --version >nul 2>nul && set PYV=-%%V)
if not defined PYV (
  echo Python 3.12 не найден - ставлю через winget...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  echo.
  echo Python поставлен. Закройте это окно, откройте новое и запустите install_all.bat ещё раз.
  pause
  exit /b 1
)
call tools\set_llm_url.bat
call tools\set_stt_url.bat
set "REMOTE_STT="
for /f "usebackq delims=" %%u in (`py %PYV% tools\stt_remote.py 2^>nul`) do set "REMOTE_STT=%%u"
where nvidia-smi >nul 2>nul && (nvidia-smi --query-gpu=name,memory.total --format=csv,noheader) || echo ВНИМАНИЕ: nvidia-smi не найден - нужен драйвер NVIDIA ^(ассистент работает только на видеокарте^).
echo Python %PYV%. Ставлю Whisper, Piper и библиотеки CUDA (несколько минут)...
if not exist .venv\Scripts\python.exe py %PYV% -m venv .venv
.venv\Scripts\python.exe -m pip install -q --upgrade pip
.venv\Scripts\python.exe -m pip install -q --upgrade faster-whisper piper-tts nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
if errorlevel 1 (echo ОШИБКА установки - пришлите текст выше & pause & exit /b 1)
.venv\Scripts\python.exe -m pip uninstall -y -q onnxruntime >nul 2>nul
.venv\Scripts\python.exe -m pip install -q --upgrade onnxruntime-gpu
if errorlevel 1 (echo ОШИБКА установки onnxruntime-gpu & pause & exit /b 1)
call :voices
if defined REMOTE_STT goto :skipmodel
echo Скачиваю модель распознавания речи large-v3-turbo (~1.6 ГБ, один раз)...
.venv\Scripts\python.exe -c "from faster_whisper.utils import download_model; download_model('large-v3-turbo')"
:skipmodel
rem ярлык на рабочем столе
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Адина.lnk'); $s.TargetPath='%~dp0start_all.bat'; $s.WorkingDirectory='%~dp0'; $s.Save()" >nul 2>nul
echo.
echo Готово. Запуск: start_all.bat  (или ярлык «Адина» на рабочем столе)
pause
exit /b 0

:voices
if not exist voices mkdir voices
echo Скачиваю голоса...
call :get ru ru_RU irina medium
call :get ru ru_RU denis medium
call :get kk kk_KZ issai high
call :get kk kk_KZ raya x_low
call :get kk kk_KZ iseke x_low
call :get en en_US lessac medium
call :get en en_US ryan medium
goto :eof

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
echo ПРОПУЩЕН %ID%
del voices\%ID%.onnx voices\%ID%.onnx.json 2>nul
goto :eof
