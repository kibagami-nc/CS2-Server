'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./util');

const ROOT = path.resolve(__dirname, '..');
// --data-dir=… (ou PANEL_DATA_DIR) permet de séparer plusieurs configurations du panel.
const dataArg = process.argv.find((a) => a.startsWith('--data-dir='));
const DATA_DIR = path.resolve(dataArg ? dataArg.slice('--data-dir='.length) : process.env.PANEL_DATA_DIR || path.join(ROOT, 'data'));
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

/** Le serveur CS2 pèse ~70 Go : on le met par défaut sur D: s'il existe, hors du dossier du projet. */
function defaultBaseDir() {
  try {
    if (fs.statSync('D:\\').isDirectory()) return 'D:\\CS2Server';
  } catch {
    /* pas de lecteur D: */
  }
  return 'C:\\CS2Server';
}

function defaults() {
  const base = defaultBaseDir();
  return {
    panelHost: '127.0.0.1',
    panelPort: 8420,
    serverDir: path.join(base, 'cs2'),
    steamcmdDir: path.join(base, 'steamcmd'),
    showConsoleWindow: false,
    autoRestart: true,
    defaultGslt: '',
    pluginsEnabled: true,
    auth: null,
  };
}

let settings = { ...defaults(), ...readJson(SETTINGS_FILE, {}) };
if (!fs.existsSync(SETTINGS_FILE)) writeJson(SETTINGS_FILE, settings);

function get() {
  return settings;
}

function update(patch) {
  settings = { ...settings, ...patch };
  writeJson(SETTINGS_FILE, settings);
  return settings;
}

/** Réglages envoyés au navigateur (sans le hash du mot de passe). */
function publicSettings() {
  const { auth, ...rest } = settings;
  return rest;
}

module.exports = { ROOT, DATA_DIR, get, update, publicSettings };
