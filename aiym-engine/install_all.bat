@echo off
rem Установка всего на новом Windows-компьютере: распознавание речи (Whisper) + голос (Piper).
rem Нужны: Git, Python 3.12 (winget install Python.Python.3.12). Запуск: install_all.bat
chcp 65001 >nul
cd /d "%~dp0"
call tools\install_whisper.bat
call tools\install_piper.bat
echo.
echo Всё установлено. Запуск: start_all.bat  ^(а LM Studio: Developer -> Start Server, порт 1235^)
pause
