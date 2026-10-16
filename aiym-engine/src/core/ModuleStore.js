// Хранилище «загруженных документов»: модули, которые пользователь открыл из файлов.
// Лежат в IndexedDB браузера терминала — переживают перезагрузку и выключение питания.
const DB = 'aiym.modules';
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

export const ModuleStore = {
  all: () => run('readonly', (s) => s.getAll()).catch(() => []),
  put: (rec) => run('readwrite', (s) => s.put(rec)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};
