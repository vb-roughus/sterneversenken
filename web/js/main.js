import { FLEET, Board, Game, randomFleet, normalizeRules, coordLabel, shipDef } from './engine.js';
import { chooseShot, AI_LEVELS } from './ai.js';
import { NetSession } from './netgame.js';
import { getTransport } from './net.js';
import { Starfield } from './starfield.js';
import { Placement } from './placement.js';
import { BattleUI } from './battle.js';
import { sfx, unlockAudio, setSoundEnabled, setVibrateEnabled, vibrate } from './audio.js';
import { wait } from './fx.js';
import { shipSvg } from './ships.js';
import { bridge, callNative, nativeEvents } from './native.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ==== Einstellungen ===================================================================

const STORE_KEY = 'sterneversenken.settings';

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    s = {};
  }
  const clean = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 20) : fallback);
  const name = clean(s.name, `Pilot-${Math.floor(100 + Math.random() * 900)}`);
  return {
    name,
    hotseat: [clean(s.hotseat?.[0], name), clean(s.hotseat?.[1], 'Spieler 2')],
    sound: s.sound !== false,
    vibrate: s.vibrate !== false,
    rules: normalizeRules(s.rules),
    aiLevel: AI_LEVELS.some((l) => l.id === s.aiLevel) ? s.aiLevel : 'normal',
  };
}

const settings = loadSettings();
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* privater Modus o.ä. */
  }
}
saveSettings();
setSoundEnabled(settings.sound);
setVibrateEnabled(settings.vibrate);

function bindText(key, text) {
  $$(`[data-bind="${key}"]`).forEach((el) => {
    el.textContent = text;
  });
}

function rulesSummary(rules) {
  return [rules.bonusShot ? 'Treffer = nochmal' : 'abwechselnd', rules.allowTouch ? 'Berühren erlaubt' : 'mit Abstand'].join(' · ');
}

// ==== Oberfläche: Bildschirme, Dialoge, Meldungen =====================================

let current = 'menu';
const GAME_SCREENS = new Set(['host', 'join', 'place', 'battle', 'pass']);
let controller = null;

function show(name) {
  current = name;
  for (const s of $$('.screen')) s.classList.toggle('active', s.dataset.screen === name);
  // Die Ergebnisleiste gehört nur zum Gefecht (z.B. nach "Revanche" weg damit).
  if (name !== 'battle') battle.hideResult();
  // Bildschirm nur während eines Spiels wach halten (Menü & Einstellungen dürfen ausgehen).
  callNative('keepAwake', [GAME_SCREENS.has(name)]);
  if (name === 'menu') refreshMenu();
}

let toastTimer;
function toast(text, bad = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function banner(text) {
  const el = $('#banner');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function fillButtons(box, buttons, done) {
  box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `btn${b.primary ? ' primary' : ''}`;
    el.textContent = b.label;
    el.addEventListener('click', () => done(b));
    box.appendChild(el);
  }
}

let dialogResolve = null;
function dialog({ title, text, buttons, kind = '' }) {
  const d = $('#dialog');
  d.dataset.kind = kind;
  bindText('dialog-title', title);
  bindText('dialog-text', text);
  return new Promise((resolve) => {
    dialogResolve = resolve;
    fillButtons($('.overlay-buttons', d), buttons, (b) => closeDialog(b.value));
    d.hidden = false;
  });
}
function closeDialog(value) {
  $('#dialog').hidden = true;
  const r = dialogResolve;
  dialogResolve = null;
  r?.(value);
}

function showOverlay({ title, text, buttons = [] }) {
  const o = $('#overlay');
  bindText('overlay-title', title);
  bindText('overlay-text', text);
  fillButtons($('.overlay-buttons', o), buttons, (b) => b.action());
  o.hidden = false;
}
function hideOverlay() {
  $('#overlay').hidden = true;
}

// ==== Hintergrund & Sprung =============================================================

const starfield = new Starfield($('#stars'));
starfield.start();

async function hyperjump() {
  document.body.classList.add('warping');
  sfx.hyperspace();
  await starfield.jump(1100);
  await wait(250);
  document.body.classList.remove('warping');
}

// ==== Regeln ===========================================================================

function renderRules() {
  for (const box of $$('[data-rules]')) {
    box.innerHTML = `
      <label class="toggle"><input type="checkbox" data-rule="bonusShot"><span>Nach Treffer nochmals schiessen<small>Wer trifft, bleibt am Zug</small></span></label>
      <label class="toggle"><input type="checkbox" data-rule="allowTouch"><span>Schiffe dürfen sich berühren<small>Sonst bleibt rundum ein Feld frei</small></span></label>`;
  }
  syncRules();
}
function syncRules() {
  $$('[data-rule]').forEach((i) => {
    i.checked = settings.rules[i.dataset.rule];
  });
}
function lockRules(locked) {
  $$('[data-screen="host"] [data-rule]').forEach((i) => {
    i.disabled = locked;
  });
}
document.addEventListener('change', (e) => {
  const rule = e.target.dataset?.rule;
  if (!rule) return;
  settings.rules[rule] = e.target.checked;
  saveSettings();
  syncRules();
});

// ==== Menü, Einstellungen, Anleitung ===================================================

function refreshMenu() {
  bindText('name', settings.name);
  const t = getTransport();
  const ok = !!t && t.available;
  $$('[data-action="host"], [data-action="join"]').forEach((b) => {
    b.disabled = !ok;
  });
  const note = $('[data-bind="net-note"]');
  note.hidden = ok;
  if (!t) note.textContent = 'Spiele mit zwei Handys gibt es in der Android-App. Hier im Browser: „Ein Gerät“ oder „Training“.';
  else if (!ok) note.textContent = 'Auf diesem Gerät fehlen die Google-Play-Dienste. Ohne sie geht das Spiel mit zwei Handys nicht.';
}

function setupSettings() {
  const name = $('#set-name');
  name.value = settings.name;
  name.addEventListener('input', () => {
    const v = name.value.trim().slice(0, 20);
    if (v) {
      if (settings.hotseat[0] === settings.name) settings.hotseat[0] = v;
      settings.name = v;
      saveSettings();
      bindText('name', v);
    }
  });
  name.addEventListener('blur', () => {
    name.value = settings.name;
  });
  for (const [id, key, apply] of [
    ['#set-sound', 'sound', setSoundEnabled],
    ['#set-vibrate', 'vibrate', setVibrateEnabled],
  ]) {
    const el = $(id);
    el.checked = settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      apply(el.checked);
      saveSettings();
    });
  }
  $('[data-fleet-list]').innerHTML = FLEET.map(
    (d) => `<li><span class="fleet-icon" style="--len:${d.size}">${shipSvg(d.id, d.size)}</span>${esc(d.name)} · ${d.size} Felder</li>`,
  ).join('');
}

