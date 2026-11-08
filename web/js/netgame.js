// Spielprotokoll zwischen zwei Geräten. Unabhängig vom Transport (Nearby, Simulation, Tests).
//
// Jedes Gerät kennt nur die eigene Flotte. Schüsse gehen an den Gegner, der das Ergebnis
// zurückmeldet. Wer am Zug ist, wird aus dem Schussverlauf berechnet. Nach einem
// Verbindungsabbruch tauschen die Geräte ihren Verlauf aus ("sync") und spielen weiter.
// Nach Spielende legen beide ihre Flotte offen; so fallen falsche Meldungen auf.

import { Emitter } from './emitter.js';
import {
  Board,
  Game,
  FLEET,
  SIZE,
  inBounds,
  normalizeRules,
  validateFleet,
  verifyReveal,
} from './engine.js';

export const PROTOCOL_VERSION = 1;

const isInt = (v) => Number.isInteger(v);
const isCoord = (x, y) => isInt(x) && isInt(y) && inBounds(x, y);
const RESULTS = new Set(['miss', 'hit', 'sunk']);

function cleanShip(ship) {
  if (!ship || typeof ship !== 'object') return null;
  if (!FLEET.some((d) => d.id === ship.id)) return null;
  if (!isCoord(ship.x, ship.y) || (ship.dir !== 'h' && ship.dir !== 'v')) return null;
  return { id: ship.id, x: ship.x, y: ship.y, dir: ship.dir };
}

function cleanShots(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s || !isCoord(s.x, s.y) || !RESULTS.has(s.result)) return null;
    const k = s.y * SIZE + s.x;
    if (seen.has(k)) return null;
    seen.add(k);
    const entry = { x: s.x, y: s.y, result: s.result };
    if (s.result === 'sunk') {
      const ship = cleanShip(s.ship);
      if (!ship) return null;
      entry.ship = ship;
    }
    out.push(entry);
  }
  return out;
}

function randomId(rng) {
  return Math.floor(rng() * 0xffffffff).toString(36) + Date.now().toString(36);
}

export class NetSession extends Emitter {
  /**
   * @param {object} o
   * @param {'host'|'guest'} o.role
   * @param {string} o.name  eigener Name
   * @param {object} [o.rules] Regeln (nur beim Host massgebend)
   * @param {(msg:object)=>void} o.send
   */
  constructor({ role, name, rules, send, rng = Math.random }) {
    super();
    this.role = role;
    this.name = name;
    this.hostRules = normalizeRules(rules);
    this.send = send;
    this.rng = rng;
    this.opponentName = '';
    this.gameId = null;
    this.game = null;
    this.phase = 'lobby'; // lobby | placing | battle | over
    this.myReady = false;
    this.oppReady = false;
    this.pending = null;
    this.oppFleet = null;
    this.revealVerified = null;
    this.rematch = { me: false, them: false };
    this.round = 0;
    this.lastWinner = null; // 0 = ich, 1 = Gegner
    this.score = [0, 0];
  }

  get rules() {
    return this.game?.rules ?? this.hostRules;
  }

  get myBoard() {
    return this.game?.boards[0];
  }

  get enemyBoard() {
    return this.game?.boards[1];
  }

  isMyTurn() {
    return this.phase === 'battle' && !this.pending && this.game.turn() === 0;
  }

  // ---- Ereignisse vom Transport -------------------------------------------------

