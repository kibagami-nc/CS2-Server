'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { download, killTree, fmtBytes } = require('./util');
const { isSteamClientInstall } = require('./install');

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const CS2_APP_ID = '730';

const PHASES = {
  downloading: 'Téléchargement',
  'verifying install': 'Vérification',
  'verifying update': 'Vérification',
  preallocating: 'Préallocation',
  committing: 'Écriture des fichiers',
  reconfiguring: 'Configuration',
  staging: 'Préparation',
};

async function ensureSteamCmd(settings, ctx) {
  const exe = path.join(settings.steamcmdDir, 'steamcmd.exe');
  if (fs.existsSync(exe)) return exe;
  ctx.log(`Téléchargement de SteamCMD dans ${settings.steamcmdDir}`);
  ctx.progress(null, 'Téléchargement de SteamCMD…');
  const zip = path.join(settings.steamcmdDir, 'steamcmd.zip');
  await download(STEAMCMD_URL, zip, (r, t) => t && ctx.progress((r / t) * 100, 'Téléchargement de SteamCMD…'));
  new AdmZip(zip).extractAllTo(settings.steamcmdDir, true);
  fs.unlinkSync(zip);
  return exe;
}

function runSteamCmd(exe, args, ctx) {
  return new Promise((resolve) => {
    ctx.log(`> steamcmd ${args.join(' ')}`);
    ctx.progress(null, 'Démarrage de SteamCMD (il se met à jour tout seul au premier lancement, ça peut prendre 1 à 2 minutes)…');
    const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
    ctx.onCancel(() => killTree(child.pid));

    let success = false;
    let error = null;
    let buffer = '';

    const handle = (raw) => {
      const line = raw.trim();
      if (!line) return;
      ctx.log(line);
      const m = line.match(/Update state \(0x[0-9a-f]+\) ([^,]+), progress: ([\d.]+) \((\d+) \/ (\d+)\)/i);
      if (m) {
        const phase = PHASES[m[1].toLowerCase()] || m[1];
        ctx.progress(parseFloat(m[2]), `${phase} — ${fmtBytes(Number(m[3]))} / ${fmtBytes(Number(m[4]))}`);
      } else if (/Success! App '730'/i.test(line)) {
        success = true;
      } else if (/^(ERROR!|Error!)/.test(line) || /App '730' state is 0x[0-9a-f]+ after update job/i.test(line)) {
        error = line;
      } else if (/Checking for available update|Downloading update/i.test(line)) {
        ctx.progress(null, 'Mise à jour de SteamCMD…');
      } else if (/Logging in user|Waiting for user info/i.test(line)) {
        ctx.progress(null, 'Connexion anonyme à Steam…');
      }
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split(/\r?\n|\r/);
      buffer = parts.pop();
      parts.forEach(handle);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ code: -1, success: false, error: e.message }));
    child.on('close', (code) => {
      if (buffer) handle(buffer);
      resolve({ code, success, error });
    });
  });
}

/** Installe ou met à jour le serveur dédié CS2 (app 730, connexion anonyme). */
async function updateCs2(settings, ctx, { validate = false } = {}) {
  if (isSteamClientInstall(settings.serverDir)) {
    throw new Error('Cette installation est gérée par le client Steam : mets CS2 à jour depuis Steam.');
  }
  const exe = await ensureSteamCmd(settings, ctx);
  fs.mkdirSync(settings.serverDir, { recursive: true });

  const args = ['+force_install_dir', settings.serverDir, '+login', 'anonymous', '+app_update', CS2_APP_ID];
  if (validate) args.push('validate');
  args.push('+quit');

  let last = null;
  // Au premier lancement SteamCMD se met à jour lui-même puis s'arrête parfois : on relance.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (ctx.cancelled) throw new Error('Annulé');
    last = await runSteamCmd(exe, args, ctx);
    if (last.success) {
      ctx.log('✔ Counter-Strike 2 est installé et à jour.');
      return;
    }
    if (ctx.cancelled) throw new Error('Annulé');
    ctx.log(`SteamCMD s'est arrêté (code ${last.code}). Tentative ${attempt}/3 terminée.`);
  }
  throw new Error(last?.error || 'SteamCMD n’a pas pu terminer l’installation (voir le journal).');
}

module.exports = { updateCs2, ensureSteamCmd };
