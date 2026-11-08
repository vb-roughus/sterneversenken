// Transport zwischen zwei Geräten.
//
// AndroidTransport: Google Nearby Connections über die native App (Bluetooth/WLAN direkt,
//                   ohne Server und ohne Internet).
// SimTransport:     zwei Browser-Tabs auf demselben Rechner (index.html?sim=1), zum Testen.
//
// Ereignisse: advertising, discovering, found {id,name}, lost {id},
//             connecting {id,name,code}, connected {id,name}, connect-failed {message,kind},
//             disconnected, message {text}, error {message,kind,code}, hint {message,kind}, resumed

import { Emitter } from './emitter.js';
import { bridge, callNative, nativeEvents } from './native.js';

const NET_EVENTS = [
  'advertising',
  'discovering',
  'found',
  'lost',
  'connecting',
  'connected',
  'connect-failed',
  'disconnected',
  'message',
  'error',
  'hint',
  'resumed',
];

class AndroidTransport extends Emitter {
  constructor() {
    super();
    this.kind = 'nearby';
    for (const type of NET_EVENTS) nativeEvents.on(type, (data) => this.emit(type, data));
  }

  get available() {
    return callNative('nearbyAvailable', [], false);
  }

  host(name) {
    callNative('startHosting', [name]);
  }

  discover(name) {
    callNative('startDiscovery', [name]);
  }

  connect(id) {
    callNative('connect', [id]);
  }

  send(obj) {
    callNative('send', [JSON.stringify(obj)]);
  }

  stop() {
    callNative('stop');
  }

  openSettings(kind) {
    callNative('openSettings', [kind]);
  }
}

class SimTransport extends Emitter {
  constructor() {
    super();
    this.kind = 'sim';
    this.available = true;
    this.id = Math.random().toString(36).slice(2, 8);
    this.channel = new BroadcastChannel('sterneversenken-sim');
    this.channel.onmessage = (e) => this._onMessage(e.data);
    this.mode = null;
    this.peer = null;
    this.seen = new Set();
    window.__simDrop = () => this._drop();
  }

  _post(msg) {
    this.channel.postMessage({ ...msg, from: this.id });
  }

  host(name) {
    this.stop();
    this.mode = 'host';
    this.name = name;
    this.emit('advertising', {});
    this._post({ k: 'adv', name });
  }

  discover(name) {
    this.stop();
    this.mode = 'discover';
    this.name = name;
    this.seen.clear();
    this.emit('discovering', {});
    this._post({ k: 'probe' });
  }

  connect(id) {
    this.mode = 'connecting';
    this._post({ k: 'req', to: id, name: this.name });
    this.emit('connecting', { id, name: '', code: '0000' });
  }

  send(obj) {
    if (this.peer) this._post({ k: 'msg', to: this.peer.id, text: JSON.stringify(obj) });
  }

  stop() {
    if (this.peer) this._post({ k: 'bye', to: this.peer.id });
    this.peer = null;
    this.mode = null;
  }

  openSettings() {}

  _drop() {
    if (!this.peer) return;
    this._post({ k: 'bye', to: this.peer.id });
    this.peer = null;
    this.mode = null;
    this.emit('disconnected', {});
  }

  _onMessage(m) {
    if (m.to && m.to !== this.id) return;
    switch (m.k) {
      case 'adv':
        if (this.mode === 'discover' && !this.seen.has(m.from)) {
          this.seen.add(m.from);
          this.emit('found', { id: m.from, name: m.name });
        }
        break;
      case 'probe':
        if (this.mode === 'host' && !this.peer) this._post({ k: 'adv', name: this.name });
        break;
      case 'req':
        if (this.mode === 'host' && !this.peer) {
          this.peer = { id: m.from, name: m.name };
          this.mode = 'connected';
          this._post({ k: 'acc', to: m.from, name: this.name });
          this.emit('connecting', { id: m.from, name: m.name, code: '0000' });
          setTimeout(() => this.emit('connected', { id: m.from, name: m.name }), 150);
        }
        break;
      case 'acc':
        if (this.mode === 'connecting') {
          this.peer = { id: m.from, name: m.name };
          this.mode = 'connected';
          setTimeout(() => this.emit('connected', { id: m.from, name: m.name }), 150);
        }
        break;
      case 'msg':
        if (this.peer && m.from === this.peer.id) this.emit('message', { text: m.text });
        break;
      case 'bye':
        if (this.peer && m.from === this.peer.id) {
          this.peer = null;
          this.mode = null;
          this.emit('disconnected', {});
        }
        break;
      default:
    }
  }
}

let transport;

/** Liefert den Transport oder null, wenn auf diesem Gerät kein Netzwerkspiel möglich ist. */
export function getTransport() {
  if (transport !== undefined) return transport;
  if (bridge) transport = new AndroidTransport();
  else if (new URLSearchParams(location.search).has('sim') && 'BroadcastChannel' in window) transport = new SimTransport();
  else transport = null;
  return transport;
}
