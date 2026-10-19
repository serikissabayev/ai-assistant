@echo off
rem Ставит Piper (локальный TTS) и голоса на Windows. Запуск: tools\install_piper.bat
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_piper.ps1"
pause
