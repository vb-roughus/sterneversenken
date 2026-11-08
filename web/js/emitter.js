export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }

  emit(type, data) {
    for (const fn of [...(this._handlers.get(type) || [])]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`Fehler im Handler für "${type}"`, err);
      }
    }
  }
}
