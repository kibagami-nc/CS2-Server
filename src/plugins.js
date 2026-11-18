'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const config = require('./config');
const { gamePaths, isSteamClientInstall } = require('./install');
const { download, readJson, writeJson, isInside, fmtBytes, HttpError } = require('./util');

const META_FILE = path.join(config.DATA_DIR, 'plugins.json');
const MMS_LATEST = 'https://mms.alliedmods.net/mmsdrop/2.0/mmsource-latest-windows';
const MMS_BASE = 'https://mms.alliedmods.net/mmsdrop/2.0/';
const CSS_RELEASE = 'https://api.github.com/repos/roflmuffin/CounterStrikeSharp/releases/latest';
const GAMEINFO_LINE = 'csgo/addons/metamod';

function dirs() {
  const p = gamePaths(config.get().serverDir);
  const addons = path.join(p.csgo, 'addons');
  const css = path.join(addons, 'counterstrikesharp');
  return {
    ...p,
    addons,
    metamod: path.join(addons, 'metamod'),
    css,
    plugins: path.join(css, 'plugins'),
    disabled: path.join(css, 'plugins', 'disabled'),
    admins: path.join(css, 'configs', 'admins.json'),
  };
}

const metamodInstalled = (d) => fs.existsSync(path.join(d.metamod, 'bin', 'win64', 'metamod.2.cs2.dll'));
const cssInstalled = (d) => fs.existsSync(path.join(d.css, 'bin', 'win64', 'counterstrikesharp.dll'));

function ensureAllowed() {
  const { serverDir } = config.get();
  if (isSteamClientInstall(serverDir)) {
    throw new HttpError(
      400,
      'Plugins désactivés sur l’installation du client Steam (risque VAC sur ton compte). Installe le serveur dédié via SteamCMD dans les paramètres.'
    );
  }
  if (!fs.existsSync(gamePaths(serverDir).exe)) throw new HttpError(400, 'Installe d’abord CS2.');
}

function isPatched(file) {
  try {
    return fs.readFileSync(file, 'utf8').includes(GAMEINFO_LINE);
  } catch {
    return false;
  }
}

/** Ajoute / retire la ligne « Game csgo/addons/metamod » dans gameinfo.gi. */
function patchGameinfo(file, enable) {
  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const has = text.includes(GAMEINFO_LINE);

  if (enable && !has) {
    const idx = lines.findIndex((l) => /^\s*Game_LowViolence\s/.test(l));
    if (idx < 0) throw new Error('gameinfo.gi : ligne « Game_LowViolence » introuvable, Metamod ne peut pas être activé.');
    const indent = lines[idx].match(/^\s*/)[0];
    lines.splice(idx + 1, 0, `${indent}Game\t${GAMEINFO_LINE}`);
  } else if (!enable && has) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*Game\s+csgo\/addons\/metamod\s*$/.test(lines[i])) lines.splice(i, 1);
    }
  } else {
    return false;
  }
  if (!fs.existsSync(`${file}.bak`)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, lines.join(eol));
  return true;
}

/**
 * Appelé avant chaque lancement : une mise à jour de CS2 écrase gameinfo.gi,
 * on remet donc Metamod si les plugins sont activés (jamais sur l'install du client Steam).
 */
function applyGameinfo() {
  const s = config.get();
  if (isSteamClientInstall(s.serverDir)) return;
  const d = dirs();
  if (!fs.existsSync(d.gameinfo)) return;
  patchGameinfo(d.gameinfo, Boolean(s.pluginsEnabled && metamodInstalled(d)));
}

function listPlugins(d) {
  const out = [];
  const scan = (dir, enabled) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || (enabled && e.name === 'disabled')) continue;
      let files = [];
      try {
        files = fs.readdirSync(path.join(dir, e.name));
      } catch {
        /* illisible */
      }
      out.push({ name: e.name, enabled, hasDll: files.some((f) => f.toLowerCase().endsWith('.dll')) });
    }
  };
  scan(d.plugins, true);
  scan(d.disabled, false);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function status() {
  const s = config.get();
  const d = dirs();
  const meta = readJson(META_FILE, {});
  const installed = fs.existsSync(d.exe);
  const steamClient = isSteamClientInstall(s.serverDir);
  return {
    installed,
    steamClient,
    allowed: installed && !steamClient,
    enabled: Boolean(s.pluginsEnabled),
    metamod: { installed: metamodInstalled(d), version: meta.metamod?.version || null },
    css: { installed: cssInstalled(d), version: meta.css?.version || null },
    gameinfoPatched: isPatched(d.gameinfo),
    plugins: steamClient ? [] : listPlugins(d),
  };
}

