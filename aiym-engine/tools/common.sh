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
cuda_libs() {      # библиотеки CUDA из pip-пакетов nvidia-* → LD_LIBRARY_PATH (иначе Whisper/Piper не видят видеокарту)
  local d; for d in .venv/lib/python*/site-packages/nvidia/*/lib; do [ -d "$d" ] && LD_LIBRARY_PATH="$PWD/$d:${LD_LIBRARY_PATH:-}"; done
  export LD_LIBRARY_PATH
}
