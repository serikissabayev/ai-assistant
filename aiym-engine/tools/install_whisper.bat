@echo off
rem Ставит локальное распознавание речи (faster-whisper). Запуск: tools\install_whisper.bat
rem Нужен Python 3.10-3.12 (на самых свежих Python нет готовых сборок нужных пакетов).
chcp 65001 >nul
cd /d "%~dp0.."
set PYV=
for %%V in (3.12 3.11 3.10) do if not defined PYV (py -%%V --version >nul 2>nul && set PYV=-%%V)
if not defined PYV (
  echo.
  echo Не нашёл Python 3.12 ^(3.11 / 3.10^). У вас слишком свежий Python для Whisper.
  echo Поставьте второй Python рядом ^(старый не мешает^):
  echo     winget install Python.Python.3.12
  echo затем закройте это окно, откройте новое и запустите tools\install_whisper.bat снова.
  echo.
  pause
  exit /b 1
)
echo Использую Python %PYV%. Установка займёт 3-5 минут...
if exist .venv rmdir /s /q .venv
py %PYV% -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip faster-whisper
if errorlevel 1 (
  echo.
  echo ОШИБКА установки. Пришлите текст выше.
  pause
  exit /b 1
)
echo.
echo Готово. Запуск сервера:  tools\start_whisper.bat
pause
