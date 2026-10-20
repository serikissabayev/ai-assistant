# Установка ассистента на новый компьютер (Windows или Linux)

Нужно: видеокарта **NVIDIA** с драйвером, интернет на время установки (~5 ГБ: библиотеки CUDA, модель Whisper, голоса), микрофон и камера, браузер Edge или Chrome.
Мозг (LM Studio) может стоять на этом же компьютере или на другом в локальной сети.

## Windows

1. Поставьте Git и Python 3.12 (если их нет). В **cmd**:
   ```
   winget install -e --id Git.Git
   winget install -e --id Python.Python.3.12
   ```
   После этого закройте cmd и откройте новое окно.
2. Скачайте проект и запустите установку:
   ```
   cd /d %USERPROFILE%\Documents
   git clone https://github.com/serikissabayev/ai-assistant.git
   cd ai-assistant\aiym-engine
   install_all.bat
   ```
   В конце установщик спросит **адрес сервера ИИ**: Enter — `http://localhost:1235/v1`, или впишите адрес в сети, например `http://192.168.1.50:1235/v1`.
3. Запуск: `start_all.bat` или ярлык **«Адина»** на рабочем столе.

## Linux (Ubuntu / Debian / Fedora)

1. Подготовка (Ubuntu): `sudo apt install git curl` (если в системе Python новее 3.12 — установщик сам поставит отдельный Python 3.12 через uv, системный не трогает) и драйвер NVIDIA (`sudo ubuntu-drivers install`, затем перезагрузка).
2. Скачайте проект и запустите установку:
   ```
   cd ~
   git clone https://github.com/serikissabayev/ai-assistant.git
   cd ai-assistant/aiym-engine
   ./install_all.sh
   ```
   В конце — тот же вопрос про адрес сервера ИИ.
3. Запуск: `./start_all.sh` или «Адина — ассистент» в меню приложений. Ctrl+C — остановить всё.

## Схема «сервер + ассистенты» (ассистент на ПК без видеокарты)

Тяжёлое — на сервере с NVIDIA (LM Studio и Whisper), на ПК с ассистентом достаточно процессора: аватар, зрение и голос Piper работают и так.

**На сервере** (один раз установить, потом держать запущенным):
- Linux: `cd ~/ai-assistant/aiym-engine && ./tools/install_whisper.sh`, затем `./tools/start_whisper_server.sh`
- Windows: `tools\install_whisper.bat`, затем `tools\start_whisper_server.bat` (от администратора — сам откроет порт 8000)
- Окно покажет адрес вида `http://192.168.1.50:8000/v1` — его и вводить на ассистентах.

**На ПК с ассистентом**: `install_all` спросит два адреса — сервер ИИ (`192.168.1.50:1235`) и Whisper (`192.168.1.50:8000`).
Поменять потом: `tools/set_llm_url` и `tools/set_stt_url` (.sh или .bat).

## Сервер ИИ (LM Studio)

- На компьютере с LM Studio: **Developer → Start Server**, порт **1235**.
- Если ассистент на другом компьютере: в LM Studio включите **Serve on Local Network** и откройте порт 1235 в брандмауэре.
- Сменить адрес позже: `tools\set_llm_url.bat` (Windows) или `./tools/set_llm_url.sh` (Linux), либо в браузере: настройки (S) → «Мозг» → «Адрес сервера».
- Модель выбирается в «Мозг» → «Модели LM Studio» → «Использовать».

## Что происходит при первом открытии

Модули «Слух», «Зрение», «Речь» и «Мозг» ставятся в браузер сами. Браузер спросит доступ к микрофону и камере — разрешите.
Обновление: `git pull` в папке проекта и Ctrl+Shift+R в браузере.

## Если что-то не так

Настройки (S) → «Аватар» → **«Скопировать отчёт»** — полный отчёт о состоянии.
Журналы Linux: `aiym-engine/logs/`. На Windows — окна «Whisper» и «Adina engine».
