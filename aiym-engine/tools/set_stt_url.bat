@echo off
rem Где распознавать речь (Whisper) -> config\local.json.   tools\set_stt_url.bat [адрес]
rem Enter - на этом компьютере (нужна NVIDIA). Адрес сервера - Whisper в локальной сети (на сервере: tools\start_whisper_server.bat).
chcp 65001 >nul
cd /d "%~dp0.."
set "URL=%~1"
if "%URL%"=="" set /p "URL=Адрес Whisper (Enter - на этом компьютере; на сервере, например 192.168.1.50:8000): "
if "%URL%"=="" set "URL=http://localhost:8000/v1"
set "PYX=.venv\Scripts\python.exe"
if not exist %PYX% set "PYX=py -3"
%PYX% -c "import json,pathlib,sys; u=sys.argv[1].strip(); u=u if u.startswith(('http://','https://')) else 'http://'+u; u=u if u.rstrip('/').endswith('/v1') else u.rstrip('/')+'/v1'; p=pathlib.Path('config/local.json'); d=json.loads(p.read_text('utf-8')) if p.exists() else {}; c=d.setdefault('modules',{}).setdefault('hearing',{}).setdefault('config',{}); c['sttUrl']=u; c['sttMode']='server'; p.write_text(json.dumps(d,ensure_ascii=False,indent=1),'utf-8'); print('Whisper:',u,'-> config\\local.json')" "%URL%"
