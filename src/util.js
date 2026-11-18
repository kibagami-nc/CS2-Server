'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Écriture atomique (fichier temporaire puis renommage). */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function randomId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Retire ce qui permettrait d'injecter des commandes dans un .cfg (guillemets, ;, retours ligne). */
function cfgString(value, max = 128) {
  return String(value ?? '')
    .replace(/["\r\n;]/g, '')
    .trim()
    .slice(0, max);
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Nom de l'exécutable d'un PID (Windows), ou null s'il n'existe pas. */
async function processName(pid) {
  try {
    const { stdout } = await execFileP('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const m = stdout.match(/^"([^"]+)","(\d+)"/m);
    return m && Number(m[2]) === Number(pid) ? m[1] : null;
  } catch {
    return null;
  }
}

async function killTree(pid) {
  if (!pid) return;
  try {
    await execFileP('taskkill', ['/PID', String(pid), '/T', '/F']);
  } catch {
    /* déjà terminé */
  }
}

/** Télécharge une URL vers un fichier, avec suivi de progression. */
async function download(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': 'cs2-home-panel' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (onProgress) onProgress(received, total);
      cb(null, chunk);
    },
  });
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest));
  return dest;
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Vérifie qu'un chemin résolu reste bien dans un dossier (anti « zip slip »). */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  readJson,
  writeJson,
  randomId,
  cfgString,
  execFileP,
  isPidAlive,
  processName,
  killTree,
  download,
  fmtBytes,
  isInside,
  HttpError,
};
