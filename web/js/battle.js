// Gefechtsansicht für einen Spieler: gegnerisches Feld (Ziel), eigenes Feld, Status, Feuerknopf.

import { FLEET, coordLabel, shipDef } from './engine.js';
import { BoardView, fleetIcons } from './boardview.js';
import { laser, explode, flashScreen, wait } from './fx.js';
import { sfx, vibrate } from './audio.js';

const MY_LASER = '#5dff9a';
const ENEMY_LASER = '#ff4d5a';

export class BattleUI {
  constructor(root) {
    this.root = root;
    this.enemyView = new BoardView(root.querySelector('.enemy-host'), { label: '⌖' });
    this.ownView = new BoardView(root.querySelector('.own-host'), { label: '◎', compact: true });
    this.enemyView.setInteractive(true);
    this.statusEl = root.querySelector('.bt-status');
    this.subEl = root.querySelector('.bt-sub');
    this.fireBtn = root.querySelector('.fire-btn');
    this.enemyFleetEl = root.querySelector('.enemy-fleet');
    this.ownFleetEl = root.querySelector('.own-fleet');
    this.enemyNameEl = root.querySelector('.enemy-name');
    this.ownNameEl = root.querySelector('.own-name');
    this.scoreEl = root.querySelector('.score');
    this.ownWrap = root.querySelector('.own-wrap');
    this.resultEl = root.querySelector('.result');
    this.target = null;
    this.ctx = null;
    this.lastOwn = null;
    this.lastEnemy = null;
    this.reveal = null;

    this.enemyView.field.addEventListener('click', (e) => {
      const cell = this.enemyView.cellFromPoint(e.clientX, e.clientY);
      if (cell) this.pick(cell);
    });
    this.fireBtn.addEventListener('click', () => {
      if (this.target) this.fire(this.target);
    });
  }

  /**
   * ctx: { me, opp, rules, own: () => Board, enemy: () => Board, canFire: () => bool,
   *        onFire: (x, y) => void, score?: [a, b] }
   */
  bind(ctx) {
    this.ctx = ctx;
    this.target = null;
    this.reveal = null;
    this.lastOwn = ctx.lastOwn || null;
    this.lastEnemy = null;
    this.hideResult();
    this.enemyNameEl.textContent = ctx.opp;
    this.ownNameEl.textContent = ctx.me;
    this.render();
  }

  pick(cell) {
    const { ctx } = this;
    if (!ctx || !ctx.canFire()) {
      sfx.error();
      return;
    }
    if (ctx.enemy().shotAt(cell.x, cell.y)) {
      sfx.error();
      vibrate(30);
      this.enemyView.pulseCells([cell], 'deny');
      return;
    }
    if (this.target && this.target.x === cell.x && this.target.y === cell.y) {
      this.fire(cell);
      return;
    }
    this.target = cell;
    sfx.select();
    this.render();
  }

  fire(cell) {
    if (!this.ctx.canFire()) return;
    this.target = null;
    this.enemyView.setCursor(null);
    this.ctx.onFire(cell.x, cell.y);
  }

  setStatus(main, sub = '', tone = '') {
    this.statusEl.textContent = main;
    this.subEl.textContent = sub;
    this.statusEl.dataset.tone = tone;
  }

  render() {
    const { ctx } = this;
    if (!ctx) return;
    const own = ctx.own();
    const enemy = ctx.enemy();
    const sunkEnemy = enemy.sunkShips();
    const sunkIds = new Set(sunkEnemy.map((s) => s.id));
    const ships = sunkEnemy.map((s) => ({ ...s, cls: 'wreck' }));
    if (this.reveal) {
      for (const s of this.reveal) if (!sunkIds.has(s.id)) ships.push({ ...s, cls: 'revealed' });
    }
    this.enemyView.render({
      ships,
      shots: enemy.shots,
      hint: ctx.rules.allowTouch ? null : enemy.blockedAround(ctx.rules),
      last: this.lastEnemy,
    });
    const ownSunk = new Set(own.sunkShips().map((s) => s.id));
    this.ownView.render({
      ships: (own.fleet || []).map((s) => ({ ...s, cls: ownSunk.has(s.id) ? 'wreck' : '' })),
      shots: own.shots,
      last: this.lastOwn,
    });
    this.enemyFleetEl.innerHTML = fleetIcons(FLEET, sunkIds);
    this.ownFleetEl.innerHTML = fleetIcons(FLEET, ownSunk);
    const can = ctx.canFire();
    this.root.classList.toggle('my-turn', can);
    this.enemyView.setInteractive(can);
    if (!can) this.target = null;
    this.enemyView.setCursor(this.target);
    this.fireBtn.disabled = !can || !this.target;
    this.fireBtn.textContent = this.target ? `Feuer auf ${coordLabel(this.target.x, this.target.y)}` : 'Ziel wählen';
    if (ctx.score) {
      this.scoreEl.hidden = false;
      this.scoreEl.textContent = `${ctx.score[0]} : ${ctx.score[1]}`;
    } else {
      this.scoreEl.hidden = true;
    }
  }

