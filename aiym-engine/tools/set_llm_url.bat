@echo off
rem Адрес сервера ИИ (LM Studio) для этого компьютера -> config\local.json.   tools\set_llm_url.bat [адрес]
chcp 65001 >nul
cd /d "%~dp0.."
set "URL=%~1"
if "%URL%"=="" set /p "URL=Адрес сервера ИИ (Enter - http://localhost:1235/v1; по сети, например http://192.168.1.50:1235/v1): "
if "%URL%"=="" set "URL=http://localhost:1235/v1"
set "PYX=.venv\Scripts\python.exe"
if not exist %PYX% set "PYX=py -3"
%PYX% -c "import json,pathlib,sys; u=sys.argv[1].strip(); u=u if u.startswith(('http://','https://')) else 'http://'+u; u=u if u.rstrip('/').endswith('/v1') else u.rstrip('/')+'/v1'; p=pathlib.Path('config/local.json'); d=json.loads(p.read_text('utf-8')) if p.exists() else {}; d.setdefault('modules',{}).setdefault('brain',{}).setdefault('config',{})['url']=u; p.write_text(json.dumps(d,ensure_ascii=False,indent=1),'utf-8'); print('Сервер ИИ:',u,'-> config\\local.json')" "%URL%"
