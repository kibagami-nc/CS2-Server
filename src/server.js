'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const auth = require('./auth');
const profiles = require('./profiles');
const install = require('./install');
const jobs = require('./jobs');
const steamcmd = require('./steamcmd');
const manager = require('./servermanager');
const plugins = require('./plugins');
const maps = require('./maps');
const network = require('./network');
const { MODES } = require('./modes');
const { HttpError } = require('./util');

const MIN_FREE_BYTES = 72e9;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(config.ROOT, 'public')));

auth.routes(app);
app.use('/api', auth.requireAuth);

/** Enveloppe une route : renvoie le résultat en JSON, ou { error } avec le bon code HTTP. */
const route = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json(data ?? { ok: true });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    res.status(e.status || 400).json({ error: e.message });
  }
};

const broadcastProfiles = () => io.emit('profiles', profiles.list());
const broadcastSettings = () => io.emit('settings', config.publicSettings());
const broadcastPlugins = () => io.emit('plugins', plugins.status());

function assertServerStopped(what) {
  if (manager.isActive()) throw new HttpError(409, `Arrête le serveur avant ${what}.`);
}

// ---------- état global ----------

app.get(
  '/api/state',
  route(async () => ({
    settings: config.publicSettings(),
    install: await install.info(config.get()),
    server: manager.getState(),
    profiles: profiles.list(),
    modes: MODES,
    job: jobs.snapshot(),
    plugins: plugins.status(),
  }))
);

app.get('/api/maps', route(() => maps.list(config.get().serverDir)));
app.get('/api/network', route((req) => network.info(req.query.public === '1')));

// ---------- serveurs (profils) ----------

app.get('/api/profiles', route(() => profiles.list()));

app.post(
  '/api/profiles',
  route((req) => {
    const p = profiles.create(req.body || {});
    broadcastProfiles();
    return p;
  })
);

app.put(
  '/api/profiles/:id',
  route((req) => {
    const p = profiles.update(req.params.id, req.body || {});
    broadcastProfiles();
    manager.emitState();
    return p;
  })
);

app.delete(
  '/api/profiles/:id',
  route((req) => {
    if (manager.isActive() && manager.profileId === req.params.id) {
      throw new HttpError(409, 'Ce serveur est en cours d’exécution : arrête-le d’abord.');
    }
    profiles.remove(req.params.id);
    broadcastProfiles();
  })
);

// ---------- serveur en cours ----------

app.post(
  '/api/server/start',
  route(async (req) => {
    if (jobs.current) throw new HttpError(409, `Attends la fin de la tâche en cours : ${jobs.current.label}.`);
    const state = await manager.start(String(req.body?.profileId || ''));
    broadcastProfiles();
    return state;
  })
);
app.post('/api/server/stop', route(() => manager.stop()));
app.post('/api/server/restart', route(() => manager.restart()));
app.post('/api/server/rcon', route(async (req) => ({ output: await manager.rcon(req.body?.command) })));
app.post('/api/server/action', route((req) => manager.action(req.body || {})));
app.get('/api/server/players', route(() => manager.players()));
app.get('/api/server/console', route(() => ({ lines: manager.getLog() })));

// ---------- installation ----------

app.get('/api/install', route(() => install.info(config.get())));
app.get('/api/install/detect', route(() => install.detectSteamInstalls()));

app.post(
  '/api/install/update',
  route(async () => {
    assertServerStopped('de mettre à jour CS2');
    const info = await install.info(config.get());
    // SteamCMD réserve toute la place d'un coup (≈ 67 Go en novembre 2026) : on vérifie avant de commencer.
    if (!info.installed && info.freeBytes != null && info.freeBytes < MIN_FREE_BYTES) {
      throw new HttpError(
        400,
        `Pas assez d’espace libre : il faut environ 70 Go sur le disque de ${config.get().serverDir}, il en reste ${(info.freeBytes / 1e9).toFixed(1)}. Choisis un autre dossier dans les paramètres.`
      );
    }
    return jobs.start('install', 'Installation / mise à jour de CS2', (ctx) =>
      steamcmd.updateCs2(config.get(), ctx, { validate: false })
    );
  })
);

app.post(
  '/api/install/validate',
  route(() => {
    assertServerStopped('de vérifier les fichiers');
    return jobs.start('install', 'Vérification des fichiers de CS2', (ctx) =>
      steamcmd.updateCs2(config.get(), ctx, { validate: true })
    );
  })
);

app.post('/api/jobs/cancel', route(() => ({ cancelled: jobs.cancel() })));

// ---------- réglages ----------

