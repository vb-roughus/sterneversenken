// Spielregeln ohne DOM: Flotten, Platzierung, Schüsse, Zugreihenfolge.
// Wird von der Oberfläche, der KI, dem Netzwerkprotokoll und den Tests genutzt.

export const SIZE = 10;

// Die Flotte. Namen und Grössen lassen sich hier zentral anpassen.
export const FLEET = [
  { id: 'flagship', name: 'Flaggschiff', size: 5 },
  { id: 'cruiser', name: 'Schlachtkreuzer', size: 4 },
  { id: 'frigate', name: 'Fregatte', size: 3 },
  { id: 'corvette', name: 'Korvette', size: 3 },
  { id: 'fighters', name: 'Jägerstaffel', size: 2 },
];

export const DEFAULT_RULES = Object.freeze({
  bonusShot: true, // Nach einem Treffer darf nochmals geschossen werden.
  allowTouch: false, // Schiffe dürfen sich (auch diagonal) berühren.
});

export const COLS = 'ABCDEFGHIJ';
export const coordLabel = (x, y) => `${COLS[x]}${y + 1}`;

export function shipDef(id) {
  return FLEET.find((s) => s.id === id);
}

export function normalizeRules(rules) {
  return {
    bonusShot: rules?.bonusShot ?? DEFAULT_RULES.bonusShot,
    allowTouch: rules?.allowTouch ?? DEFAULT_RULES.allowTouch,
  };
}

/** Zellen eines platzierten Schiffs: {id, x, y, dir: 'h'|'v'} */
export function cellsOf(ship) {
  const size = ship.size ?? shipDef(ship.id).size;
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(ship.dir === 'h' ? { x: ship.x + i, y: ship.y } : { x: ship.x, y: ship.y + i });
  }
  return cells;
}

export const inBounds = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/** Kann `ship` zu den Schiffen `others` hinzugefügt werden? */
export function canPlace(others, ship, rules = DEFAULT_RULES) {
  const cells = cellsOf(ship);
  if (!cells.every((c) => inBounds(c.x, c.y))) return false;
  const reach = rules.allowTouch ? 0 : 1;
  for (const other of others) {
    if (other.id === ship.id) continue;
    for (const a of cellsOf(other)) {
      for (const b of cells) {
        if (Math.abs(a.x - b.x) <= reach && Math.abs(a.y - b.y) <= reach) return false;
      }
    }
  }
  return true;
}

/** Vollständige, gültige Flotte? */
export function validateFleet(ships, rules = DEFAULT_RULES) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
  const ids = new Set(ships.map((s) => s.id));
  if (ids.size !== FLEET.length || !FLEET.every((d) => ids.has(d.id))) return false;
  for (const s of ships) {
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y) || (s.dir !== 'h' && s.dir !== 'v')) return false;
  }
  return ships.every((s, i) => canPlace(ships.slice(0, i), s, rules));
}

/** Zufallszahlen 0..1; deterministisch, wenn ein Seed übergeben wird (für Tests). */
export function makeRng(seed) {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomFleet(rules = DEFAULT_RULES, rng = Math.random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ships = [];
    let ok = true;
    for (const def of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const dir = rng() < 0.5 ? 'h' : 'v';
        const maxX = dir === 'h' ? SIZE - def.size : SIZE - 1;
        const maxY = dir === 'v' ? SIZE - def.size : SIZE - 1;
        const ship = {
          id: def.id,
          x: Math.floor(rng() * (maxX + 1)),
          y: Math.floor(rng() * (maxY + 1)),
          dir,
        };
        if (canPlace(ships, ship, rules)) {
          ships.push(ship);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ships;
  }
  throw new Error('Keine gültige Flotte gefunden');
}

/**
 * Ein Spielfeld aus Sicht eines Spielers.
 * `fleet` ist bekannt (eigenes Feld, Hot-Seat, KI) oder null (gegnerisches Feld im Netzwerkspiel).
 * `shots` sind die eingegangenen Schüsse in Reihenfolge: {x, y, result: 'miss'|'hit'|'sunk', ship?}
 */
export class Board {
  constructor(fleet = null) {
    this.fleet = fleet ? fleet.map((s) => ({ ...s })) : null;
    this.shots = [];
  }

  shotAt(x, y) {
    return this.shots.find((s) => s.x === x && s.y === y) || null;
  }

  shipAt(x, y) {
    if (!this.fleet) return null;
    return this.fleet.find((s) => cellsOf(s).some((c) => c.x === x && c.y === y)) || null;
  }

  /** Versenkte Schiffe (mit Position). */
  sunkShips() {
    return this.shots.filter((s) => s.result === 'sunk' && s.ship).map((s) => s.ship);
  }

  isSunk(shipId) {
    return this.shots.some((s) => s.result === 'sunk' && s.ship?.id === shipId);
  }

  allSunk() {
    return this.sunkShips().length >= FLEET.length;
  }

  /** Ergebnis eines Schusses bestimmen (nur mit bekannter Flotte), ohne ihn einzutragen. */
  resolve(x, y) {
    if (!this.fleet) throw new Error('Flotte unbekannt');
    if (!inBounds(x, y)) throw new Error('Ausserhalb des Feldes');
    const prior = this.shotAt(x, y);
    if (prior) return { ...prior, repeat: true };
    const ship = this.shipAt(x, y);
    if (!ship) return { x, y, result: 'miss' };
    const hitCells = cellsOf(ship).filter(
      (c) => (c.x === x && c.y === y) || this.shots.some((s) => s.x === c.x && s.y === c.y),
    );
    if (hitCells.length === cellsOf(ship).length) {
      return { x, y, result: 'sunk', ship: { ...ship } };
    }
    return { x, y, result: 'hit' };
  }

  /** Schuss eintragen. */
  record(shot) {
    if (this.shotAt(shot.x, shot.y)) return false;
    const entry = { x: shot.x, y: shot.y, result: shot.result };
    if (shot.ship) entry.ship = { id: shot.ship.id, x: shot.ship.x, y: shot.ship.y, dir: shot.ship.dir };
    this.shots.push(entry);
    return true;
  }

  /** Schuss auf bekannte Flotte auflösen und eintragen. */
  fire(x, y) {
    const res = this.resolve(x, y);
    if (!res.repeat) this.record(res);
    return res;
  }

  /** Zellen, die nach den Regeln sicher leer sind (um versenkte Schiffe herum). */
  blockedAround(rules) {
    const out = new Set();
    if (rules.allowTouch) return out;
    for (const ship of this.sunkShips()) {
      for (const c of cellsOf(ship)) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const x = c.x + dx;
            const y = c.y + dy;
            if (inBounds(x, y)) out.add(y * SIZE + x);
          }
        }
      }
    }
    return out;
  }
}

