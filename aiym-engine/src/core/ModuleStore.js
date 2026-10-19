// Хранилище «загруженных документов»: модули, которые пользователь открыл из файлов.
// Лежат в IndexedDB браузера терминала — переживают перезагрузку и выключение питания.
const DB = 'adina.modules';
const DB_LEGACY = 'aiym.modules';       // прежнее имя базы: установленные модули переносятся автоматически
const STORE = 'modules';

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); res(req?.result); };
    tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
  });
};

// Перенос модулей из прежней базы (один раз): если новая пуста, а старая есть — копируем.
async function migrateLegacy() {
  try {
    if (!(await indexedDB.databases?.())?.some((d) => d.name === DB_LEGACY)) return [];
    const db = await new Promise((res, rej) => { const r = indexedDB.open(DB_LEGACY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!db.objectStoreNames.contains(STORE)) { db.close(); return []; }
    const recs = await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    db.close();
    for (const r of recs) await run('readwrite', (s) => s.put(r));
    return recs;
  } catch { return []; }
}

export const ModuleStore = {
  all: async () => {
    const list = await run('readonly', (s) => s.getAll()).catch(() => []);
    return list.length ? list : migrateLegacy();
  },
  put: (rec) => run('readwrite', (s) => s.put(rec)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};
