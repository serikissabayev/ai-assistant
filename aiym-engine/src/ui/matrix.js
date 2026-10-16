// Правая панель: «Матрица». Без камеры — дождь из символов; с камерой — картинка
// превращается в поле символов, яркость → плотность/цвет, движение подсвечивается белым.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ӘІҢҒҮҰҚӨҺ<>+=*'.split('');
const LEVELS = ['#06381c', '#0a5a2b', '#0f8a42', '#19b95a', '#4be08a', '#a6ffc8', '#eafff2'];

export class MatrixField {
  constructor(canvas, { cell = 14, fps = 24 } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.cell = cell; this.interval = 1 / fps; this.acc = 0;
    this.sample = document.createElement('canvas'); this.sctx = this.sample.getContext('2d', { willReadFrequently: true });
    this.video = null; this.mirror = true; this.filter = true;      // filter=false → обычная картинка с камеры без «Матрицы»
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  setSource(video, mirror = true) { this.video = video; this.mirror = mirror; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.parentElement.clientWidth, h = this.canvas.parentElement.clientHeight;
    this.canvas.width = Math.max(1, w * dpr); this.canvas.height = Math.max(1, h * dpr);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    this.cw = this.cell * 0.62; this.ch = this.cell;
    this.cols = Math.ceil(w / this.cw); this.rows = Math.ceil(h / this.ch);
    this.sample.width = this.cols; this.sample.height = this.rows;
    const n = this.cols * this.rows;
    this.glyph = new Uint8Array(n).map(() => (Math.random() * GLYPHS.length) | 0);
    this.prev = new Float32Array(n);
    this.head = Float32Array.from({ length: this.cols }, () => Math.random() * this.rows * 2 - this.rows);
    this.speed = Float32Array.from({ length: this.cols }, () => 6 + Math.random() * 16);
    this.tail = Float32Array.from({ length: this.cols }, () => 8 + Math.random() * 18);
  }

  #luma() {
    const v = this.video, { cols, rows, sctx } = this;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    const ar = cols * this.cw / (rows * this.ch), va = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (va > ar) { sw = sh * ar; sx = (v.videoWidth - sw) / 2; } else { sh = sw / ar; sy = (v.videoHeight - sh) / 2; }
    sctx.save();
    if (this.mirror) { sctx.translate(cols, 0); sctx.scale(-1, 1); }
    sctx.drawImage(v, sx, sy, sw, sh, 0, 0, cols, rows);
    sctx.restore();
    const d = sctx.getImageData(0, 0, cols, rows).data, out = new Float32Array(cols * rows);
    for (let i = 0; i < out.length; i++) out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    return out;
  }

  // без фильтра: обычное видео камеры (по размеру панели, зеркально)
  #raw() {
    const { ctx, canvas, video } = this, W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#050706'; ctx.fillRect(0, 0, W, H);
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    const ar = W / H, va = video.videoWidth / video.videoHeight;
    let sw = video.videoWidth, sh = video.videoHeight, sx = 0, sy = 0;
    if (va > ar) { sw = sh * ar; sx = (video.videoWidth - sw) / 2; } else { sh = sw / ar; sy = (video.videoHeight - sh) / 2; }
    ctx.save();
    if (this.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
    ctx.restore();
  }

  frame(dt) {
    this.acc += dt;
    if (this.acc < this.interval) return;
    const step = this.acc; this.acc = 0;
    const { ctx, cols, rows, cw, ch, dpr } = this;
    if (!this.filter) { this.#raw(); return; }
    const luma = this.#luma();

    for (let c = 0; c < cols; c++) {
      this.head[c] += this.speed[c] * step;
      if (this.head[c] - this.tail[c] > rows) { this.head[c] = -Math.random() * rows * 0.5; this.speed[c] = 6 + Math.random() * 16; this.tail[c] = 8 + Math.random() * 18; }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020604'; ctx.fillRect(0, 0, cols * cw, rows * ch);
    ctx.font = `${this.cell}px "DejaVu Sans Mono", "Noto Sans Mono", monospace`;
    ctx.textBaseline = 'top';
    const buckets = LEVELS.map(() => []);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const d = this.head[c] - r;
        const rain = d >= 0 && d < this.tail[c] ? 1 - d / this.tail[c] : 0;
        let b = rain * (luma ? 0.22 : 0.85);
        if (d >= 0 && d < 1) b = luma ? Math.max(b, 0.5) : 1;       // яркая «голова» капли
        if (luma) {
          const l = luma[i], motion = Math.abs(l - this.prev[i]);
          this.prev[i] = l;
          const body = Math.pow(Math.min(Math.max((l - 0.08) * 1.35, 0), 1), 1.15);
          b = Math.max(b, body * 0.92 + Math.min(motion * 5, 0.6));
        }
        if (b < 0.07) continue;
        if (Math.random() < (rain > 0.9 ? 0.5 : 0.015)) this.glyph[i] = (Math.random() * GLYPHS.length) | 0;
        buckets[Math.min(LEVELS.length - 1, (b * LEVELS.length) | 0)].push(i);
      }
    }
    for (let lv = 0; lv < LEVELS.length; lv++) {
      ctx.fillStyle = LEVELS[lv];
      if (lv >= 4) { ctx.shadowColor = '#3dff8c'; ctx.shadowBlur = lv >= 5 ? 6 : 0; } else ctx.shadowBlur = 0;
      for (const i of buckets[lv]) ctx.fillText(GLYPHS[this.glyph[i]], (i % cols) * cw, ((i / cols) | 0) * ch);
    }
    ctx.shadowBlur = 0;
  }
}