/**
 * Wer ist am Zug? Wird aus dem Schussverlauf neu berechnet, damit beide Geräte
 * (auch nach einem Verbindungsabbruch) eindeutig zum selben Ergebnis kommen.
 * shotsBy[p] = Schüsse, die Spieler p abgegeben hat (in Reihenfolge).
 * Rückgabe: 0 | 1, oder null, wenn das Spiel vorbei ist.
 */
export function turnFromHistory(first, shotsBy, rules, over = false) {
  if (over) return null;
  let cur = first;
  const idx = [0, 0];
  const total = shotsBy[0].length + shotsBy[1].length;
  for (let step = 0; step <= total; step++) {
    const list = shotsBy[cur];
    if (idx[cur] >= list.length) return cur;
    const shot = list[idx[cur]++];
    if (!(rules.bonusShot && shot.result !== 'miss')) cur = 1 - cur;
  }
  return cur;
}

/**
 * Eine Partie. boards[p] ist das Feld von Spieler p (darauf schiesst der Gegner).
 */
export class Game {
  constructor({ rules = DEFAULT_RULES, first = 0, boards }) {
    this.rules = normalizeRules(rules);
    this.first = first;
    this.boards = boards;
  }

  shotsBy(p) {
    return this.boards[1 - p].shots;
  }

  winner() {
    if (this.boards[1].allSunk()) return 0;
    if (this.boards[0].allSunk()) return 1;
    return null;
  }

  isOver() {
    return this.winner() !== null;
  }

  turn() {
    return turnFromHistory(this.first, [this.shotsBy(0), this.shotsBy(1)], this.rules, this.isOver());
  }

  canFire(p, x, y) {
    return this.turn() === p && inBounds(x, y) && !this.boards[1 - p].shotAt(x, y);
  }

  /** Lokal auflösbarer Schuss (Hot-Seat / KI). */
  fire(p, x, y) {
    if (!this.canFire(p, x, y)) throw new Error('Ungültiger Schuss');
    return this.boards[1 - p].fire(x, y);
  }

  stats(p) {
    const shots = this.shotsBy(p);
    const hits = shots.filter((s) => s.result !== 'miss').length;
    return {
      shots: shots.length,
      hits,
      accuracy: shots.length ? Math.round((hits / shots.length) * 100) : 0,
      sunk: shots.filter((s) => s.result === 'sunk').length,
    };
  }
}

/**
 * Prüft, ob eine nach Spielende offengelegte Flotte zu den gemeldeten Ergebnissen passt.
 * So fällt auf, wenn ein Gerät falsche Treffer gemeldet hätte.
 */
export function verifyReveal(fleet, shots, rules) {
  if (!validateFleet(fleet, rules)) return false;
  const check = new Board(fleet);
  for (const s of shots) {
    const res = check.fire(s.x, s.y);
    if (res.result !== s.result) return false;
    if (res.result === 'sunk' && s.ship && res.ship.id !== s.ship.id) return false;
  }
  return true;
}
