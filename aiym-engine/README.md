# Айым — движок ассистента для AI Hub

Слева аватар (Three.js, мультяшный 3D mid-poly), справа камера в «Матрице». Всё остальное — модули.

## Запуск
```bash
./start.sh 8080          # http://localhost:8080  (S — настройки, F — полный экран)
chromium --kiosk --app=http://localhost:8080   # режим киоска
```
Three.js лежит локально в `vendor/` — интернет не нужен.

## Структура
```
src/core/      EventBus, Config, ModuleRegistry, Engine (цикл кадра), lipsync
src/avatar/    Avatar (публичное API) + buildGirl, Eyes, Mouth, Veil, Strand (физика), textures
src/ui/        Shell (разметка, настройки, субтитры), matrix (фильтр «Матрица»)
src/modules/   manifest.json + по папке на модуль
config/engine.json   настройки для киоска (перекрываются настройками из панели)
```

## Модули
Модули — «документы», которые открывает движок: перетащите `.js` или папку в окно (или Настройки → Модули → «Открыть…»). Подробности, контракт `ctx` и пример: [docs/MODULES.md](docs/MODULES.md), [examples/greeter.js](examples/greeter.js).

## Готовые модули (в папке `modules-dist/`)
Перетащите файл в окно движка — модуль встанет и запомнится.
- **`hearing.js` — «Слух»**: стерео-микрофон, голос/тишина, направление на говорящего, распознавание речи (в браузере или на своём сервере Whisper).
- **`vision.js` — «Зрение»**: лица, кто говорит (по губам + звук), движение, жесты, ответное приветствие на взмах руки. Нужен модуль «Веб-камера». Библиотека лежит в `vendor/mediapipe/` (интернет не нужен).

## Ещё не написаны
speech (TTS + фонемы), brain (LM Studio / Ollama / OpenRouter; черновик в `src/modules/brain/`).

## Благодарности
Рисунки рук для жестов (`assets/hands/`) — Twemoji, CC BY 4.0, подробности в [assets/hands/README.md](assets/hands/README.md).