  /** Verbindung steht (neu oder wieder). */
  connected() {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, role: this.role, gameId: this.gameId });
  }

  receive(raw) {
    let msg = raw;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!msg || typeof msg.t !== 'string') return;
    const handler = this[`on_${msg.t}`];
    if (typeof handler === 'function') handler.call(this, msg);
  }

  // ---- Aktionen des Spielers ----------------------------------------------------

  /** Eigene Flotte festlegen und Bereitschaft melden. */
  placeFleet(fleet) {
    if (this.phase !== 'placing') return false;
    if (!validateFleet(fleet, this.rules)) return false;
    this.game.boards[0] = new Board(fleet);
    this.myReady = true;
    this.send({ t: 'ready', gameId: this.gameId });
    this._maybeStartBattle();
    return true;
  }

  fire(x, y) {
    if (!this.isMyTurn() || !this.game.canFire(0, x, y)) return false;
    this.pending = { n: this.enemyBoard.shots.length, x, y };
    this.send({ t: 'shot', gameId: this.gameId, n: this.pending.n, x, y });
    this.emit('fired', { x, y });
    return true;
  }

  requestRematch() {
    if (this.phase !== 'over') return;
    this.rematch.me = true;
    this.send({ t: 'rematch', gameId: this.gameId });
    this._maybeRematch();
  }

  leave() {
    this.send({ t: 'bye' });
  }

  // ---- Interne Abläufe ------------------------------------------------------------

  _newGame() {
    let first;
    if (this.lastWinner === null) first = this.rng() < 0.5 ? 'host' : 'guest';
    else first = this.lastWinner === 0 ? 'guest' : 'host'; // Verlierer beginnt die Revanche
    const setup = { t: 'setup', gameId: randomId(this.rng), rules: this.hostRules, first };
    this._applySetup(setup);
    this.send(setup);
  }

  _applySetup(setup) {
    this.gameId = setup.gameId;
    const rules = normalizeRules(setup.rules);
    const first = setup.first === this.role ? 0 : 1;
    this.game = new Game({ rules, first, boards: [new Board(null), new Board(null)] });
    this.phase = 'placing';
    this.myReady = false;
    this.oppReady = false;
    this.pending = null;
    this.oppFleet = null;
    this.revealVerified = null;
    this.rematch = { me: false, them: false };
    this.round += 1;
    this.emit('setup', { rules, first, round: this.round });
  }

  _maybeStartBattle() {
    if (this.phase === 'placing' && this.myReady && this.oppReady) {
      this.phase = 'battle';
      this.emit('battle', { first: this.game.first });
    }
  }

  _maybeRematch() {
    if (this.role === 'host' && this.rematch.me && this.rematch.them) this._newGame();
  }

  _sendSync() {
    this.send({
      t: 'sync',
      gameId: this.gameId,
      ready: this.myReady,
      incoming: this.myBoard ? this.myBoard.shots : [],
    });
    if (this.phase === 'over') this._sendReveal();
  }

  _sendReveal() {
    if (this.myBoard?.fleet) this.send({ t: 'reveal', gameId: this.gameId, fleet: this.myBoard.fleet });
  }

  _checkOver() {
    if (this.phase !== 'battle' || !this.game.isOver()) return;
    this.phase = 'over';
    const winner = this.game.winner();
    this.lastWinner = winner;
    this.score[winner] += 1;
    this.pending = null;
    this.emit('over', { winner });
    this._sendReveal();
  }

  _sameGame(msg) {
    return this.game && msg.gameId === this.gameId;
  }

  // ---- Nachrichten ----------------------------------------------------------------

  on_hello(msg) {
    if (msg.v !== PROTOCOL_VERSION) {
      this.emit('error', { message: 'Der Gegner hat eine andere App-Version. Bitte beide aktualisieren.' });
      return;
    }
    this.opponentName = String(msg.name || 'Gegner').slice(0, 24);
    this.emit('opponent', { name: this.opponentName });
    if (this.role !== 'host') return;
    if (this.game && msg.gameId === this.gameId) {
      this.send({ t: 'resume', gameId: this.gameId });
      this._sendSync();
    } else {
      this._newGame();
    }
  }

  on_setup(msg) {
    if (this.role !== 'guest' || typeof msg.gameId !== 'string') return;
    if (msg.first !== 'host' && msg.first !== 'guest') return;
    this._applySetup(msg);
  }

  on_resume(msg) {
    if (this.role !== 'guest' || !this._sameGame(msg)) return;
    this._sendSync();
  }

  on_sync(msg) {
    if (!this._sameGame(msg)) return;
    const shots = cleanShots(msg.incoming);
    if (!shots) return;
    this.oppReady = !!msg.ready;
    const enemy = new Board(null);
    shots.forEach((s) => enemy.record(s));
    this.game.boards[1] = enemy;
    this.pending = null; // entweder schon aufgelöst oder nie angekommen
    if (this.phase === 'placing') this._maybeStartBattle();
    if (this.phase === 'battle') this._checkOver();
    this.emit('sync', {});
  }

  on_ready(msg) {
    if (!this._sameGame(msg) || this.phase !== 'placing') return;
    this.oppReady = true;
    this.emit('opponentReady', {});
    this._maybeStartBattle();
  }

  on_shot(msg) {
    if (!this._sameGame(msg) || !isCoord(msg.x, msg.y) || !isInt(msg.n)) return;
    const mine = this.myBoard;
    if (this.phase === 'over' && msg.n < mine.shots.length) {
      this._resendResult(msg.n);
      return;
    }
    if (this.phase !== 'battle') return;
    if (msg.n < mine.shots.length) {
      this._resendResult(msg.n);
      return;
    }
    if (msg.n !== mine.shots.length || this.game.turn() !== 1 || mine.shotAt(msg.x, msg.y)) {
      this._sendSync(); // aus dem Takt geraten: Stand abgleichen
      return;
    }
    const res = mine.fire(msg.x, msg.y);
    this.send({ t: 'result', gameId: this.gameId, n: msg.n, ...res });
    this.emit('incoming', res);
    this._checkOver();
  }

  _resendResult(n) {
    const s = this.myBoard.shots[n];
    if (s) this.send({ t: 'result', gameId: this.gameId, n, ...s });
  }

  on_result(msg) {
    if (!this._sameGame(msg) || this.phase !== 'battle') return;
    const p = this.pending;
    if (!p || p.n !== msg.n || p.x !== msg.x || p.y !== msg.y) return;
    if (!RESULTS.has(msg.result)) return;
    const shot = { x: msg.x, y: msg.y, result: msg.result };
    if (msg.result === 'sunk') {
      shot.ship = cleanShip(msg.ship);
      if (!shot.ship) return;
    }
    this.pending = null;
    this.enemyBoard.record(shot);
    this.emit('outcome', shot);
    this._checkOver();
  }

  on_reveal(msg) {
    if (!this._sameGame(msg) || this.phase !== 'over' || this.oppFleet) return;
    const fleet = Array.isArray(msg.fleet) ? msg.fleet.map(cleanShip) : null;
    if (!fleet || fleet.some((s) => !s)) return;
    this.oppFleet = fleet;
    this.revealVerified = verifyReveal(fleet, this.enemyBoard.shots, this.rules);
    this.emit('reveal', { fleet, verified: this.revealVerified });
  }

  on_rematch(msg) {
    if (!this._sameGame(msg) || this.phase !== 'over') return;
    this.rematch.them = true;
    this.emit('rematch', {});
    this._maybeRematch();
  }

  on_bye() {
    this.emit('left', {});
  }
}
