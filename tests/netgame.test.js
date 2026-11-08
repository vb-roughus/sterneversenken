import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomFleet, SIZE } from '../web/js/engine.js';
import { NetSession } from '../web/js/netgame.js';

/** Zwei Sitzungen über eine simulierte, geordnete Verbindung, die man kappen kann. */
function pair({ rules, seed = 1 } = {}) {
  const rng = makeRng(seed);
  const queue = [];
  const link = { up: true, dropped: 0 };
  const mk = (role, name) =>
    new NetSession({
      role,
      name,
      rules,
      rng,
      send: (msg) => {
        const target = role === 'host' ? guest : host;
        if (link.up) queue.push(() => target.receive(JSON.stringify(msg)));
        else link.dropped++;
      },
    });
  const host = mk('host', 'Ada');
  const guest = mk('guest', 'Bob');
  const flush = (limit = 10000) => {
    let n = 0;
    while (queue.length && n++ < limit) queue.shift()();
  };
  const connect = () => {
    link.up = true;
    host.connected();
    guest.connected();
    flush();
  };
  const cut = () => {
    link.up = false;
    queue.length = 0;
  };
  return { host, guest, flush, connect, cut, link, rng };
}

function shooter(rng) {
  const order = [];
  for (let i = 0; i < SIZE * SIZE; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return (session) => {
    while (order.length) {
      const k = order[0];
      const x = k % SIZE;
      const y = Math.floor(k / SIZE);
      if (session.enemyBoard.shotAt(x, y)) {
        order.shift();
        continue;
      }
      return { x, y };
    }
    return null;
  };
}

function assertMirrored(host, guest) {
  assert.deepEqual(host.enemyBoard.shots, guest.myBoard.shots);
  assert.deepEqual(guest.enemyBoard.shots, host.myBoard.shots);
  const ht = host.game.turn();
  const gt = guest.game.turn();
  if (ht === null) assert.equal(gt, null);
  else assert.equal(ht, 1 - gt, 'beide Geräte müssen sich über den Zug einig sein');
}

function placeBoth(p) {
  p.host.placeFleet(randomFleet(p.host.rules, p.rng));
  p.guest.placeFleet(randomFleet(p.guest.rules, p.rng));
  p.flush();
}

function playOut(p, { onStep } = {}) {
  const next = { host: shooter(p.rng), guest: shooter(p.rng) };
  let steps = 0;
  while (p.host.phase === 'battle' || p.guest.phase === 'battle') {
    steps++;
    assert.ok(steps < 500, 'Partie endet nicht');
    const s = p.host.isMyTurn() ? p.host : p.guest.isMyTurn() ? p.guest : null;
    assert.ok(s, 'niemand ist am Zug');
    const target = next[s.role](s);
    assert.ok(s.fire(target.x, target.y));
    assert.equal(s.isMyTurn(), false, 'während ein Schuss unterwegs ist, kein zweiter');
    if (onStep && onStep(steps) === 'skip-flush') continue;
    p.flush();
    assertMirrored(p.host, p.guest);
  }
}

test('Verbindungsaufbau: Host legt Regeln und Startspieler fest', () => {
  const p = pair({ rules: { bonusShot: false, allowTouch: true } });
  const names = [];
  p.guest.on('opponent', (e) => names.push(e.name));
  p.connect();
  assert.deepEqual(names, ['Ada']);
  assert.equal(p.host.opponentName, 'Bob');
  assert.equal(p.host.phase, 'placing');
  assert.equal(p.guest.phase, 'placing');
  assert.equal(p.host.gameId, p.guest.gameId);
  assert.deepEqual(p.guest.rules, { bonusShot: false, allowTouch: true });
  assert.equal(p.host.game.first, 1 - p.guest.game.first);
});

test('Schlacht beginnt erst, wenn beide bereit sind', () => {
  const p = pair();
  p.connect();
  p.host.placeFleet(randomFleet(p.host.rules, p.rng));
  p.flush();
  assert.equal(p.host.phase, 'placing');
  assert.equal(p.guest.oppReady, true);
  assert.equal(p.guest.placeFleet([{ id: 'flagship', x: 0, y: 0, dir: 'h' }]), false, 'unvollständige Flotte');
  p.guest.placeFleet(randomFleet(p.guest.rules, p.rng));
  p.flush();
  assert.equal(p.host.phase, 'battle');
  assert.equal(p.guest.phase, 'battle');
});

for (const bonusShot of [true, false]) {
  test(`Ganze Partie über das Protokoll (Bonusschuss ${bonusShot ? 'an' : 'aus'})`, () => {
    for (let seed = 1; seed <= 15; seed++) {
      const p = pair({ rules: { bonusShot, allowTouch: false }, seed });
      const overs = [];
      p.host.on('over', (e) => overs.push(['host', e.winner]));
      p.guest.on('over', (e) => overs.push(['guest', e.winner]));
      const reveals = [];
      p.host.on('reveal', (e) => reveals.push(e.verified));
      p.guest.on('reveal', (e) => reveals.push(e.verified));
      p.connect();
      placeBoth(p);
      playOut(p);
      assert.equal(p.host.phase, 'over');
      assert.equal(p.guest.phase, 'over');
      assert.equal(overs.length, 2);
      const hostWon = overs.find((o) => o[0] === 'host')[1] === 0;
      const guestWon = overs.find((o) => o[0] === 'guest')[1] === 0;
      assert.notEqual(hostWon, guestWon, 'genau ein Sieger');
      assert.deepEqual(reveals, [true, true], 'beide Flotten werden offengelegt und passen');
    }
  });
}

test('Ungültige oder doppelte Nachrichten bringen das Spiel nicht durcheinander', () => {
  const p = pair({ seed: 4 });
  p.connect();
  placeBoth(p);
  const [att, def] = p.host.isMyTurn() ? [p.host, p.guest] : [p.guest, p.host];
  // Schuss ausser der Reihe: der Gegner des Angreifers ist gar nicht am Zug
  att.receive({ t: 'shot', gameId: att.gameId, n: 0, x: 0, y: 0 });
  assert.equal(att.myBoard.shots.length, 0);
  def.receive('kein json');
  def.receive({ t: 'shot', gameId: 'falsch', n: 0, x: 1, y: 1 });
  def.receive({ t: 'shot', gameId: def.gameId, n: 0, x: 99, y: 1 });
  p.flush();
  assert.equal(def.myBoard.shots.length, 0);
  assert.ok(att.fire(3, 3));
  p.flush();
  assertMirrored(p.host, p.guest);
  // Derselbe Schuss nochmals (z.B. doppelt zugestellt) wird nicht doppelt gezählt
  const before = def.myBoard.shots.length;
  def.receive({ t: 'shot', gameId: def.gameId, n: 0, x: 3, y: 3 });
  p.flush();
  assert.equal(def.myBoard.shots.length, before);
  assertMirrored(p.host, p.guest);
});

test('Verbindungsabbruch mitten im Schuss: nach dem Wiederverbinden geht es korrekt weiter', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const p = pair({ seed });
    p.connect();
    placeBoth(p);
    let cuts = 0;
    playOut(p, {
      onStep: (step) => {
        if (step % 7 !== 0) return undefined;
        cuts++;
        // Variante A: Schuss geht verloren. Variante B: Schuss kommt an, Antwort geht verloren.
        if (step % 2) {
          p.cut();
        } else {
          p.flush(1); // nur den Schuss zustellen
          p.cut();
        }
        p.connect();
        assertMirrored(p.host, p.guest);
        return 'skip-flush';
      },
    });
    assert.ok(cuts > 0);
    assert.equal(p.host.phase, 'over');
    assert.equal(p.guest.phase, 'over');
    assert.notEqual(p.host.game.winner(), p.guest.game.winner());
  }
});