  fireOrigin() {
    const r = this.fireBtn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Laser zum Ziel; das Ergebnis kommt evtl. später (Netzwerk). */
  shootLaser(x, y) {
    const cell = this.enemyView.cellRect(x, y);
    sfx.laser(false);
    vibrate(15);
    return laser(this.fireOrigin(), { x: cell.cx, y: cell.cy }, MY_LASER);
  }

  async showOutcome(shot) {
    const cell = this.enemyView.cellRect(shot.x, shot.y);
    this.lastEnemy = { x: shot.x, y: shot.y };
    this.render();
    this.playImpact(shot, cell);
    await explode({ x: cell.cx, y: cell.cy }, shot.result, cell.width);
    this.announce(shot, false);
  }

  async showIncoming(shot) {
    this.ownWrap.classList.add('focus');
    await wait(320);
    const cell = this.ownView.cellRect(shot.x, shot.y);
    sfx.laser(true);
    await laser({ x: window.innerWidth / 2, y: -20 }, { x: cell.cx, y: cell.cy }, ENEMY_LASER);
    this.lastOwn = { x: shot.x, y: shot.y };
    this.render();
    this.playImpact(shot, cell);
    if (shot.result !== 'miss') flashScreen();
    await explode({ x: cell.cx, y: cell.cy }, shot.result, cell.width);
    this.announce(shot, true);
    await wait(650);
    this.ownWrap.classList.remove('focus');
    await wait(250);
  }

  playImpact(shot) {
    if (shot.result === 'miss') sfx.miss();
    else if (shot.result === 'hit') {
      sfx.hit();
      vibrate(60);
    } else {
      sfx.sunk();
      vibrate([80, 60, 160]);
    }
  }

  announce(shot, incoming) {
    const where = coordLabel(shot.x, shot.y);
    if (shot.result === 'miss') this.setStatus('Daneben', `${where} – nur leerer Raum`, 'muted');
    else if (shot.result === 'hit') this.setStatus('Treffer!', incoming ? `Schaden bei ${where}` : `${where} – weiter so`, incoming ? 'bad' : 'good');
    else {
      const name = shipDef(shot.ship.id).name;
      this.setStatus(incoming ? `${name} verloren` : `${name} versenkt!`, where, incoming ? 'bad' : 'good');
    }
  }

  /** Nach Spielende alle gegnerischen Schiffe zeigen. */
  revealFleet(fleet) {
    this.reveal = fleet;
    this.render();
  }

  showResult({ title, tone, lines = [], note = '', buttons = [] }) {
    const r = this.resultEl;
    r.dataset.tone = tone;
    r.querySelector('.result-title').textContent = title;
    r.querySelector('.result-lines').innerHTML = lines.map((l) => `<li><span>${l[0]}</span><b>${l[1]}</b></li>`).join('');
    const noteEl = r.querySelector('.result-note');
    noteEl.textContent = note;
    noteEl.hidden = !note;
    const btns = r.querySelector('.result-buttons');
    btns.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn${b.primary ? ' primary' : ''}`;
      el.textContent = b.label;
      if (b.id) el.dataset.id = b.id;
      el.addEventListener('click', () => {
        sfx.click();
        b.action(el);
      });
      btns.appendChild(el);
    }
    r.hidden = false;
    r.classList.remove('peek');
  }

  setResultNote(text) {
    const noteEl = this.resultEl.querySelector('.result-note');
    noteEl.textContent = text;
    noteEl.hidden = !text;
  }

  hideResult() {
    this.resultEl.hidden = true;
  }
}
