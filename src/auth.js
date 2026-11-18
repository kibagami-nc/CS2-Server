'use strict';

const crypto = require('crypto');
const path = require('path');
const config = require('./config');
const { readJson, writeJson } = require('./util');

const COOKIE = 'cs2panel_sid';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 jours
const SESSIONS_FILE = path.join(config.DATA_DIR, 'sessions.json');
const attempts = new Map(); // ip -> { count, until }

// Sessions conservées sur disque (empreinte SHA-256 du jeton -> expiration) :
// redémarrer le panel ne déconnecte pas le navigateur.
const sessions = new Map(Object.entries(readJson(SESSIONS_FILE, {})).filter(([, exp]) => exp > Date.now()));
const digest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const persistSessions = () => writeJson(SESSIONS_FILE, Object.fromEntries(sessions));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(password) {
  const auth = config.get().auth;
  if (!auth) return false;
  const { hash } = hashPassword(password, auth.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(auth.hash, 'hex'));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isValidToken(token) {
  if (!token) return false;
  const key = digest(token);
  const exp = sessions.get(key);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(key);
    persistSessions();
    return false;
  }
  return true;
}

function isAuthenticated(req) {
  return isValidToken(parseCookies(req.headers.cookie)[COOKIE]);
}

function openSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(digest(token), Date.now() + SESSION_TTL);
  persistSessions();
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`
  );
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('Le mot de passe doit faire au moins 6 caractères.');
  }
}

/** Limite les essais de connexion : 8 échecs -> blocage 2 minutes. */
function throttle(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    throw new Error('Trop de tentatives, réessaie dans quelques minutes.');
  }
}

function recordFailure(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 8) {
    a.until = Date.now() + 2 * 60 * 1000;
    a.count = 0;
  }
  attempts.set(ip, a);
}

function routes(app) {
  const send = (res, fn) => {
    try {
      res.json(fn() ?? { ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };

  app.get('/api/auth/status', (req, res) => {
    res.json({ setupRequired: !config.get().auth, authenticated: isAuthenticated(req) });
  });

  app.post('/api/auth/setup', (req, res) =>
    send(res, () => {
      if (config.get().auth) throw new Error('Le mot de passe est déjà configuré.');
      validatePassword(req.body?.password);
      config.update({ auth: hashPassword(req.body.password) });
      openSession(res);
    })
  );

  app.post('/api/auth/login', (req, res) =>
    send(res, () => {
      throttle(req.ip);
      if (!checkPassword(String(req.body?.password ?? ''))) {
        recordFailure(req.ip);
        throw new Error('Mot de passe incorrect.');
      }
      attempts.delete(req.ip);
      openSession(res);
    })
  );

  app.post('/api/auth/logout', (req, res) => {
    sessions.delete(digest(parseCookies(req.headers.cookie)[COOKIE]));
    persistSessions();
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.post('/api/auth/password', (req, res) =>
    send(res, () => {
      if (!isAuthenticated(req)) throw new Error('Non connecté.');
      if (!checkPassword(String(req.body?.current ?? ''))) throw new Error('Mot de passe actuel incorrect.');
      validatePassword(req.body?.password);
      config.update({ auth: hashPassword(req.body.password) });
      sessions.clear();
      openSession(res);
    })
  );
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Authentification requise.' });
}

function socketAuth(socket, next) {
  const token = parseCookies(socket.handshake.headers.cookie)[COOKIE];
  if (isValidToken(token)) return next();
  next(new Error('unauthorized'));
}

module.exports = { routes, requireAuth, socketAuth };
