#!/usr/bin/env bash
# Установка всего на новом Linux-компьютере (Ubuntu/Debian/Fedora…): распознавание речи (Whisper), голос (Piper), голоса, модель.
# Нужны: git, curl, Python 3.10–3.12 с venv, драйвер NVIDIA.   Запуск:  ./install_all.sh
set -e
trap 'echo; echo "ОШИБКА на строке $LINENO — установка не закончена. Пришлите текст выше."' ERR
cd "$(dirname "$0")"
. tools/common.sh

command -v curl >/dev/null || { echo "Нет curl: sudo apt install curl"; exit 1; }
./tools/set_llm_url.sh
./tools/set_stt_url.sh
REMOTE_STT=$(python3 tools/stt_remote.py)
PY=$(ensure_python) || { echo "Не удалось получить Python 3.12 (нужен интернет). Пришлите текст выше."; exit 1; }
echo "Python: $PY ($($PY --version))"
PYV=$($PY -c 'import sys; print("%d.%d" % sys.version_info[:2])')
$PY -c 'import ensurepip, venv' >/dev/null 2>&1 || { echo "Нет venv/ensurepip. Выполните:  sudo apt install -y python3-venv python${PYV}-venv   и запустите ./install_all.sh снова"; exit 1; }
if command -v nvidia-smi >/dev/null; then nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
elif [ -z "$REMOTE_STT" ]; then echo "ВНИМАНИЕ: nvidia-smi не найден — для Whisper на этом компьютере нужен драйвер NVIDIA (или укажите Whisper на сервере: ./tools/set_stt_url.sh)."; fi

[ -x .venv/bin/pip ] || { rm -rf .venv; $PY -m venv .venv; }        # недоделанное окружение (без pip) — пересоздаём
echo "Ставлю Whisper и Piper (несколько минут)…"
.venv/bin/pip install -q --upgrade pip
if command -v nvidia-smi >/dev/null; then          # видеокарта NVIDIA: Whisper и голос на ней
  .venv/bin/pip install -q --upgrade faster-whisper piper-tts nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
  .venv/bin/pip uninstall -y -q onnxruntime >/dev/null 2>&1 || true
  .venv/bin/pip install -q --upgrade onnxruntime-gpu
else                                                # только процессор: Whisper — на сервере, голос Piper на процессоре (он лёгкий)
  .venv/bin/pip install -q --upgrade faster-whisper piper-tts
fi

VOICES_ONLY=1 ./tools/install_piper.sh

if [ -z "$REMOTE_STT" ]; then
  echo "Скачиваю модель распознавания речи large-v3-turbo (~1.6 ГБ, один раз)…"
  .venv/bin/python -c "from faster_whisper.utils import download_model; download_model('large-v3-turbo')"
fi


# ярлык в меню приложений
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/adina.desktop <<DESK
[Desktop Entry]
Name=Адина — ассистент
Exec=$PWD/start_all.sh
Path=$PWD
Terminal=true
Type=Application
DESK
chmod +x start_all.sh start.sh tools/*.sh
echo
echo "Готово. Запуск:  ./start_all.sh   (или «Адина — ассистент» в меню приложений)"
