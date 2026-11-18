'use strict';

const os = require('os');

let publicCache = { ip: null, at: 0 };

function isPrivate(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

function lanIps() {
  const out = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ iface, address: a.address, private: isPrivate(a.address) });
    }
  }
  // Les interfaces virtuelles (VirtualBox, WSL, VPN…) passent après les cartes physiques.
  const virtual = /virtual|vethernet|vmware|vbox|wsl|hyper-v|tailscale|zerotier|radmin|hamachi/i;
  return out.sort((a, b) => virtual.test(a.iface) - virtual.test(b.iface) || b.private - a.private);
}

async function publicIp() {
  if (publicCache.ip && Date.now() - publicCache.at < 10 * 60 * 1000) return publicCache.ip;
  const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
  const { ip } = await res.json();
  publicCache = { ip, at: Date.now() };
  return ip;
}

async function info(withPublic) {
  const result = { lan: lanIps(), public: null };
  if (withPublic) {
    try {
      result.public = await publicIp();
    } catch {
      result.publicError = 'Impossible de récupérer l’IP publique (pas d’accès Internet ?).';
    }
  }
  return result;
}

module.exports = { info };
