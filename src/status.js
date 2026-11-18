'use strict';

/**
 * Analyse la sortie de la commande `status` de CS2.
 *   ---------players--------
 *     id     time ping loss      state   rate adr name
 *      1      BOT    0    0     active      0 'Rezan'
 *      2    03:22   21    0     active 786432 192.168.1.10:27005 'Manley'
 *   #end
 */
function parseStatus(text) {
  const players = [];
  let hostname = null;
  let map = null;
  let publicAddress = null;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^hostname\s*:\s*(.*)$/))) {
      hostname = m[1];
    } else if ((m = line.match(/^udp\/ip\s*:.*\(public ([\d.]+):\d+\)/))) {
      publicAddress = m[1];
    } else if ((m = line.match(/\[\d+:\s*([A-Za-z0-9_]+)\s*\|\s*main lump/))) {
      map = m[1];
    } else if ((m = line.match(/^\s*(\d+)\s+(.+?)\s+'(.*)'$/))) {
      const userid = Number(m[1]);
      if (userid === 65535) continue; // emplacement réservé, pas un joueur
      const cols = m[2].trim().split(/\s+/);
      const bot = cols[0] === 'BOT';
      const addr = m[2].match(/(\d{1,3}(?:\.\d{1,3}){3}:\d+)/);
      players.push({
        userid,
        name: m[3],
        bot,
        time: bot ? null : cols[0],
        ping: Number(cols[1]) || 0,
        loss: Number(cols[2]) || 0,
        state: cols[3] || '',
        address: addr ? addr[1] : null,
      });
    }
  }
  return { hostname, map, publicAddress, players };
}

module.exports = { parseStatus };
