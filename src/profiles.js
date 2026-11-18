'use strict';

const path = require('path');
const config = require('./config');
const { getMode } = require('./modes');
const { readJson, writeJson, randomId, cfgString, HttpError } = require('./util');

const FILE = path.join(config.DATA_DIR, 'servers.json');
let profiles = readJson(FILE, []);

function save() {
  writeJson(FILE, profiles);
}

/** Version envoyée au navigateur : sans le mot de passe RCON (géré par le panel). */
function toPublic(p) {
  if (!p) return null;
  const { rconPassword, ...rest } = p;
  return rest;
}

function int(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function pick(input, existing, key, fallback) {
  if (input[key] !== undefined) return input[key];
  if (existing && existing[key] !== undefined) return existing[key];
  return fallback;
}

function normalize(input = {}, existing = null) {
  const mode = getMode(pick(input, existing, 'mode', 'competitive'));
  const modeChanged = existing && existing.mode !== mode.id;

  let workshopId = String(pick(input, existing, 'workshopId', ''));
  const urlId = workshopId.match(/[?&]id=(\d+)/);
  workshopId = (urlId ? urlId[1] : workshopId).replace(/\D/g, '').slice(0, 20);

  const map = String(pick(input, existing, 'map', mode.defaultMap)).trim().toLowerCase();
  if (!workshopId && !/^[a-z0-9_]{1,64}$/.test(map)) throw new HttpError(400, 'Nom de map invalide.');

  const bots = { ...(existing?.bots || {}), ...(input.bots || {}) };

  return {
    name: cfgString(pick(input, existing, 'name', 'Serveur CS2'), 64) || 'Serveur CS2',
    mode: mode.id,
    map,
    workshopId,
    maxPlayers: int(pick(input, existing, 'maxPlayers', mode.maxPlayers), 2, 64, mode.maxPlayers),
    port: int(pick(input, existing, 'port', 27015), 1024, 65535, 27015),
    password: cfgString(pick(input, existing, 'password', ''), 64),
    gslt: String(pick(input, existing, 'gslt', '')).replace(/[^A-Za-z0-9]/g, '').slice(0, 64),
    bots: {
      quota: int(bots.quota, 0, 32, modeChanged ? mode.bots : 0),
      difficulty: int(bots.difficulty, 0, 3, 1),
    },
    extraCvars: String(pick(input, existing, 'extraCvars', '')).slice(0, 20000),
    insecure: Boolean(pick(input, existing, 'insecure', false)),
  };
}

function list() {
  return profiles.map(toPublic);
}

function get(id) {
  return profiles.find((p) => p.id === id) || null;
}

function create(input) {
  const profile = {
    id: randomId(),
    ...normalize(input),
    rconPassword: randomId(12),
    createdAt: Date.now(),
    lastStartedAt: null,
  };
  profiles.push(profile);
  save();
  return toPublic(profile);
}

function update(id, input) {
  const existing = get(id);
  if (!existing) throw new HttpError(404, 'Serveur introuvable.');
  Object.assign(existing, normalize(input, existing), { updatedAt: Date.now() });
  save();
  return toPublic(existing);
}

function remove(id) {
  const before = profiles.length;
  profiles = profiles.filter((p) => p.id !== id);
  if (profiles.length === before) throw new HttpError(404, 'Serveur introuvable.');
  save();
}

function touch(id) {
  const p = get(id);
  if (p) {
    p.lastStartedAt = Date.now();
    save();
  }
}

module.exports = { list, get, create, update, remove, touch, toPublic };
