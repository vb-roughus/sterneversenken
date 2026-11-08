// Flotte aufstellen: Schiff antippen und aufs Feld tippen, ziehen zum Verschieben,
// ein platziertes Schiff nochmals antippen zum Drehen.

import { FLEET, SIZE, canPlace, randomFleet, shipDef, cellsOf } from './engine.js';
import { BoardView } from './boardview.js';
import { shipSvg } from './ships.js';
import { sfx, vibrate } from './audio.js';

const DRAG_THRESHOLD = 6;

export class Placement {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.onChange = onChange || (() => {});
    this.board = new BoardView(root.querySelector('.place-board'), { label: '◎' });
    this.board.setInteractive(true);
    this.dock = root.querySelector('.dock');
    this.rules = null;
    this.placed = new Map();
    this.dirs = new Map();
    this.selected = null;
    this.drag = null;

    this.board.field.addEventListener('pointerdown', (e) => this.onBoardDown(e));
    this.dock.addEventListener('pointerdown', (e) => this.onDockDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());
    this.dock.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset(rules) {
    this.rules = rules;
    this.placed.clear();
    this.dirs.clear();
    this.selected = FLEET[0].id;
    this.render();
  }

  get fleet() {
    return FLEET.filter((d) => this.placed.has(d.id)).map((d) => ({ ...this.placed.get(d.id) }));
  }

  isComplete() {
    return this.placed.size === FLEET.length;
  }

  others(id) {
    return [...this.placed.values()].filter((s) => s.id !== id);
  }

  dirOf(id) {
    return this.placed.get(id)?.dir || this.dirs.get(id) || 'h';
  }

  /** Anker so verschieben, dass das Schiff im Feld liegt. */
  clamp(ship) {
    const size = shipDef(ship.id).size;
    const maxX = ship.dir === 'h' ? SIZE - size : SIZE - 1;
    const maxY = ship.dir === 'v' ? SIZE - size : SIZE - 1;
    return { ...ship, x: Math.max(0, Math.min(maxX, ship.x)), y: Math.max(0, Math.min(maxY, ship.y)) };
  }

  valid(ship) {
    return canPlace(this.others(ship.id), ship, this.rules);
  }

  tryPlace(ship) {
    const s = this.clamp(ship);
    if (!this.valid(s)) {
      this.reject(s);
      return false;
    }
    this.placed.set(s.id, s);
    this.dirs.set(s.id, s.dir);
    sfx.select();
    vibrate(10);
    // Nächstes noch nicht platziertes Schiff vorwählen
    if (this.selected === s.id) {
      const next = FLEET.find((d) => !this.placed.has(d.id));
      this.selected = next ? next.id : s.id;
    }
    this.render();
    return true;
  }

  reject(ship) {
    sfx.error();
    vibrate(40);
    this.board.pulseCells(cellsOf(ship).filter((c) => c.x < SIZE && c.y < SIZE), 'deny');
  }

  rotate(id = this.selected) {
    if (!id) return;
    const cur = this.placed.get(id);
    const dir = this.dirOf(id) === 'h' ? 'v' : 'h';
    if (!cur) {
      this.dirs.set(id, dir);
      sfx.click();
      this.render();
      return;
    }
    const turned = this.clamp({ ...cur, dir });
    if (this.valid(turned)) {
      this.placed.set(id, turned);
      this.dirs.set(id, dir);
      sfx.click();
      this.render();
    } else {
      this.reject(turned);
    }
  }

  randomize() {
    this.placed.clear();
    for (const s of randomFleet(this.rules)) {
      this.placed.set(s.id, s);
      this.dirs.set(s.id, s.dir);
    }
    this.selected = null;
    sfx.select();
    this.render();
  }

  clear() {
    this.placed.clear();
    this.selected = FLEET[0].id;
    sfx.click();
    this.render();
  }

  // ---- Zeiger ------------------------------------------------------------------------

  onBoardDown(e) {
    if (e.button > 0) return;
    const cell = this.board.cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    const ship = [...this.placed.values()].find((s) => cellsOf(s).some((c) => c.x === cell.x && c.y === cell.y));
    if (ship) {
      const offset = ship.dir === 'h' ? cell.x - ship.x : cell.y - ship.y;
      this.drag = { id: ship.id, offset, sx: e.clientX, sy: e.clientY, moved: false, fromDock: false };
      e.preventDefault();
      return;
    }
    // Leeres Feld angetippt: ausgewähltes Schiff hierher setzen.
    if (this.selected) {
      this.tryPlace({ id: this.selected, x: cell.x, y: cell.y, dir: this.dirOf(this.selected) });
    }
  }

  onDockDown(e) {
    const item = e.target.closest('[data-id]');
    if (!item || e.button > 0) return;
    const id = item.dataset.id;
    const size = shipDef(id).size;
    this.drag = { id, offset: Math.floor((size - 1) / 2), sx: e.clientX, sy: e.clientY, moved: false, fromDock: true };
    e.preventDefault();
  }

  anchorFor(e) {
    const cell = this.board.cellFromPoint(e.clientX, e.clientY);
    if (!cell) return null;
    const dir = this.dirOf(this.drag.id);
    const o = this.drag.offset;
    return this.clamp({ id: this.drag.id, dir, x: dir === 'h' ? cell.x - o : cell.x, y: dir === 'v' ? cell.y - o : cell.y });
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      this.selected = d.id;
      this.root.classList.add('dragging');
      this.render();
    }
    const anchor = this.anchorFor(e);
    d.anchor = anchor;
    this.board.ghost(anchor, anchor && this.valid(anchor));
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.root.classList.remove('dragging');
    this.board.ghost(null);
    if (d.moved) {
      if (d.anchor) this.tryPlace(d.anchor);
      else this.render();
      return;
    }
    // Antippen
    if (d.fromDock) {
      if (this.selected === d.id && !this.placed.has(d.id)) this.rotate(d.id);
      else {
        this.selected = d.id;
        sfx.click();
        this.render();
      }
    } else if (this.selected === d.id) {
      this.rotate(d.id);
    } else {
      this.selected = d.id;
      sfx.click();
      this.render();
    }
  }

  cancelDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.root.classList.remove('dragging');
    this.board.ghost(null);
  }

  // ---- Darstellung -------------------------------------------------------------------

  render() {
    const ships = [...this.placed.values()].map((s) => ({ ...s, cls: s.id === this.selected ? 'selected' : '' }));
    this.board.render({ ships });
    this.dock.innerHTML = FLEET.map((d) => {
      const cls = [this.placed.has(d.id) ? 'placed' : '', this.selected === d.id ? 'selected' : ''].join(' ');
      const dir = this.dirOf(d.id);
      return `<button type="button" class="dock-ship ${cls}" data-id="${d.id}" style="--len:${d.size}">
        <span class="dock-art">${shipSvg(d.id, d.size, 'h')}</span>
        <span class="dock-name">${d.name.replace(/(?<=\p{L}{4})(kreuzer|staffel|schiff|jäger)$/iu, '\u00AD$1')}</span>
        <span class="dock-meta">${d.size} Felder ${dir === 'h' ? '⇆' : '⇅'}</span>
      </button>`;
    }).join('');
    this.onChange(this);
  }
}
