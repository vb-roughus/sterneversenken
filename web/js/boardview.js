// Darstellung eines 10×10-Spielfelds mit Schiffen, Treffern und Zielmarkierung.

import { SIZE, COLS, shipDef, cellsOf } from './engine.js';
import { shipSvg } from './ships.js';

export class BoardView {
  constructor(host, { label = '', compact = false } = {}) {
    this.root = document.createElement('div');
    this.root.className = `board${compact ? ' compact' : ''}`;
    const top = Array.from({ length: SIZE }, (_, i) => `<span>${COLS[i]}</span>`).join('');
    const left = Array.from({ length: SIZE }, (_, i) => `<span>${i + 1}</span>`).join('');
    const cells = Array.from({ length: SIZE * SIZE }, (_, i) => `<i data-i="${i}"></i>`).join('');
    this.root.innerHTML = `
      <div class="corner">${label}</div>
      <div class="labels top">${top}</div>
      <div class="labels left">${left}</div>
      <div class="field">
        <div class="cells">${cells}</div>
        <div class="layer ships"></div>
        <div class="layer marks"></div>
        <div class="layer cursor" hidden></div>
        <div class="scan"></div>
      </div>`;
    host.appendChild(this.root);
    this.field = this.root.querySelector('.field');
    this.cellsEl = this.root.querySelector('.cells');
    this.shipsEl = this.root.querySelector('.ships');
    this.marksEl = this.root.querySelector('.marks');
    this.cursorEl = this.root.querySelector('.cursor');
  }

  /** Zelle unter einem Bildschirmpunkt, oder null. */
  cellFromPoint(clientX, clientY) {
    const r = this.field.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * SIZE);
    const y = Math.floor(((clientY - r.top) / r.height) * SIZE);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return { x, y };
  }

  cellRect(x, y) {
    const r = this.field.getBoundingClientRect();
    const w = r.width / SIZE;
    const h = r.height / SIZE;
    return { left: r.left + x * w, top: r.top + y * h, width: w, height: h, cx: r.left + (x + 0.5) * w, cy: r.top + (y + 0.5) * h };
  }

  cellSize() {
    return this.field.getBoundingClientRect().width / SIZE;
  }

  setCursor(cell) {
    if (!cell) {
      this.cursorEl.hidden = true;
      return;
    }
    this.cursorEl.hidden = false;
    this.cursorEl.style.left = `${cell.x * 10}%`;
    this.cursorEl.style.top = `${cell.y * 10}%`;
  }

  setInteractive(on) {
    this.root.classList.toggle('interactive', on);
  }

  static shipHtml(ship, cls = '') {
    const def = shipDef(ship.id);
    const w = ship.dir === 'h' ? def.size * 10 : 10;
    const h = ship.dir === 'h' ? 10 : def.size * 10;
    return `<div class="ship ${cls}" data-id="${ship.id}" style="left:${ship.x * 10}%;top:${ship.y * 10}%;width:${w}%;height:${h}%">${shipSvg(ship.id, def.size, ship.dir)}</div>`;
  }

  /**
   * ships: [{id,x,y,dir, cls}]
   * shots: [{x,y,result}]
   * hint:  Set von Zellindizes, die sicher leer sind
   * last:  {x,y} zuletzt beschossene Zelle
   */
  render({ ships = [], shots = [], hint = null, last = null, hitCellsOnShips = false } = {}) {
    this.shipsEl.innerHTML = ships.map((s) => BoardView.shipHtml(s, s.cls || '')).join('');
    const marks = [];
    const shotSet = new Set();
    for (const s of shots) {
      shotSet.add(s.y * SIZE + s.x);
      const fresh = last && last.x === s.x && last.y === s.y ? ' fresh' : '';
      const kind = s.result === 'miss' ? 'miss' : 'hit';
      marks.push(`<i class="mark ${kind}${fresh}" style="left:${s.x * 10}%;top:${s.y * 10}%"></i>`);
    }
    if (hint) {
      for (const k of hint) {
        if (shotSet.has(k)) continue;
        marks.push(`<i class="mark void" style="left:${(k % SIZE) * 10}%;top:${Math.floor(k / SIZE) * 10}%"></i>`);
      }
    }
    this.marksEl.innerHTML = marks.join('');
    this.root.classList.toggle('show-hit-ships', hitCellsOnShips);
  }

  /** Vorschau (Geist) beim Platzieren. */
  ghost(ship, valid) {
    let g = this.field.querySelector('.ghost');
    if (!ship) {
      g?.remove();
      return;
    }
    const html = BoardView.shipHtml(ship, `ghost ${valid ? 'ok' : 'bad'}`);
    if (g) g.outerHTML = html;
    else this.field.insertAdjacentHTML('beforeend', html);
  }

  pulseCells(cells, cls = 'pulse') {
    for (const c of cells) {
      const el = this.cellsEl.children[c.y * SIZE + c.x];
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
  }
}

/** Schiffsübersicht: Symbol und Anzahl Felder je Schiff; versenkte durchgestrichen. */
export function fleetIcons(fleetDefs, sunkIds) {
  return fleetDefs
    .map((d) => {
      const sunk = sunkIds.has(d.id);
      const title = `${d.name}: ${d.size} Felder${sunk ? ' – versenkt' : ''}`;
      return `<span class="fleet-item${sunk ? ' sunk' : ''}" title="${title}"><span class="fleet-icon" style="--len:${d.size}">${shipSvg(d.id, d.size, 'h')}</span><b class="fleet-size">${d.size}</b></span>`;
    })
    .join('');
}

export { cellsOf };
