import * as THREE from 'three';

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

function spiral(ctx, cx, cy, r, dir, turns = 2.4) {
  ctx.beginPath();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.88);
    const x = cx + dir * rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

// Мотив «қошқар мүйіз» (бараньи рога): две зеркальные спирали и ромб между ними.
function ramHorn(ctx, cx, cy, s) {
  spiral(ctx, cx - s * 0.62, cy, s * 0.5, -1);
  spiral(ctx, cx + s * 0.62, cy, s * 0.5, 1);
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.32); ctx.lineTo(cx + s * 0.18, cy); ctx.lineTo(cx, cy + s * 0.32); ctx.lineTo(cx - s * 0.18, cy);
  ctx.closePath(); ctx.fill();
}

export function hatTexture() {
  const W = 1024, H = 1024;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#a82230'); g.addColorStop(1, '#86171f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#e3bd78'; ctx.fillStyle = '#e3bd78'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  // v (сверху вниз) → радиус конуса растёт; мотивы растягиваем по u, чтобы форма в мире не сжималась.
  for (const [yy, s] of [[0.46, 30], [0.66, 36], [0.82, 38]]) {
    const y = yy * H;
    const k = 0.78 / yy;
    const step = 118 * k * (yy < 0.6 ? 0.9 : 1);
    for (let x = step / 2; x < W; x += step) {
      ctx.save(); ctx.translate(x, y); ctx.scale(k, 1); ramHorn(ctx, 0, 0, s); ctx.restore();
    }
    ctx.lineWidth = 5;
    for (const dy of [-s * 1.1, s * 1.1]) { ctx.beginPath(); ctx.moveTo(0, y + dy); ctx.lineTo(W, y + dy); ctx.stroke(); }
    ctx.lineWidth = 6;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function veilTexture() {
  const W = 1024, H = 1024;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f6ecd6'); g.addColorStop(1, '#efe2c4');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d9b06c'; ctx.fillStyle = '#d9b06c'; ctx.lineCap = 'round';
  for (const side of [0, 1]) {
    ctx.save();
    if (side) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(18, H); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(112, 0); ctx.lineTo(112, H); ctx.stroke();
    ctx.lineWidth = 4;
    for (let y = 40; y < H; y += 92) {
      ctx.save(); ctx.translate(65, y); ctx.rotate(Math.PI / 2); ramHorn(ctx, 0, 0, 24); ctx.restore();
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Тахия (национальная мужская шапочка): красный бархат, золотые «бараньи рога» поясом и ромбы.
export function tahiyaTexture() {
  const W = 1024, H = 512;
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#8a1a27'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#e3bd78'; ctx.fillStyle = '#e3bd78'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) ramHorn(ctx, W * (i + 0.5) / 4, H * 0.66, 110);          // пояс орнамента вокруг шапочки
  for (let i = 0; i < 8; i++) {                                                          // ромбы между мотивами
    const x = W * i / 8, y = H * 0.3; ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x + 18, y); ctx.lineTo(x, y + 26); ctx.lineTo(x - 18, y); ctx.closePath(); ctx.fill();
  }
  ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, H * 0.92); ctx.lineTo(W, H * 0.92); ctx.stroke();      // кант у нижнего края
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
