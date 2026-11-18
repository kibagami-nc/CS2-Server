'use strict';

const fs = require('fs');
const path = require('path');
const { execFileP } = require('./util');

function gamePaths(serverDir) {
  const game = path.join(serverDir, 'game');
  const csgo = path.join(game, 'csgo');
  return {
    game,
    csgo,
    exe: path.join(game, 'bin', 'win64', 'cs2.exe'),
    cfg: path.join(csgo, 'cfg'),
    maps: path.join(csgo, 'maps'),
    consoleLog: path.join(csgo, 'console.log'),
    gameinfo: path.join(csgo, 'gameinfo.gi'),
  };
}

/** Installation du client Steam (…\steamapps\common\…) : pas de mise à jour SteamCMD ni de plugins. */
function isSteamClientInstall(serverDir) {
  return /[\\/]steamapps[\\/]common[\\/]/i.test(serverDir || '');
}

function readBuildId(serverDir) {
  const candidates = [
    path.join(serverDir, 'steamapps', 'appmanifest_730.acf'),
    path.join(serverDir, '..', '..', 'appmanifest_730.acf'),
  ];
  for (const file of candidates) {
    try {
      const m = fs.readFileSync(file, 'utf8').match(/"buildid"\s+"(\d+)"/);
      if (m) return m[1];
    } catch {
      /* fichier absent */
    }
  }
  return null;
}

async function diskFree(dir) {
  let p = path.resolve(dir || 'C:\\');
  while (!fs.existsSync(p)) {
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  try {
    const s = await fs.promises.statfs(p);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

async function info(settings) {
  const p = gamePaths(settings.serverDir);
  return {
    installed: fs.existsSync(p.exe),
    serverDir: settings.serverDir,
    exe: p.exe,
    buildId: readBuildId(settings.serverDir),
    steamClient: isSteamClientInstall(settings.serverDir),
    steamcmdInstalled: fs.existsSync(path.join(settings.steamcmdDir, 'steamcmd.exe')),
    freeBytes: await diskFree(settings.serverDir),
  };
}

/** Cherche les installations de CS2 faites par le client Steam (registre + libraryfolders.vdf). */
async function detectSteamInstalls() {
  const roots = new Set();
  for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
    for (const value of ['SteamPath', 'InstallPath']) {
      try {
        const { stdout } = await execFileP('reg', ['query', key, '/v', value]);
        const m = stdout.match(new RegExp(`${value}\\s+REG_SZ\\s+(.+)`));
        if (m) roots.add(path.normalize(m[1].trim()));
      } catch {
        /* clé absente */
      }
    }
  }
  roots.add('C:\\Program Files (x86)\\Steam');

  const libraries = new Set();
  for (const root of roots) {
    libraries.add(root);
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
    } catch {
      /* pas de bibliothèque ici */
    }
  }

  const found = [];
  for (const lib of libraries) {
    const dir = path.join(lib, 'steamapps', 'common', 'Counter-Strike Global Offensive');
    if (fs.existsSync(gamePaths(dir).exe) && !found.some((f) => f.serverDir.toLowerCase() === dir.toLowerCase())) {
      found.push({ serverDir: dir, buildId: readBuildId(dir) });
    }
  }
  return found;
}

module.exports = { gamePaths, isSteamClientInstall, info, detectSteamInstalls, diskFree };
