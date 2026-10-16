// Пример модуля «в одном файле». Перетащите этот файл в окно движка — и он заработает.
// Шапка `meta` обязательна: по ней движок узнаёт, что это за модуль.
export const meta = {
  id: 'greeter',
  name: 'Приветствие',
  version: '1.0',
  engine: 1,                       // версия контракта движка, для которой написан модуль
  category: 'user',
  description: 'При включении здоровается и кивает; отвечает на событие vision.gesture {name:"wave"}.',
};

export default function create() {
  return {
    async start(ctx) {
      const hello = (text) => {
        ctx.avatar.setEmotion('happy', 0.9);
        ctx.avatar.trigger('nod');
        ctx.ui.setCaption(text, { role: 'assistant', hold: 4 });
        setTimeout(() => ctx.avatar.setEmotion('neutral'), 3500);
      };
      ctx.bus.on('vision.gesture', ({ name }) => { if (name === 'wave') hello('Привет! Рада вас видеть!'); });
      ctx.ui.toast('Модуль «Приветствие» работает', 'ok', 2500);
      hello('Сәлем! Добро пожаловать!');
    },
    async stop() {},                // всё, что регистрировали через ctx, снимется само
  };
}
