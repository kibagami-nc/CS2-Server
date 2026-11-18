'use strict';

const net = require('net');

// Protocole Source RCON : https://developer.valvesoftware.com/wiki/Source_RCON_Protocol
const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH_RESPONSE = 2;

class Rcon {
  constructor({ host = '127.0.0.1', port, password, timeout = 4000 }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeout = timeout;
    this.socket = null;
    this.authed = false;
    this.connecting = null;
    this.buf = Buffer.alloc(0);
    this.id = 10;
    this.pending = null;
    this.queue = Promise.resolve();
  }

  nextId() {
    this.id = this.id >= 0x7ffffff0 ? 10 : this.id + 1;
    return this.id;
  }

  send(id, type, body) {
    const payload = Buffer.from(body, 'utf8');
    const pkt = Buffer.alloc(14 + payload.length);
    pkt.writeInt32LE(10 + payload.length, 0);
    pkt.writeInt32LE(id, 4);
    pkt.writeInt32LE(type, 8);
    payload.copy(pkt, 12);
    this.socket.write(pkt);
  }

  connect() {
    if (this.socket && this.authed) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      this.socket = socket;
      this.buf = Buffer.alloc(0);
      let settled = false;

      const fail = (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.close();
      };
      const timer = setTimeout(() => fail(new Error('délai de connexion dépassé')), this.timeout);

      this.onAuth = (ok) => {
        clearTimeout(timer);
        if (!ok) return fail(new Error('mot de passe RCON refusé'));
        this.authed = true;
        settled = true;
        resolve();
      };

      socket.once('connect', () => this.send(this.nextId(), SERVERDATA_AUTH, this.password));
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('error', (err) => fail(err));
      socket.on('close', () => {
        if (!settled) fail(new Error('connexion fermée'));
        this.authed = false;
        this.socket = null;
        if (this.pending) this.pending.fail(new Error('connexion RCON fermée'));
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const size = this.buf.readInt32LE(0);
      if (size < 10 || size > 4 * 1024 * 1024) {
        this.buf = Buffer.alloc(0);
        return;
      }
      if (this.buf.length < 4 + size) return;
      const id = this.buf.readInt32LE(4);
      const type = this.buf.readInt32LE(8);
      const body = this.buf.toString('utf8', 12, 4 + size - 2);
      this.buf = this.buf.subarray(4 + size);
      this.onPacket(id, type, body);
    }
  }

  onPacket(id, type, body) {
    if (!this.authed) {
      // Le serveur envoie un paquet vide puis AUTH_RESPONSE (id -1 = refusé).
      if (type === SERVERDATA_AUTH_RESPONSE && this.onAuth) this.onAuth(id !== -1);
      return;
    }
    const p = this.pending;
    if (p && id === p.id) p.push(body);
  }

  /** Exécute une commande. Les réponses sont mises en file pour ne pas se mélanger. */
  exec(command) {
    const run = () => this._exec(command);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async _exec(command) {
    await this.connect();
    return new Promise((resolve, reject) => {
      const chunks = [];
      let idle = null;
      const done = (err) => {
        clearTimeout(idle);
        clearTimeout(hard);
        if (this.pending === p) this.pending = null;
        if (err) reject(err);
        else resolve(chunks.join(''));
      };
      const p = {
        id: this.nextId(),
        push: (body) => {
          chunks.push(body);
          clearTimeout(idle);
          // Une réponse longue arrive en plusieurs paquets : on attend un court silence.
          idle = setTimeout(() => done(), 250);
        },
        fail: (err) => done(err),
      };
      // Certaines commandes ne renvoient rien : on rend la main après le délai.
      const hard = setTimeout(() => done(), this.timeout);
      this.pending = p;
      try {
        this.send(p.id, SERVERDATA_EXECCOMMAND, command);
      } catch (e) {
        done(e);
      }
    });
  }

  close() {
    this.authed = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

module.exports = { Rcon };
