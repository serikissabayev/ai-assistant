// Шина событий — единственный канал связи между модулями.
// Подписка '*' получает все события: handler(payload, eventName).
export class EventBus {
  #handlers = new Map();

  on(evt, fn) {
    let set = this.#handlers.get(evt);
    if (!set) this.#handlers.set(evt, (set = new Set()));
    set.add(fn);
    return () => this.off(evt, fn);
  }

  once(evt, fn) {
    const off = this.on(evt, (p, e) => { off(); fn(p, e); });
    return off;
  }

  off(evt, fn) {
    this.#handlers.get(evt)?.delete(fn);
  }

  emit(evt, payload) {
    const list = [...(this.#handlers.get(evt) ?? []), ...(this.#handlers.get('*') ?? [])];
    for (const fn of list) {
      try { fn(payload, evt); }
      catch (e) { console.error(`[bus] ошибка обработчика "${evt}"`, e); }
    }
  }
}