test('Abbruch genau beim letzten Treffer: beide erfahren das Spielende', () => {
  const p = pair({ seed: 11 });
  p.connect();
  placeBoth(p);
  const next = { host: shooter(p.rng), guest: shooter(p.rng) };
  for (let i = 0; i < 1000; i++) {
    const s = p.host.isMyTurn() ? p.host : p.guest;
    const other = s === p.host ? p.guest : p.host;
    const { x, y } = next[s.role](s);
    const lethal =
      other.myBoard.fleet && other.myBoard.resolve(x, y).result === 'sunk' && other.myBoard.sunkShips().length === 4;
    s.fire(x, y);
    if (lethal) {
      p.flush(1); // Verteidiger verarbeitet den Schuss, Antwort geht verloren
      p.cut();
      assert.equal(other.phase, 'over');
      assert.equal(s.phase, 'battle');
      p.connect();
      assert.equal(s.phase, 'over');
      assert.equal(s.game.winner(), 0);
      assert.equal(other.game.winner(), 1);
      return;
    }
    p.flush();
  }
  assert.fail('kein Spielende erreicht');
});

test('Revanche: neue Partie, Verlierer beginnt, Spielstand zählt weiter', () => {
  const p = pair({ seed: 21 });
  p.connect();
  placeBoth(p);
  playOut(p);
  const firstId = p.host.gameId;
  const hostWon = p.host.lastWinner === 0;
  p.guest.requestRematch();
  p.flush();
  assert.equal(p.host.phase, 'over', 'Host hat noch nicht zugestimmt');
  p.host.requestRematch();
  p.flush();
  assert.equal(p.host.phase, 'placing');
  assert.equal(p.guest.phase, 'placing');
  assert.notEqual(p.host.gameId, firstId);
  assert.equal(p.host.gameId, p.guest.gameId);
  assert.equal(p.host.game.first, hostWon ? 1 : 0, 'Verlierer beginnt');
  assert.deepEqual(p.host.score, hostWon ? [1, 0] : [0, 1]);
  assert.deepEqual(p.guest.score, hostWon ? [0, 1] : [1, 0]);
});