app.put(
  '/api/settings',
  route(async (req) => {
    const body = req.body || {};
    const patch = {};
    for (const key of ['serverDir', 'steamcmdDir']) {
      if (body[key] === undefined) continue;
      const value = String(body[key]).trim();
      if (!path.isAbsolute(value) || !/^[A-Za-z]:\\/.test(path.normalize(value))) {
        throw new HttpError(400, 'Le chemin doit être absolu, par exemple D:\\CS2Server\\cs2');
      }
      patch[key] = path.normalize(value).replace(/[\\/]+$/, '');
    }
    if (patch.serverDir && patch.serverDir !== config.get().serverDir) {
      assertServerStopped('de changer de dossier d’installation');
      if (jobs.current) throw new HttpError(409, 'Une tâche est en cours.');
    }
    for (const key of ['showConsoleWindow', 'autoRestart', 'pluginsEnabled']) {
      if (body[key] !== undefined) patch[key] = Boolean(body[key]);
    }
    if (body.defaultGslt !== undefined) patch.defaultGslt = String(body.defaultGslt).replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
    if (body.panelPort !== undefined) {
      const port = Number(body.panelPort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new HttpError(400, 'Port du panel invalide.');
      patch.panelPort = port;
    }
    if (body.panelHost !== undefined) {
      if (!['127.0.0.1', '0.0.0.0'].includes(body.panelHost)) throw new HttpError(400, 'Adresse d’écoute invalide.');
      patch.panelHost = body.panelHost;
    }
    config.update(patch);
    if (patch.pluginsEnabled !== undefined && !manager.isActive()) plugins.applyGameinfo();
    broadcastSettings();
    broadcastPlugins();
    if (patch.serverDir || patch.steamcmdDir) io.emit('install', await install.info(config.get()));
    return config.publicSettings();
  })
);

// ---------- plugins ----------

app.get('/api/plugins', route(() => plugins.status()));

app.post(
  '/api/plugins/framework',
  route(() => {
    assertServerStopped('d’installer Metamod / CounterStrikeSharp');
    return jobs.start('plugins', 'Installation de Metamod + CounterStrikeSharp', (ctx) => plugins.installFramework(ctx));
  })
);

app.post(
  '/api/plugins/upload',
  express.raw({ type: () => true, limit: '200mb' }),
  route((req) => {
    const result = plugins.installPluginZip(req.body, String(req.query.name || 'plugin.zip'));
    broadcastPlugins();
    return result;
  })
);

app.post(
  '/api/plugins/:name/toggle',
  route((req) => {
    plugins.togglePlugin(req.params.name, Boolean(req.body?.enabled));
    broadcastPlugins();
  })
);

app.delete(
  '/api/plugins/:name',
  route((req) => {
    plugins.deletePlugin(req.params.name);
    broadcastPlugins();
  })
);

app.get('/api/plugins/admins', route(() => plugins.getAdmins()));
app.put('/api/plugins/admins', route((req) => plugins.setAdmins(req.body?.admins)));

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// Corps de requête invalide (JSON mal formé, fichier trop gros…) : réponse JSON plutôt qu'une page HTML.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const tooLarge = err.type === 'entity.too.large';
  res.status(err.status || 400).json({ error: tooLarge ? 'Fichier trop volumineux.' : 'Requête invalide.' });
});

// ---------- temps réel ----------

io.use(auth.socketAuth);
io.on('connection', (socket) => {
  socket.emit('server:state', manager.getState());
  socket.emit('job', jobs.snapshot());
});

manager.on('state', (state) => io.emit('server:state', state));
manager.on('lines', (lines) => io.emit('console:lines', lines));
jobs.on('update', (job) => io.emit('job', job));
jobs.on('log', (line) => io.emit('job:log', line));
jobs.on('finished', async () => {
  io.emit('install', await install.info(config.get()));
  broadcastPlugins();
});

// ---------- démarrage ----------

const { panelHost, panelPort } = config.get();
const host = process.env.PANEL_HOST || panelHost;
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = Number(portArg?.slice('--port='.length)) || Number(process.env.PANEL_PORT) || panelPort;

httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${port} est déjà utilisé : le panel tourne peut-être déjà ? (http://localhost:${port})\n`);
  } else console.error(e);
  process.exit(1);
});

httpServer.listen(port, host, async () => {
  const url = `http://localhost:${port}`;
  console.log('');
  console.log('  ==========================================');
  console.log('    CS2 Home Panel est prêt');
  console.log('  ==========================================');
  console.log(`  → Ouvre ${url} dans ton navigateur`);
  if (host === '0.0.0.0') {
    for (const ip of (await network.info(false)).lan) console.log(`  → Réseau local : http://${ip.address}:${port}`);
  }
  console.log('  (Ctrl+C pour fermer le panel — le serveur CS2 continue de tourner)\n');
  await manager.attach().catch((e) => console.error('Reprise du serveur impossible :', e.message));
  if (process.argv.includes('--open')) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
});

process.on('SIGINT', () => {
  console.log('\n  Panel fermé. Le serveur CS2 éventuellement lancé continue de tourner.');
  process.exit(0);
});
