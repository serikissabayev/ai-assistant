@echo off
rem Whisper как сервер для локальной сети (на машине с NVIDIA, например рядом с LM Studio). Установка: tools\install_whisper.bat
rem Откройте порт 8000 в брандмауэре Windows (команда ниже делает это, если окно запущено от администратора).
chcp 65001 >nul
netsh advfirewall firewall add rule name="Adina Whisper 8000" dir=in action=allow protocol=TCP localport=8000 >nul 2>nul
set WHISPER_HOST=0.0.0.0
call "%~dp0start_whisper.bat"