/** Extrait chaque fichier de l'archive en refusant les chemins qui sortiraient du dossier cible. */
function writeEntries(entries, dest, mapName = (n) => n) {
  let count = 0;
  for (const { entry, name } of entries) {
    const rel = mapName(name);
    if (!rel) continue;
    const target = path.resolve(dest, rel);
    if (!isInside(dest, target)) throw new Error(`Chemin refusé dans l’archive : ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    count++;
  }
  return count;
}

function zipFiles(zip) {
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((entry) => ({ entry, name: entry.entryName.replace(/\\/g, '/') }));
}

/** Installe Metamod:Source 2.0 + CounterStrikeSharp (avec runtime .NET) dans game/csgo. */
async function installFramework(ctx) {
  ensureAllowed();
  const d = dirs();
  const tmp = path.join(config.DATA_DIR, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const headers = { 'User-Agent': 'cs2-home-panel' };

  ctx.progress(null, 'Recherche de la dernière version de Metamod:Source…');
  const mmsName = (await (await fetch(MMS_LATEST, { headers })).text()).trim();
  if (!/^mmsource-[\w.-]+-windows\.zip$/.test(mmsName)) throw new Error('Réponse inattendue du site de Metamod:Source.');
  const mmsZip = path.join(tmp, mmsName);
  await download(MMS_BASE + mmsName, mmsZip, (r, t) => t && ctx.progress((r / t) * 25, `Téléchargement de ${mmsName}`));
  ctx.log(`Extraction de ${mmsName}`);
  writeEntries(zipFiles(new AdmZip(mmsZip)), d.csgo);
  fs.rmSync(mmsZip, { force: true });

  ctx.progress(27, 'Recherche de la dernière version de CounterStrikeSharp…');
  const rel = await (await fetch(CSS_RELEASE, { headers: { ...headers, Accept: 'application/vnd.github+json' } })).json();
  const asset = (rel.assets || []).find((a) => /^counterstrikesharp-with-runtime-windows-.*\.zip$/i.test(a.name));
  if (!asset) throw new Error('Archive Windows de CounterStrikeSharp introuvable sur GitHub.');
  const cssZip = path.join(tmp, asset.name);
  await download(asset.browser_download_url, cssZip, (r, t) =>
    ctx.progress(27 + (t ? (r / t) * 65 : 0), `Téléchargement de ${asset.name} (${fmtBytes(r)})`)
  );
  ctx.progress(93, 'Extraction de CounterStrikeSharp…');
  ctx.log(`Extraction de ${asset.name}`);
  writeEntries(zipFiles(new AdmZip(cssZip)), d.csgo);
  fs.rmSync(cssZip, { force: true });

  const now = Date.now();
  writeJson(META_FILE, {
    ...readJson(META_FILE, {}),
    metamod: { version: mmsName.replace(/^mmsource-|-windows\.zip$/g, ''), installedAt: now },
    css: { version: rel.tag_name, installedAt: now },
  });
  config.update({ pluginsEnabled: true });
  applyGameinfo();
  ctx.log('✔ Metamod:Source et CounterStrikeSharp sont installés. Ils seront chargés au prochain lancement.');
}

/**
 * Installe un plugin CounterStrikeSharp depuis un .zip, quelle que soit sa structure :
 *  - « addons/… » (+ éventuellement « cfg/… »)  -> extrait dans game/csgo
 *  - « counterstrikesharp/… »                   -> extrait dans game/csgo/addons
 *  - « plugins/MonPlugin/… »                    -> extrait dans addons/counterstrikesharp
 *  - « MonPlugin/MonPlugin.dll » ou fichiers à la racine -> extrait dans plugins/
 */
function installPluginZip(buffer, originalName = 'plugin.zip') {
  ensureAllowed();
  const d = dirs();
  if (!cssInstalled(d)) throw new HttpError(400, 'Installe d’abord CounterStrikeSharp.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, 'Aucun fichier reçu.');

  let entries;
  try {
    entries = zipFiles(new AdmZip(buffer));
  } catch {
    throw new HttpError(400, 'Archive .zip invalide.');
  }
  if (!entries.length) throw new HttpError(400, 'L’archive est vide.');
  if (!entries.some((e) => e.name.toLowerCase().endsWith('.dll'))) {
    throw new HttpError(400, 'Aucune DLL dans l’archive : ce n’est probablement pas un plugin CounterStrikeSharp.');
  }

  const anchor = (re) => {
    const hit = entries.find((e) => re.test(e.name));
    if (!hit) return null;
    const m = re.exec(hit.name);
    return hit.name.slice(0, m.index + (m[0].startsWith('/') ? 1 : 0));
  };
  const strip = (prefix) => (name) => (name.startsWith(prefix) ? name.slice(prefix.length) : null);

  let prefix;
  let written;
  if ((prefix = anchor(/(^|\/)addons\//)) !== null) {
    written = writeEntries(entries, d.csgo, strip(prefix));
  } else if ((prefix = anchor(/(^|\/)counterstrikesharp\//)) !== null) {
    written = writeEntries(entries, d.addons, strip(prefix));
  } else if ((prefix = anchor(/(^|\/)plugins\//)) !== null) {
    written = writeEntries(entries, d.css, strip(prefix));
  } else {
    const tops = new Set(entries.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')));
    if (tops.size === 1 && !tops.has('')) {
      written = writeEntries(entries, d.plugins);
    } else {
      // CounterStrikeSharp charge plugins/<Nom>/<Nom>.dll : le dossier doit porter le nom de la DLL principale.
      const dlls = entries
        .filter((e) => !e.name.includes('/') && e.name.toLowerCase().endsWith('.dll'))
        .map((e) => e.name.slice(0, -4));
      const zipBase = path
        .basename(originalName, path.extname(originalName))
        .replace(/[-_ ]?v?\d+(\.\d+)*$/i, '')
        .toLowerCase();
      const folder = (
        dlls.find((n) => n.toLowerCase() === zipBase) ||
        (dlls.length === 1 ? dlls[0] : null) ||
        dlls.find((n) => zipBase.includes(n.toLowerCase())) ||
        zipBase ||
        'plugin'
      ).replace(/[^\w.-]/g, '');
      written = writeEntries(entries, d.plugins, (n) => `${folder}/${n}`);
    }
  }
  return { files: written, plugins: listPlugins(d) };
}

function safePluginName(name) {
  if (!/^[\w.\- ]{1,80}$/.test(name || '') || name === 'disabled' || name.includes('..')) {
    throw new HttpError(400, 'Nom de plugin invalide.');
  }
  return name;
}

function togglePlugin(name, enabled) {
  ensureAllowed();
  const d = dirs();
  safePluginName(name);
  const on = path.join(d.plugins, name);
  const off = path.join(d.disabled, name);
  const [from, to] = enabled ? [off, on] : [on, off];
  if (!fs.existsSync(from)) throw new HttpError(404, 'Plugin introuvable.');
  if (fs.existsSync(to)) throw new HttpError(409, 'Un plugin du même nom existe déjà.');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function deletePlugin(name) {
  ensureAllowed();
  const d = dirs();
  safePluginName(name);
  for (const dir of [path.join(d.plugins, name), path.join(d.disabled, name)]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
  }
  throw new HttpError(404, 'Plugin introuvable.');
}

/** Admins CounterStrikeSharp (configs/admins.json). */
function getAdmins() {
  const data = readJson(dirs().admins, {});
  return Object.entries(data).map(([name, v]) => ({ name, steamId: String(v.identity || ''), flags: v.flags || [] }));
}

function setAdmins(list) {
  ensureAllowed();
  if (!Array.isArray(list)) throw new HttpError(400, 'Liste invalide.');
  const out = {};
  for (const a of list) {
    const steamId = String(a.steamId || '').trim();
    if (!/^7656\d{13}$/.test(steamId)) throw new HttpError(400, `SteamID64 invalide : « ${steamId} » (17 chiffres, commence par 7656).`);
    const name = String(a.name || steamId).replace(/[^\w .-]/g, '').trim().slice(0, 32) || steamId;
    out[name] = { identity: steamId, flags: Array.isArray(a.flags) && a.flags.length ? a.flags : ['@css/root'] };
  }
  writeJson(dirs().admins, out);
  return getAdmins();
}

module.exports = {
  status,
  applyGameinfo,
  installFramework,
  installPluginZip,
  togglePlugin,
  deletePlugin,
  getAdmins,
  setAdmins,
};
