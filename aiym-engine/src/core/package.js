// Пакет модуля: один .js-файл ИЛИ папка с module.json (+ код и ресурсы).
// Здесь — чтение из файлов, drag-and-drop папок и сборка Blob-ссылок для запуска из браузера.
const dec = new TextDecoder();
const MIME = { js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', wasm: 'application/wasm', onnx: 'application/octet-stream', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', glb: 'model/gltf-binary', css: 'text/css', txt: 'text/plain' };
const ext = (p) => p.split('.').pop().toLowerCase();

export const slug = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Файлы из перетаскивания (в том числе папки) → File[] с относительными путями. */
export async function filesFromDrop(dt) {
  const out = [];
  async function walk(entry, path) {
    if (entry.isFile) {
      const f = await new Promise((r) => entry.file(r));
      f._rel = path + entry.name; out.push(f);
    } else if (entry.isDirectory) {
      const rd = entry.createReader(); let batch;
      do {
        batch = await new Promise((r) => rd.readEntries(r));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length);
    }
  }
  const items = [...(dt.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (items.length) for (const e of items) await walk(e, '');
  else out.push(...dt.files);
  return out;
}

/** File[] → { id, meta, entry, files:{path:{type,data}} } с проверками и понятными ошибками. */
export async function readPackage(fileList) {
  let list = [...fileList]
    .map((file) => ({ file, path: file.webkitRelativePath || file._rel || file.name }))
    .filter((x) => !/(^|\/)(\.|__MACOSX|Thumbs\.db)/.test(x.path));
  if (!list.length) throw new Error('Не выбрано ни одного файла');
  if (list.every((x) => x.path.includes('/'))) {                       // срезаем общую папку-обёртку
    const root = list[0].path.split('/')[0];
    if (list.every((x) => x.path.startsWith(`${root}/`))) list = list.map((x) => ({ ...x, path: x.path.slice(root.length + 1) }));
  }
  const files = {};
  for (const { file, path } of list) files[path] = { type: file.type || MIME[ext(path)] || 'application/octet-stream', data: await file.arrayBuffer() };

  let meta, entry;
  if (files['module.json']) {
    try { meta = JSON.parse(dec.decode(files['module.json'].data)); } catch { throw new Error('module.json повреждён — не читается как JSON'); }
    entry = meta.entry ?? 'index.js';
    if (!files[entry]) throw new Error(`В папке нет файла «${entry}», указанного в module.json`);
  } else {
    const js = Object.keys(files).filter((p) => /\.m?js$/.test(p));
    if (js.length !== 1 || Object.keys(files).length !== 1) throw new Error('Нужен один .js-файл или папка, в которой есть module.json');
    entry = js[0];
    const probe = await buildBundle({ files, entry });                 // читаем «шапку» export const meta
    try { meta = { ...(await import(/* @vite-ignore */ probe.entryUrl)).meta }; }
    catch (e) { throw new Error(`Файл не удалось прочитать как модуль: ${e.message}`); }
    finally { probe.dispose(); }
    meta.id ??= slug(entry);
  }
  meta.id = slug(meta.id ?? '');
  if (!meta.id) throw new Error('У модуля не указан id');
  meta.name ??= meta.id; meta.version ??= '1.0'; meta.engine ??= 1; meta.description ??= '';
  return { id: meta.id, meta, entry, files };
}

/** Собирает рабочие Blob-ссылки: относительные import './x.js' внутри модуля подменяются на них. */
export async function buildBundle(rec) {
  const urls = new Map(), busy = new Set(), made = [];
  const norm = (base, rel) => {
    const out = [];
    for (const p of `${base.split('/').slice(0, -1).join('/')}/${rel}`.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') out.pop(); else out.push(p);
    }
    return out.join('/');
  };
  function urlFor(path) {
    if (urls.has(path)) return urls.get(path);
    const f = rec.files[path];
    if (!f) throw new Error(`В модуле нет файла «${path}»`);
    if (busy.has(path)) throw new Error(`Циклический import не поддерживается: ${path}`);
    let url;
    if (/\.m?js$/.test(path)) {
      busy.add(path);
      const src = dec.decode(f.data).replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
        (_, pre, q, spec) => `${pre}${q}${urlFor(norm(path, spec))}${q}`);
      busy.delete(path);
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } else url = URL.createObjectURL(new Blob([f.data], { type: f.type }));
    made.push(url); urls.set(path, url);
    return url;
  }
  return {
    entryUrl: urlFor(rec.entry),
    assetUrl: (p) => urlFor(norm('x', p)),
    dispose: () => made.forEach((u) => URL.revokeObjectURL(u)),
  };
}
