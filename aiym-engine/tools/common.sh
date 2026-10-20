#!/usr/bin/env bash
# Общее для Linux-скриптов: какой Python брать и где лежат библиотеки CUDA.
pick_python() {
  for p in python3.12 python3.11 python3.10 python3; do
    command -v "$p" >/dev/null 2>&1 || continue
    v=$("$p" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null) || continue
    case "$v" in 3.10|3.11|3.12) echo "$p"; return 0;; esac
  done
  return 1
}
# Python 3.10–3.12 нет (например, в системе только 3.14) — ставим отдельный Python 3.12 только для ассистента через uv (без sudo, системный не трогаем)
ensure_python() {
  pick_python && return 0
  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v uv >/dev/null 2>&1; then
    echo "Python 3.10–3.12 не найден — ставлю uv и отдельный Python 3.12 для ассистента…" >&2
    curl -LsSf https://astral.sh/uv/install.sh | sh >&2 || return 1
  fi
  uv python install 3.12 >&2 || return 1
  uv python find 3.12
}
cuda_libs() {      # библиотеки CUDA из pip-пакетов nvidia-* → LD_LIBRARY_PATH (иначе Whisper/Piper не видят видеокарту)
  local d; for d in .venv/lib/python*/site-packages/nvidia/*/lib; do [ -d "$d" ] && LD_LIBRARY_PATH="$PWD/$d:${LD_LIBRARY_PATH:-}"; done
  export LD_LIBRARY_PATH
}
