'use strict';

const fs = require('fs');
const { gamePaths } = require('./install');

const NAMES = {
  de_dust2: 'Dust II',
  de_mirage: 'Mirage',
  de_inferno: 'Inferno',
  de_nuke: 'Nuke',
  de_ancient: 'Ancient',
  de_anubis: 'Anubis',
  de_vertigo: 'Vertigo',
  de_overpass: 'Overpass',
  de_train: 'Train',
  cs_office: 'Office',
  cs_italy: 'Italy',
  ar_baggage: 'Baggage',
  ar_shoots: 'Shoots',
  ar_pool_day: 'Pool Day',
};

const TYPES = { de: 'Désamorçage', cs: 'Otages', ar: 'Course aux armements' };

function prettyName(id) {
  if (NAMES[id]) return NAMES[id];
  return id
    .replace(/^[a-z]+_/i, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Liste les maps réellement présentes dans l'installation (fichiers game/csgo/maps/*.vpk). */
function list(serverDir) {
  let ids = [];
  try {
    ids = fs
      .readdirSync(gamePaths(serverDir).maps)
      .filter((f) => f.toLowerCase().endsWith('.vpk'))
      .map((f) => f.slice(0, -4).toLowerCase())
      .filter((id) => /^(de|cs|ar|aim|awp|fy|surf|bhop|kz|mg|dz|gd)_[a-z0-9_]+$/.test(id) && !/_vanity$/.test(id));
  } catch {
    /* pas encore installé */
  }
  const fromInstall = ids.length > 0;
  if (!fromInstall) ids = Object.keys(NAMES);
  return {
    fromInstall,
    maps: [...new Set(ids)].sort().map((id) => ({
      id,
      name: prettyName(id),
      type: TYPES[id.split('_')[0]] || 'Autres',
    })),
  };
}

module.exports = { list };
