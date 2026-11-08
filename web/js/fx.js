// Effekte: Laserschüsse, Explosionen, Erschütterung. Alles in einer Ebene über der Seite.

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let layer;

function fxLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function bolt(from, to, color, duration, offset) {
  const el = document.createElement('div');
  el.className = 'bolt';
  el.style.setProperty('--bolt', color);
  fxLayer().appendChild(el);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const nx = -Math.sin(angle) * offset;
  const ny = Math.cos(angle) * offset;
  const len = el.offsetWidth || 70;
  const at = (p) => `translate(${p.x + nx - len}px, ${p.y + ny - 2}px) rotate(${angle}rad)`;
  const anim = el.animate([{ transform: at(from) }, { transform: at({ x: to.x - nx, y: to.y - ny }) }], {
    duration,
    easing: 'cubic-bezier(.3,.1,.9,.6)',
  });
  return anim.finished.then(() => el.remove());
}

/** Doppelter Laserschuss von `from` nach `to` (Bildschirmkoordinaten). */
export async function laser(from, to, color) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = reduced ? 120 : Math.max(220, Math.min(420, dist * 0.7));
  const a = bolt(from, to, color, duration, -5);
  await wait(55);
  const b = bolt(from, to, color, duration, 5);
  await Promise.all([a, b]);
}

function spark(at, color, size) {
  const el = document.createElement('div');
  el.className = 'spark';
  el.style.setProperty('--spark', color);
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  fxLayer().appendChild(el);
  const angle = Math.random() * Math.PI * 2;
  const dist = size * (0.6 + Math.random() * 1.1);
  el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      {
        transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.2)`,
        opacity: 0,
      },
    ],
    { duration: 500 + Math.random() * 400, easing: 'cubic-bezier(.1,.7,.3,1)' },
  ).finished.then(() => el.remove());
}

/** Explosion an Bildschirmposition `at`. kind: 'miss' | 'hit' | 'sunk' */
export async function explode(at, kind, cell = 30) {
  const el = document.createElement('div');
  el.className = `boom boom-${kind}`;
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  el.style.setProperty('--cell', `${cell}px`);
  el.innerHTML = '<i class="flash"></i><i class="ring"></i>';
  fxLayer().appendChild(el);
  if (!reduced && kind !== 'miss') {
    const n = kind === 'sunk' ? 22 : 12;
    for (let i = 0; i < n; i++) spark(at, i % 3 ? '#ffb347' : '#fff3c4', cell * (kind === 'sunk' ? 2.4 : 1.4));
  }
  if (kind === 'sunk') shake(14, 520);
  else if (kind === 'hit') shake(6, 260);
  await wait(kind === 'sunk' ? 900 : 600);
  el.remove();
}

export function shake(px = 6, duration = 300) {
  if (reduced) return;
  const app = document.getElementById('app');
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const f = px * (1 - i / 6);
    frames.push({ transform: `translate(${(Math.random() * 2 - 1) * f}px, ${(Math.random() * 2 - 1) * f}px)` });
  }
  frames.push({ transform: 'translate(0,0)' });
  app.animate(frames, { duration, easing: 'ease-out' });
}

export function flashScreen(color = 'rgba(255,60,60,.35)') {
  const el = document.createElement('div');
  el.className = 'screen-flash';
  el.style.setProperty('--flash', color);
  fxLayer().appendChild(el);
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' }).finished.then(() => el.remove());
}

export { wait };
