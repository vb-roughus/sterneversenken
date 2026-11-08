// Verbindung zur Android-App. Im Browser ist `bridge` null.

import { Emitter } from './emitter.js';

export const bridge = window.AndroidBridge || null;
export const nativeEvents = new Emitter();

// Die App ruft window.__nativeEvent(type, data) auf (siehe NearbyBridge.kt).
window.__nativeEvent = (type, data) => nativeEvents.emit(type, data || {});

/** Methode der Android-Brücke aufrufen; im Browser oder bei Fehlern `fallback`. */
export function callNative(method, args = [], fallback = undefined) {
  if (!bridge || typeof bridge[method] !== 'function') return fallback;
  try {
    return bridge[method](...args);
  } catch (err) {
    console.error(`AndroidBridge.${method}`, err);
    return fallback;
  }
}
