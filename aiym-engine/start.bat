@echo off
rem Запуск движка на Windows:  start.bat [порт]   ->  http://localhost:8080
chcp 65001 >nul
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8080
echo Adina -^> http://localhost:%PORT%   (Ctrl+C — остановить)
where py >nul 2>nul
if %errorlevel%==0 (py -3 serve.py %PORT%) else (python serve.py %PORT%)
if errorlevel 1 echo.& echo Не запустилось. Нужен Python 3: https://www.python.org/downloads/ (при установке отметьте "Add python.exe to PATH")
pause
