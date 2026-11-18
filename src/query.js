'use strict';

const dgram = require('dgram');

// Requête A2S_INFO : https://developer.valvesoftware.com/wiki/Server_queries
const A2S_INFO = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from('Source Engine Query\0', 'latin1'),
]);

function parseInfo(buf) {
  let o = 6; // en-tête (4) + type (1) + protocole (1)
  const str = () => {
    const end = buf.indexOf(0, o);
    const s = buf.toString('utf8', o, end);
    o = end + 1;
    return s;
  };
  const name = str();
  const map = str();
  const folder = str();
  const game = str();
  o += 2; // app id
  const players = buf[o++];
  const maxPlayers = buf[o++];
  const bots = buf[o++];
  o += 2; // type de serveur + OS
  const visibility = buf[o++];
  const vac = buf[o++];
  const version = o < buf.length ? str() : '';
  return { name, map, folder, game, players, maxPlayers, bots, passworded: visibility === 1, vac: vac === 1, version };
}

function a2sInfo(host, port, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let finished = false;
    const done = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sock.close();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => done(new Error('pas de réponse')), timeout);
    sock.on('error', (err) => done(err));
    sock.on('message', (msg) => {
      if (msg.length < 5) return;
      if (msg[4] === 0x41) {
        // Challenge : on renvoie la requête avec les 4 octets reçus.
        sock.send(Buffer.concat([A2S_INFO, msg.subarray(5, 9)]), port, host);
      } else if (msg[4] === 0x49) {
        try {
          done(null, parseInfo(msg));
        } catch (e) {
          done(e);
        }
      }
    });
    sock.send(A2S_INFO, port, host);
  });
}

function isUdpPortFree(port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', () => resolve(false));
    sock.bind({ port, address: '0.0.0.0', exclusive: true }, () => sock.close(() => resolve(true)));
  });
}

module.exports = { a2sInfo, isUdpPortFree };