test('Falsch gemeldete Treffer fallen beim Offenlegen auf', () => {
  // Ohne Bonusschuss, damit die Lüge den Zugwechsel nicht beeinflusst.
  const p = pair({ seed: 5, rules: { bonusShot: false, allowTouch: false } });
  p.connect();
  placeBoth(p);
  // Der Gast meldet seinen ersten Treffer als Wasser.
  let lies = 0;
  const honestSend = p.guest.send;
  p.guest.send = (msg) => {
    if (msg.t === 'result' && msg.result === 'hit' && lies === 0) {
      lies++;
      return honestSend({ ...msg, result: 'miss' });
    }
    return honestSend(msg);
  };
  const verdicts = { host: [], guest: [] };
  p.host.on('reveal', (e) => verdicts.host.push(e.verified));
  p.guest.on('reveal', (e) => verdicts.guest.push(e.verified));
  // Beide schiessen stur Zeile für Zeile.
  for (let i = 0; i < 1000 && (p.host.phase === 'battle' || p.guest.phase === 'battle'); i++) {
    const s = p.host.isMyTurn() ? p.host : p.guest.isMyTurn() ? p.guest : null;
    if (!s) {
      p.flush();
      continue;
    }
    let k = 0;
    while (s.enemyBoard.shotAt(k % SIZE, Math.floor(k / SIZE))) k++;
    s.fire(k % SIZE, Math.floor(k / SIZE));
    p.flush();
  }
  assert.equal(lies, 1);
  assert.equal(p.host.phase, 'over');
  assert.equal(p.guest.phase, 'over');
  assert.deepEqual(verdicts.host, [false], 'Host bemerkt die falsche Meldung');
  assert.deepEqual(verdicts.guest, [true], 'Host hat ehrlich gespielt');
});