let localMode = 'hotseat';
function openLocalSetup(mode) {
  localMode = mode;
  bindText('local-title', mode === 'ai' ? 'Training' : 'Ein Gerät');
  $$('[data-only]').forEach((el) => {
    el.hidden = el.dataset.only !== mode;
  });
  $('#p1-name').value = settings.hotseat[0];
  $('#p2-name').value = settings.hotseat[1];
  const levels = $('[data-ai-levels]');
  levels.innerHTML = AI_LEVELS.map(
    (l) => `<button type="button" data-level="${l.id}" aria-pressed="${l.id === settings.aiLevel}">${esc(l.name)}</button>`,
  ).join('');
  show('local-setup');
}
$('[data-ai-levels]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  settings.aiLevel = b.dataset.level;
  saveSettings();
  $$('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});

// ==== Gemeinsame Spielbausteine ========================================================

const placement = new Placement($('[data-screen="place"]'), {
  onChange: (p) => {
    $('[data-action="ready"]').disabled = !p.isComplete() || p.root.classList.contains('locked');
  },
});
const battle = new BattleUI($('[data-screen="battle"]'));

function setPlaceTexts(title, sub) {
  bindText('place-title', title);
  bindText('place-sub', sub);
}

function lockPlacement(locked, label = 'Bereit') {
  const root = placement.root;
  root.classList.toggle('locked', locked);
  const btn = $('[data-action="ready"]');
  btn.textContent = label;
  btn.disabled = locked || !placement.isComplete();
}

function statTable(names, stats, score) {
  return {
    names,
    rows: [
      ['Schüsse', stats[0].shots, stats[1].shots],
      ['Trefferquote', `${stats[0].accuracy} %`, `${stats[1].accuracy} %`],
      ['Versenkt', stats[0].sunk, stats[1].sunk],
      ['Gesamtstand', score[0], score[1]],
    ],
  };
}

// ==== Lokales Spiel: ein Gerät oder gegen die KI ======================================

class LocalMatch {
  constructor(mode) {
    this.mode = mode;
    this.rules = { ...settings.rules };
    this.level = settings.aiLevel;
    const levelName = AI_LEVELS.find((l) => l.id === this.level).name;
    this.names = mode === 'ai' ? [settings.name, `KI ${levelName}`] : [...settings.hotseat];
    this.score = [0, 0];
    this.lastWinner = null;
    this.busy = false;
    this.ended = false;
  }

  start() {
    this.newRound();
  }

  newRound() {
    this.fleets = [null, null];
    this.first = this.lastWinner === null ? (Math.random() < 0.5 ? 0 : 1) : 1 - this.lastWinner;
    this.game = null;
    this.lastShot = [null, null];
    if (this.mode === 'ai') {
      this.fleets[1] = randomFleet(this.rules);
      this.placeFor(0);
    } else {
      this.passTo(0, `Stelle deine Flotte auf. ${this.names[1]} schaut weg!`, () => this.placeFor(0));
    }
  }

  placeFor(p) {
    this.placing = p;
    placement.reset(this.rules);
    lockPlacement(false);
    const sub = this.mode === 'hotseat' ? `${this.names[p]} · ${rulesSummary(this.rules)}` : `Gegen ${this.names[1]} · ${rulesSummary(this.rules)}`;
    setPlaceTexts('Flotte aufstellen', sub);
    bindText('opp-status', '');
    show('place');
  }

  onPlaced(fleet) {
    this.fleets[this.placing] = fleet;
    if (this.mode === 'hotseat' && this.placing === 0) {
      this.passTo(1, `${this.names[0]} ist bereit. Jetzt stellst du deine Flotte auf.`, () => this.placeFor(1));
      return;
    }
    this.game = new Game({ rules: this.rules, first: this.first, boards: [new Board(this.fleets[0]), new Board(this.fleets[1])] });
    if (this.mode === 'hotseat') {
      this.passTo(this.first, `${this.names[this.first]} eröffnet das Gefecht.`, () => this.enterBattle(this.first, true));
    } else {
      this.enterBattle(0, true);
    }
  }

  passTo(p, info, next) {
    this.onPass = next;
    bindText('pass-name', this.names[p]);
    bindText('pass-info', info);
    show('pass');
  }

  onPassContinue() {
    const next = this.onPass;
    this.onPass = null;
    next?.();
  }

  async enterBattle(viewer, jump) {
    this.viewer = viewer;
    this.turnLog = [];
    const g = this.game;
    if (jump) await hyperjump();
    if (this.ended) return;
    battle.bind({
      me: this.names[viewer],
      opp: this.names[1 - viewer],
      rules: this.rules,
      own: () => g.boards[viewer],
      enemy: () => g.boards[1 - viewer],
      canFire: () => !this.busy && g.turn() === viewer,
      onFire: (x, y) => this.fire(x, y),
      score: this.mode === 'ai' ? this.score : [this.score[viewer], this.score[1 - viewer]],
      lastOwn: this.lastShot[viewer],
    });
    show('battle');
    this.updateStatus();
    if (jump) banner(g.turn() === viewer ? (this.mode === 'ai' ? 'Du beginnst' : `${this.names[viewer]} beginnt`) : `${this.names[g.turn()]} beginnt`);
    else sfx.turn();
    if (this.mode === 'ai' && g.turn() === 1) {
      await wait(1200);
      this.aiTurn();
    }
  }

  updateStatus(sub) {
    const t = this.game.turn();
    if (t === null) return;
    if (t === this.viewer) battle.setStatus('Dein Zug', sub || 'Wähle ein Ziel im gegnerischen Feld', 'turn');
    else battle.setStatus('Gegner am Zug', sub || `${this.names[t]} zielt …`, 'muted');
    battle.render();
  }

  async fire(x, y) {
    const p = this.viewer;
    const g = this.game;
    if (this.busy || !g.canFire(p, x, y)) return;
    this.busy = true;
    battle.setStatus('Feuer!', `Ziel ${coordLabel(x, y)}`, '');
    battle.render();
    const res = g.fire(p, x, y);
    this.lastShot[1 - p] = { x, y };
    this.turnLog.push(res);
    await battle.shootLaser(x, y);
    await battle.showOutcome(res);
    if (this.ended) return;
    if (g.isOver()) {
      this.finish();
      return;
    }
    if (g.turn() === p) {
      await wait(450);
      this.busy = false;
      this.updateStatus(res.result === 'miss' ? undefined : 'Treffer – du darfst nochmals schiessen');
      return;
    }
    await wait(900);
    if (this.ended) return;
    if (this.mode === 'ai') {
      this.updateStatus();
      this.aiTurn();
    } else {
      this.busy = false;
      this.passTo(1 - p, this.turnSummary(p), () => this.enterBattle(1 - p, false));
    }
  }

  turnSummary(p) {
    const log = this.turnLog;
    const hits = log.filter((s) => s.result !== 'miss').length;
    const sunk = log.filter((s) => s.result === 'sunk').map((s) => shipDef(s.ship.id).name);
    let text = `${this.names[p]} hat ${log.length === 1 ? 'einmal' : `${log.length} Mal`} geschossen: `;
    text += hits ? `${hits} Treffer` : 'kein Treffer';
    if (sunk.length) text += `, versenkt: ${sunk.join(', ')}`;
    return `${text}.`;
  }

  async aiTurn() {
    const g = this.game;
    this.busy = true;
    this.updateStatus();
    while (!this.ended && !g.isOver() && g.turn() === 1) {
      await wait(600 + Math.random() * 700);
      if (this.ended) return;
      const { x, y } = chooseShot(g.boards[0], this.rules, this.level);
      const res = g.fire(1, x, y);
      this.lastShot[0] = { x, y };
      await battle.showIncoming(res);
    }
    if (this.ended) return;
    this.busy = false;
    if (g.isOver()) {
      this.finish();
      return;
    }
    sfx.turn();
    this.updateStatus();
  }

  async finish() {
    const g = this.game;
    const w = g.winner();
    this.lastWinner = w;
    this.score[w] += 1;
    this.busy = true;
    await wait(500);
    battle.revealFleet(g.boards[1 - this.viewer].fleet);
    const humanWon = this.mode === 'hotseat' || w === 0;
    if (humanWon) sfx.victory();
    else sfx.defeat();
    const title = this.mode === 'ai' ? (w === 0 ? 'Sieg!' : 'Niederlage') : `${this.names[w]} siegt!`;
    battle.setStatus(title, 'Gefecht beendet', humanWon ? 'good' : 'bad');
    banner(title);
    await wait(1300);
    if (this.ended) return;
    battle.showResult({
      title,
      tone: humanWon ? 'win' : 'lose',
      ...statTable(this.names, [g.stats(0), g.stats(1)], this.score),
      buttons: [
        { label: 'Revanche', primary: true, action: () => this.newRound() },
        { label: 'Menü', action: () => this.end() },
      ],
    });
  }

  async back() {
    if (current === 'battle' && this.game?.isOver()) {
      this.end();
      return;
    }
    const ok = await dialog({
      title: 'Partie abbrechen?',
      text: 'Der aktuelle Spielstand geht verloren.',
      buttons: [
        { label: 'Weiterspielen', value: false },
        { label: 'Abbrechen', value: true, primary: true },
      ],
    });
    if (ok) this.end();
  }

  end() {
    this.ended = true;
    controller = null;
    show('menu');
  }
}

// ==== Netzwerkspiel ====================================================================

class OnlineMatch {
  constructor(role) {
    this.role = role;
    this.t = getTransport();
    this.session = new NetSession({
      role,
      name: settings.name,
      rules: { ...settings.rules },
      send: (m) => this.t.send(m),
    });
    this.found = new Map();
    this.queue = Promise.resolve();
    this.anims = 0;
    this.reconnecting = false;
    this.ended = false;
    this.laser = null;
    this.offs = [];
    this.wire();
  }

  get opp() {
    return this.session.opponentName || 'Gegner';
  }

  enqueue(fn) {
    this.anims++;
    this.queue = this.queue
      .then(() => (this.ended ? null : fn()))
      .catch((err) => console.error(err))
      .finally(() => {
        this.anims--;
        if (!this.ended && current === 'battle') battle.render();
      });
    return this.queue;
  }

  wire() {
    const on = (type, fn) => this.offs.push(this.t.on(type, fn));
    const status = (text) => bindText(this.role === 'host' ? 'host-status' : 'join-status', text);

    on('advertising', () => {
      if (!this.reconnecting) status('Warte auf Mitspieler …');
    });
    on('discovering', () => {
      if (!this.reconnecting) status('Suche Spiele in der Nähe …');
    });
    on('found', ({ id, name }) => {
      this.found.set(id, name);
      if (this.reconnecting && name === this.session.opponentName) {
        this.t.connect(id);
        bindText('overlay-text', `${this.opp} gefunden – verbinde …`);
      }
      this.renderFound();
    });
    on('lost', ({ id }) => {
      this.found.delete(id);
      this.renderFound();
    });
    on('connecting', ({ name, code }) => {
      const text = `Verbinde mit ${name || 'Mitspieler'} …${code ? ` Code ${code}` : ''}`;
      if (this.reconnecting) bindText('overlay-text', text);
      else status(text);
    });
    on('connected', () => {
      if (this.role === 'host') lockRules(true);
      $$('.radar').forEach((r) => r.classList.add('done'));
      if (!this.reconnecting) status('Verbunden – Spiel wird vorbereitet …');
      this.session.connected();
    });
    on('connect-failed', ({ message, kind }) => {
      if (kind === 'permission') {
        this.problem({ message, kind });
        return;
      }
      toast(message || 'Verbindung fehlgeschlagen', true);
      if (this.role === 'guest') setTimeout(() => this.restartLobby(), 1200);
    });
    on('disconnected', () => this.onDisconnected());
    on('message', ({ text }) => this.session.receive(text));
    on('error', (data) => this.problem(data));
    on('hint', (data) => {
      if (this.inLobby()) this.showNotice({ ...data, retry: false });
      else toast(data.message);
    });
    on('resumed', () => {
      // Zurück aus den Einstellungen: automatisch nochmals versuchen.
      if (!this.awaitingSettings) return;
      this.awaitingSettings = false;
      this.hideNotice();
      if (this.inLobby() || this.reconnecting) this.restartLobby();
    });

    const s = this.session;
    s.on('opponent', ({ name }) => {
      if (!this.reconnecting) status(`Verbunden mit ${name}`);
    });
    s.on('setup', () => this.enqueue(() => this.enterPlacement()));
    s.on('opponentReady', () => this.enqueue(() => this.updateOppStatus()));
    s.on('battle', () => this.enqueue(() => this.enterBattle(true)));
    s.on('fired', ({ x, y }) => {
      this.laser = battle.shootLaser(x, y);
      battle.setStatus('Feuer!', `Ziel ${coordLabel(x, y)} …`, '');
      battle.render();
    });
    s.on('outcome', (shot) =>
      this.enqueue(async () => {
        await this.laser;
        await battle.showOutcome(shot);
        await this.afterShot(shot, true);
      }),
    );
    s.on('incoming', (shot) =>
      this.enqueue(async () => {
        await battle.showIncoming(shot);
        await this.afterShot(shot, false);
      }),
    );
    s.on('sync', () => this.enqueue(() => this.onSync()));
    s.on('over', ({ winner }) => this.enqueue(() => this.showOver(winner)));
    s.on('reveal', ({ fleet, verified }) =>
      this.enqueue(() => {
        battle.revealFleet(fleet);
        if (!verified) {
          battle.setResultNote(`Achtung: Die Aufstellung von ${this.opp} passt nicht zu den gemeldeten Treffern.`);
        }
      }),
    );
    s.on('rematch', () => this.enqueue(() => this.onRematchRequest()));
    s.on('left', () => this.enqueue(() => this.opponentLeft()));
    s.on('error', ({ message }) => toast(message, true));
  }

  start() {
    this.found.clear();
    this.hideNotice();
    $$('.radar').forEach((r) => r.classList.remove('done'));
    if (this.role === 'host') {
      lockRules(false);
      syncRules();
      bindText('host-status', 'Sende Signal …');
      show('host');
    } else {
      bindText('join-status', 'Suche Spiele in der Nähe …');
      this.renderFound();
      show('join');
    }
    this.restartLobby();
  }

  inLobby() {
    return this.session.phase === 'lobby' && !this.reconnecting && (current === 'host' || current === 'join');
  }

  /** Fehler vom Transport: in der Lobby als Hinweis mit Knöpfen, sonst als Meldung. */
  problem({ message, kind, code }) {
    const text = message || 'Unbekannter Fehler';
    if (this.inLobby() || kind === 'permission') {
      bindText(this.role === 'host' ? 'host-status' : 'join-status', 'Verbindung nicht möglich');
      this.showNotice({ message: text, kind: kind || 'error', code, retry: true });
    } else {
      toast(text, true);
    }
  }

  showNotice({ message, kind, retry }) {
    const screen = $(`[data-screen="${this.role === 'host' ? 'host' : 'join'}"]`);
    const box = $('[data-notice]', screen);
    box.dataset.kind = kind || '';
    $('.notice-text', box).textContent = message;
    const buttons = [];
    const settings = {
      permission: ['Berechtigungen öffnen', 'app'],
      location: ['Standort einschalten', 'location'],
      bluetooth: ['Bluetooth einschalten', 'bluetooth'],
    }[kind];
    if (settings) {
      buttons.push({
        label: settings[0],
        primary: true,
        action: () => {
          this.awaitingSettings = true;
          this.t.openSettings(settings[1]);
        },
      });
    }
    if (retry) {
      buttons.push({
        label: 'Nochmals versuchen',
        primary: !settings,
        action: () => {
          this.hideNotice();
          this.restartLobby();
        },
      });
    } else {
      buttons.push({ label: 'OK', action: () => this.hideNotice() });
    }
    fillButtons($('.notice-buttons', box), buttons, (b) => b.action());
    box.hidden = false;
  }

  hideNotice() {
    $$('[data-notice]').forEach((b) => {
      b.hidden = true;
    });
  }

  restartLobby() {
    if (this.ended) return;
    if (this.role === 'host') {
      this.session.hostRules = normalizeRules(settings.rules);
      this.t.host(settings.name);
    } else {
      this.found.clear();
      this.renderFound();
      this.t.discover(settings.name);
    }
  }

  renderFound() {
    const list = $('[data-bind="found"]');
    if (this.reconnecting || this.role !== 'guest') return;
    list.innerHTML = '';
    for (const [id, name] of this.found) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = name;
      b.addEventListener('click', () => {
        sfx.click();
        bindText('join-status', `Verbinde mit ${name} …`);
        this.t.connect(id);
      });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  // ---- Ablauf -------------------------------------------------------------------------

  enterPlacement() {
    hideOverlay();
    this.rematchPrompted = false;
    if ($('#dialog').dataset.kind === 'rematch' && !$('#dialog').hidden) closeDialog(false);
    this.reconnecting = false;
    placement.reset(this.session.rules);
    lockPlacement(false);
    setPlaceTexts('Flotte aufstellen', `Gegen ${this.opp} · ${rulesSummary(this.session.rules)}`);
    this.updateOppStatus();
    show('place');
    if (this.session.round > 1) toast('Revanche! Stellt eure Flotten neu auf.');
  }

  updateOppStatus() {
    bindText('opp-status', this.session.oppReady ? `${this.opp} ist bereit.` : `${this.opp} stellt die Flotte auf …`);
  }

  onPlaced(fleet) {
    if (!this.session.placeFleet(fleet)) {
      toast('Aufstellung ungültig', true);
      return;
    }
    if (this.session.phase === 'placing') lockPlacement(true, `Warte auf ${this.opp} …`);
  }

  async enterBattle(jump) {
    hideOverlay();
    lockPlacement(false);
    if (jump) await hyperjump();
    if (this.ended) return;
    const s = this.session;
    battle.bind({
      me: settings.name,
      opp: this.opp,
      rules: s.rules,
      own: () => s.myBoard,
      enemy: () => s.enemyBoard,
      canFire: () => s.isMyTurn() && this.anims === 0 && !this.reconnecting,
      onFire: (x, y) => s.fire(x, y),
      score: s.score,
    });
    show('battle');
    this.updateStatus();
    if (jump) banner(s.game.turn() === 0 ? 'Du beginnst' : `${this.opp} beginnt`);
  }

  updateStatus(sub) {
    const s = this.session;
    if (s.phase !== 'battle') return;
    if (s.pending) battle.setStatus('Feuer!', 'Warte auf Meldung …', '');
    else if (s.game.turn() === 0) battle.setStatus('Dein Zug', sub || 'Wähle ein Ziel im gegnerischen Feld', 'turn');
    else battle.setStatus('Gegner am Zug', sub || `${this.opp} zielt …`, 'muted');
    battle.render();
  }

  async afterShot(shot, mine) {
    if (this.session.phase !== 'battle') return;
    await wait(mine ? 650 : 250);
    const myTurn = this.session.game.turn() === 0;
    if (myTurn && !mine) sfx.turn();
    this.updateStatus(mine && myTurn && shot.result !== 'miss' ? 'Treffer – du darfst nochmals schiessen' : undefined);
  }

  async showOver(winner) {
    const won = winner === 0;
    await wait(400);
    if (won) sfx.victory();
    else sfx.defeat();
    battle.setStatus(won ? 'Sieg!' : 'Niederlage', 'Gefecht beendet', won ? 'good' : 'bad');
    banner(won ? 'Sieg!' : 'Niederlage');
    await wait(1300);
    const s = this.session;
    battle.showResult({
      title: won ? 'Sieg!' : 'Niederlage',
      tone: won ? 'win' : 'lose',
      ...statTable([settings.name, this.opp], [s.game.stats(0), s.game.stats(1)], s.score),
      buttons: [
        { id: 'rematch', label: 'Revanche', primary: true, action: () => this.acceptRematch() },
        { label: 'Menü', action: () => this.leave() },
      ],
    });
    // Kam die Anfrage schon während der Siegesanzeige, jetzt deutlich zeigen.
    if (s.rematch.them && !s.rematch.me) this.onRematchRequest();
  }

  /** Revanche anfragen bzw. die Anfrage des Gegners annehmen. */
  acceptRematch() {
    const s = this.session;
    if (s.phase !== 'over' || s.rematch.me) return;
    const btn = $('.result-buttons [data-id="rematch"]');
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('attention');
      btn.textContent = s.rematch.them ? 'Startet …' : 'Angefragt …';
    }
    if (!s.rematch.them) battle.setResultNote(`Revanche angefragt – warte auf ${this.opp} …`);
    s.requestRematch();
  }

  /** Der Gegner fordert eine Revanche: Ton, Vibration, Hinweis und Dialog mit „Annehmen“. */
  onRematchRequest() {
    const s = this.session;
    if (s.phase !== 'over' || s.rematch.me || current !== 'battle' || this.rematchPrompted) return;
    const result = $('.result');
    if (result.hidden) return; // Ergebnis noch nicht da – showOver() holt das nach
    this.rematchPrompted = true;
    result.classList.remove('peek');
    battle.setResultNote(`${this.opp} fordert eine Revanche!`, true);
    const btn = $('.result-buttons [data-id="rematch"]');
    if (btn) {
      btn.textContent = 'Revanche annehmen';
      btn.classList.add('attention');
    }
    sfx.turn();
    vibrate([80, 60, 80, 60, 160]);
    dialog({
      kind: 'rematch',
      title: 'Revanche!',
      text: `${this.opp} fordert eine Revanche. Annehmen?`,
      buttons: [
        { label: 'Nicht jetzt', value: false },
        { label: 'Annehmen', value: true, primary: true },
      ],
    }).then((ok) => {
      if (ok) this.acceptRematch();
    });
  }

  onSync() {
    const wasReconnecting = this.reconnecting;
    this.reconnecting = false;
    hideOverlay();
    if (wasReconnecting) toast('Verbindung wiederhergestellt');
    const s = this.session;
    if (s.phase === 'placing') {
      if (current !== 'place') this.enterPlacement();
      else this.updateOppStatus();
      if (s.myReady) lockPlacement(true, `Warte auf ${this.opp} …`);
    } else if (s.phase === 'battle') {
      if (current !== 'battle') return this.enterBattle(false);
      this.updateStatus();
    } else if (s.phase === 'over') {
      if (current !== 'battle') this.enterBattle(false);
    }
    return undefined;
  }

  onDisconnected() {
    if (this.ended) return;
    if (this.session.phase === 'lobby') {
      toast('Verbindung abgebrochen', true);
      lockRules(false);
      $$('.radar').forEach((r) => r.classList.remove('done'));
      setTimeout(() => this.restartLobby(), 800);
      return;
    }
    this.reconnecting = true;
    if (current === 'battle') battle.render();
    showOverlay({
      title: 'Verbindung verloren',
      text: this.role === 'host' ? `Warte, bis sich ${this.opp} wieder verbindet …` : `Suche ${this.opp} …`,
      buttons: [{ label: 'Aufgeben', action: () => this.leave() }],
    });
    setTimeout(() => this.restartLobby(), 800);
  }

  async opponentLeft() {
    if ($('#dialog').dataset.kind === 'rematch' && !$('#dialog').hidden) closeDialog(false);
    if (this.session.phase === 'over') {
      battle.setResultNote(`${this.opp} hat das Spiel verlassen.`);
      $$('.result-buttons .btn.primary').forEach((b) => {
        b.disabled = true;
        b.classList.remove('attention');
      });
      this.ended = true;
      this.cleanup();
      return;
    }
    this.ended = true;
    this.cleanup();
    await dialog({ title: 'Spiel beendet', text: `${this.opp} hat das Spiel verlassen.`, buttons: [{ label: 'OK', value: true, primary: true }] });
    controller = null;
    show('menu');
  }

  async back() {
    if (current === 'host' || current === 'join' || this.session.phase === 'over') {
      this.leave();
      return;
    }
    const ok = await dialog({
      title: 'Spiel verlassen?',
      text: `Die Partie gegen ${this.opp} wird beendet.`,
      buttons: [
        { label: 'Bleiben', value: false },
        { label: 'Verlassen', value: true, primary: true },
      ],
    });
    if (ok) this.leave();
  }

  cleanup() {
    hideOverlay();
    this.hideNotice();
    lockRules(false);
    this.offs.forEach((off) => off());
    this.offs = [];
    const t = this.t;
    setTimeout(() => t.stop(), 300);
  }

  leave() {
    if (!this.ended) {
      try {
        this.session.leave();
      } catch {
        /* Verbindung schon weg */
      }
    }
    this.ended = true;
    this.cleanup();
    controller = null;
    show('menu');
  }
}

// ==== Updates (nur in der Android-App) ================================================

const update = { state: 'idle', info: null, percent: 0, error: '', manual: false, awaitingPermission: false };

function renderUpdate() {
  const { state, info } = update;
  const latest = info?.latest ? `Version ${info.latest}` : 'neue Version';
  const banner = $('[data-update-banner]');
  banner.hidden = !['available', 'downloading', 'installing', 'needs-permission', 'failed'].includes(state);
  banner.disabled = state === 'downloading' || state === 'installing';
  const texts = {
    available: ['Update verfügbar', `${latest} – jetzt installieren`],
    downloading: ['Update wird geladen', `${update.percent} %`],
    installing: ['Update bereit', 'Installation wird geöffnet …'],
    'needs-permission': ['Erlaubnis nötig', '„Unbekannte Apps installieren“ erlauben, dann hier tippen'],
    failed: ['Update fehlgeschlagen', 'Tippen, um es nochmals zu versuchen'],
  }[state] || ['', ''];
  bindText('update-title', texts[0]);
  bindText('update-sub', texts[1]);

  const status = {
    idle: '',
    checking: 'Suche nach Updates …',
    current: 'Du hast die neueste Version.',
    available: `Neu verfügbar: ${latest}.`,
    downloading: `Lade Update … ${update.percent} %`,
    installing: 'Installation wird geöffnet …',
    'needs-permission': 'Bitte für Sterne versenken „Unbekannte Apps installieren“ erlauben.',
    'check-failed': `Suche fehlgeschlagen: ${update.error}`,
    failed: `Update fehlgeschlagen: ${update.error}`,
  }[state];
  bindText('update-status', status || '');
  const button = $('[data-bind="update-button"]');
  const install = ['available', 'failed', 'needs-permission'].includes(state);
  button.disabled = ['checking', 'downloading', 'installing'].includes(state);
  button.textContent = install ? 'Update installieren' : 'Nach Updates suchen';
  button.classList.toggle('primary', install);
}

function checkForUpdate(manual) {
  update.manual = manual;
  update.state = 'checking';
  renderUpdate();
  callNative('checkUpdate');
}

function installUpdate() {
  update.state = 'downloading';
  update.percent = 0;
  renderUpdate();
  callNative('startUpdate');
}

function onUpdateAction() {
  if (['available', 'failed', 'needs-permission'].includes(update.state)) installUpdate();
  else if (!['checking', 'downloading', 'installing'].includes(update.state)) checkForUpdate(true);
}

function setupUpdates() {
  if (!bridge) return;
  $$('[data-native-only]').forEach((el) => {
    el.hidden = false;
  });
  try {
    const v = JSON.parse(callNative('appVersion', [], '{}'));
    bindText('app-version', v.name ? `Version ${v.name}` : '');
  } catch {
    bindText('app-version', '');
  }
  nativeEvents.on('update-info', (info) => {
    update.info = info;
    update.state = info.available ? 'available' : 'current';
    renderUpdate();
  });
  nativeEvents.on('update-progress', ({ percent }) => {
    update.state = 'downloading';
    update.percent = percent;
    renderUpdate();
  });
  nativeEvents.on('update-installing', () => {
    update.state = 'installing';
    renderUpdate();
  });
  nativeEvents.on('update-needs-permission', () => {
    update.state = 'needs-permission';
    update.awaitingPermission = true;
    renderUpdate();
  });
  nativeEvents.on('update-error', ({ message, phase }) => {
    update.error = message || 'unbekannter Fehler';
    // Eine fehlgeschlagene automatische Suche (z.B. ohne Internet) bleibt still.
    if (phase === 'check') {
      update.state = update.manual ? 'check-failed' : 'idle';
      if (update.manual) toast(`Update-Suche fehlgeschlagen: ${update.error}`, true);
    } else {
      update.state = 'failed';
      toast(`Update fehlgeschlagen: ${update.error}`, true);
    }
    renderUpdate();
  });
  nativeEvents.on('resumed', () => {
    if (update.state === 'installing') {
      // Installer abgebrochen: Knopf wieder anbieten.
      update.state = 'available';
      renderUpdate();
    }
    if (!update.awaitingPermission) return;
    update.awaitingPermission = false;
    if (callNative('canInstallUpdates', [], false)) installUpdate();
  });
  checkForUpdate(false);
}

// ==== Ereignisse =======================================================================

function goBack() {
  if (!$('#dialog').hidden) {
    closeDialog(false);
    return true;
  }
  const result = $('.result');
  if (current === 'battle' && !result.hidden && result.classList.contains('peek')) {
    result.classList.remove('peek');
    return true;
  }
  if (current === 'menu') return false;
  if (controller && ['host', 'join', 'place', 'battle', 'pass'].includes(current)) {
    controller.back();
    return true;
  }
  show('menu');
  return true;
}

// Wird von der Android-App beim Zurück-Knopf aufgerufen.
window.App = { onBack: () => goBack() };

document.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
  },
  { once: true },
);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.classList.contains('back')) {
    sfx.click();
    goBack();
    return;
  }
  if (btn.dataset.go) {
    sfx.click();
    show(btn.dataset.go);
    return;
  }
  if (btn.classList.contains('peek-btn')) btn.closest('.result').classList.add('peek');
  if (btn.classList.contains('unpeek-btn')) btn.closest('.result').classList.remove('peek');
  const action = btn.dataset.action;
  if (!action) return;
  switch (action) {
    case 'host':
    case 'join':
      sfx.click();
      controller = new OnlineMatch(action === 'host' ? 'host' : 'guest');
      controller.start();
      break;
    case 'hotseat':
    case 'ai':
      sfx.click();
      openLocalSetup(action);
      break;
    case 'local-start': {
      sfx.click();
      if (localMode === 'hotseat') {
        const p1 = $('#p1-name').value.trim().slice(0, 20) || 'Spieler 1';
        let p2 = $('#p2-name').value.trim().slice(0, 20) || 'Spieler 2';
        if (p2 === p1) p2 = `${p2} (2)`;
        settings.hotseat = [p1, p2];
        saveSettings();
      }
      controller = new LocalMatch(localMode);
      controller.start();
      break;
    }
    case 'rotate':
      placement.rotate();
      break;
    case 'random':
      placement.randomize();
      break;
    case 'clear':
      placement.clear();
      break;
    case 'ready':
      if (placement.isComplete() && controller) {
        sfx.select();
        controller.onPlaced(placement.fleet);
      }
      break;
    case 'update':
      sfx.click();
      onUpdateAction();
      break;
    case 'pass-continue':
      sfx.click();
      controller?.onPassContinue?.();
      break;
    default:
  }
});

// ==== Start ============================================================================

renderRules();
setupSettings();
setupUpdates();
show('menu');

// Für automatisierte Tests im Browser
window.__sv = { settings, get controller() { return controller; }, placement, battle };
