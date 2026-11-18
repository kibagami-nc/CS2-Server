'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');
const config = require('./config');
const profiles = require('./profiles');
const plugins = require('./plugins');
const { getMode, GAMEMODE_SERVER_CFGS } = require('./modes');
const { gamePaths } = require('./install');
const { Rcon } = require('./rcon');
const { a2sInfo, isUdpPortFree } = require('./query');
const { parseStatus } = require('./status');
const { cfgString, isPidAlive, processName, killTree, readJson, writeJson, execFileP, HttpError } = require('./util');

const RUNTIME_FILE = path.join(config.DATA_DIR, 'runtime.json');
const PANEL_CFG = 'cs2panel';
const LOG_MAX = 3000;
// Lignes sans intérêt : interrogations RCON du panel lui-même et bruit de la console Windows.
const NOISE = /GetNumberOfConsoleInputEvents|rcon from .*?: command "status"|UNEXPECTED LONG FRAME DETECTED/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lance cs2.exe via Start-Process (ShellExecute) : CS2 crée alors sa propre console Windows
 * (masquée ou réduite). Lancé directement depuis Node avec des stdio redirigés, CS2 n'a pas de
 * vraie console d'entrée et inonde son journal d'erreurs « GetNumberOfConsoleInputEvents ».
 * Le processus est indépendant du panel : il survit à sa fermeture.
 */
async function launchProcess(exe, args, { show }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  // CS2 ouvre sa console lui-même (visible) : on la masque, ou on la réduit, dès qu'elle apparaît.
  const script = [
    `$p = Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(path.dirname(exe))} -ArgumentList ${q(args.join(' '))} -PassThru`,
    `Add-Type -Name Win -Namespace Cs2Panel -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);'`,
    `for ($i = 0; $i -lt 60 -and $p.MainWindowHandle -eq 0 -and -not $p.HasExited; $i++) { Start-Sleep -Milliseconds 200; $p.Refresh() }`,
    `if ($p.MainWindowHandle -ne 0) { [void][Cs2Panel.Win]::ShowWindow($p.MainWindowHandle, ${show ? 7 : 0}) }`,
    '$p.Id',
  ].join('; ');
  const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const pid = Number(stdout.trim().split(/\s+/).pop());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('PID du processus introuvable');
  return pid;
}

/** Adresse sur laquelle un processus écoute un port TCP (lu dans netstat). */
async function listeningTcpHost(pid, port) {
  try {
    const { stdout } = await execFileP('netstat', ['-ano', '-p', 'tcp']);
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+\S+\s+(\d+)$/i);
      if (m && Number(m[2]) === Number(port) && Number(m[3]) === Number(pid)) {
        return m[1] === '0.0.0.0' ? '127.0.0.1' : m[1];
      }
    }
  } catch {
    /* netstat indisponible */
  }
  return null;
}

/** Lit en continu le console.log écrit par CS2 (option -condebug). */
class LogTail {
  constructor(file, onLines) {
    this.file = file;
    this.onLines = onLines;
    this.offset = 0;
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
    this.timer = null;
    this.reading = false;
    this.skipFirst = false;
  }

  start(backlogBytes = 0) {
    try {
      const size = fs.statSync(this.file).size;
      this.offset = Math.max(0, size - backlogBytes);
      this.skipFirst = this.offset > 0; // on démarre au milieu d'une ligne
    } catch {
      this.offset = 0;
    }
    this.timer = setInterval(() => this.poll(), 400);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    if (this.reading) return;
    this.reading = true;
    try {
      const st = await fsp.stat(this.file).catch(() => null);
      if (!st || st.size === this.offset) return;
      if (st.size < this.offset) {
        this.offset = 0;
        this.partial = '';
      }
      const len = Math.min(st.size - this.offset, 1024 * 1024);
      const fh = await fsp.open(this.file, 'r');
      try {
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, this.offset);
        this.offset += bytesRead;
        const parts = (this.partial + this.decoder.write(buf.subarray(0, bytesRead))).split(/\r?\n/);
        this.partial = parts.pop();
        if (this.skipFirst) {
          parts.shift();
          this.skipFirst = false;
        }
        if (parts.length) this.onLines(parts);
      } finally {
        await fh.close();
      }
    } catch {
      /* fichier verrouillé ou supprimé : on réessaie au prochain tour */
    } finally {
      this.reading = false;
    }
  }
}

function buildCfg(profile) {
  const mode = getMode(profile.mode);
  const lines = [
    '// Généré par CS2 Home Panel — régénéré à chaque lancement, ne pas modifier à la main.',
    `hostname "${cfgString(profile.name, 64)}"`,
    `sv_password "${cfgString(profile.password, 64)}"`,
    `rcon_password "${profile.rconPassword}"`,
    'sv_lan 0',
    '',
    `// Mode : ${mode.label}`,
    ...mode.config,
    '',
    '// Bots',
  ];
  if (profile.bots.quota > 0) {
    lines.push('bot_quota_mode fill', `bot_quota ${profile.bots.quota}`, `bot_difficulty ${profile.bots.difficulty}`);
  } else {
    lines.push('bot_quota 0', 'bot_kick');
  }
  const extra = String(profile.extraCvars || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (extra.length) lines.push('', '// Cvars personnalisées', ...extra);
  return `${lines.join('\n')}\n`;
}

function buildArgs(profile, settings) {
  const mode = getMode(profile.mode);
  const args = ['-dedicated', '-usercon', '-condebug', '-port', String(profile.port), '-maxplayers', String(profile.maxPlayers)];
  if (profile.insecure) args.push('-insecure');
  args.push('+game_type', String(mode.gameType), '+game_mode', String(mode.gameMode));
  if (mode.skirmishId) args.push('+sv_skirmish_id', String(mode.skirmishId));
  const gslt = profile.gslt || settings.defaultGslt;
  if (gslt) args.push('+sv_setsteamaccount', gslt);
  args.push('+exec', PANEL_CFG);
  if (profile.workshopId) args.push('+host_workshop_map', profile.workshopId);
  else args.push('+map', profile.map);
  return args;
}

class ServerManager extends EventEmitter {
  constructor() {
    super();
    this.status = 'stopped'; // stopped | starting | running | stopping | crashed
    this.profileId = null;
    this.pid = null;
    this.port = null;
    this.rconPassword = null;
    this.startedAt = null;
    this.info = null;
    this.lastError = null;
    this.paths = null;
    this.log = [];
    this.pending = [];
    this.flushTimer = null;
    this.tail = null;
    this.rconClient = null;
    this.pollTimer = null;
    this.aliveTimer = null;
    this.restartTimer = null;
    this.stopping = false;
    this.crashes = [];
    this.lastStateJson = '';
    this.hiddenStatusBlocks = 0;
    this.inHiddenStatus = false;
    this.publicAddress = null;
  }

  // ---------- état ----------

  getState() {
    const profile = this.profileId ? profiles.toPublic(profiles.get(this.profileId)) : null;
    return {
      status: this.status,
      profileId: this.profileId,
      profile,
      pid: this.pid,
      port: this.port,
      startedAt: this.startedAt,
      info: this.info,
      publicAddress: this.publicAddress,
      lastError: this.lastError,
    };
  }

  isActive() {
    return ['starting', 'running', 'stopping'].includes(this.status);
  }

  emitState(force = true) {
    const state = this.getState();
    const json = JSON.stringify(state);
    if (!force && json === this.lastStateJson) return;
    this.lastStateJson = json;
    this.emit('state', state);
  }

  setStatus(status, error) {
    this.status = status;
    if (error !== undefined) this.lastError = error;
    this.emitState();
  }

  // ---------- console ----------

  pushLines(lines) {
    const clean = lines
      .map((l) =>
        l
          .replace(/^\uFEFF/, '')
          .replace(/\u001b\[[0-9;]*m/g, '')
          .replace(/^\d\d\/\d\d (\d\d:\d\d:\d\d) /, '$1 ') // « 11/18 19:23:55 » -> « 19:23:55 »
          .replace(/\s+$/, '')
      )
      .filter((l) => {
        if (!l.trim() || NOISE.test(l)) return false;
        // Bloc « status » demandé par le panel (liste des joueurs) : on ne l'affiche pas.
        if (this.inHiddenStatus) {
          if (/#end\s*$/.test(l)) this.inHiddenStatus = false;
          return false;
        }
        if (this.hiddenStatusBlocks > 0 && /\bServer:\s+Running \[/.test(l)) {
          this.hiddenStatusBlocks -= 1;
          this.inHiddenStatus = true;
          return false;
        }
        return true;
      });
    if (!clean.length) return;
    this.log.push(...clean);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.pending.push(...clean);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.pending;
        this.pending = [];
        this.emit('lines', batch);
      }, 120);
    }
  }

  panelLine(text) {
    this.pushLines([`[panel] ${text}`]);
  }

  getLog() {
    return this.log;
  }

  // ---------- cfg ----------

  writeConfigs(profile, p) {
    fs.mkdirSync(p.cfg, { recursive: true });
    fs.writeFileSync(path.join(p.cfg, `${PANEL_CFG}.cfg`), buildCfg(profile));
    // Les cfg de mode (gamemode_competitive.cfg…) passent après notre +exec : on se réaccroche derrière eux.
    for (const name of GAMEMODE_SERVER_CFGS) {
      const file = path.join(p.cfg, `gamemode_${name}_server.cfg`);
      let content = '';
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        /* n'existe pas encore */
      }
      if (!new RegExp(`^\\s*exec\\s+"?${PANEL_CFG}`, 'm').test(content)) {
        const sep = content && !content.endsWith('\n') ? '\n' : '';
        fs.writeFileSync(file, `${content}${sep}// Ajouté par CS2 Home Panel\nexec ${PANEL_CFG}\n`);
      }
    }
  }

  /** Une fois le serveur arrêté, notre cfg est vidé pour ne pas affecter les parties hors panel. */
  writeStubCfg() {
    if (!this.paths) return;
    try {
      fs.writeFileSync(path.join(this.paths.cfg, `${PANEL_CFG}.cfg`), '// CS2 Home Panel : aucun serveur actif.\n');
    } catch {
      /* dossier introuvable */
    }
  }

  // ---------- cycle de vie ----------

  async start(profileId) {
    if (this.isActive()) throw new HttpError(409, 'Un serveur tourne déjà : arrête-le avant d’en lancer un autre.');
    const profile = profiles.get(profileId);
    if (!profile) throw new HttpError(404, 'Serveur introuvable.');
    const settings = config.get();
    const p = gamePaths(settings.serverDir);
    if (!fs.existsSync(p.exe)) throw new HttpError(400, 'CS2 n’est pas installé : va dans Paramètres pour l’installer.');
    if (!(await isUdpPortFree(profile.port))) {
      throw new HttpError(409, `Le port ${profile.port} est déjà utilisé (un autre serveur ou CS2 lui-même ?).`);
    }

    clearTimeout(this.restartTimer);
    this.paths = p;
    this.writeConfigs(profile, p);
    plugins.applyGameinfo();
    try {
      fs.unlinkSync(p.consoleLog);
    } catch {
      /* absent */
    }

    const args = buildArgs(profile, settings);
    const shown = args.map((a, i) => (args[i - 1] === '+sv_setsteamaccount' ? '********' : a));
    this.log = [];
    this.info = null;
    this.lastError = null;
    this.stopping = false;
    this.hiddenStatusBlocks = 0;
    this.inHiddenStatus = false;
    this.panelLine(`Lancement de « ${profile.name} » : cs2.exe ${shown.join(' ')}`);

    let pid;
    try {
      pid = await launchProcess(p.exe, args, { show: settings.showConsoleWindow });
    } catch (e) {
      throw new HttpError(500, `Impossible de lancer cs2.exe : ${e.message}`);
    }

    this.pid = pid;
    this.profileId = profile.id;
    this.port = profile.port;
    this.startedAt = Date.now();

    writeJson(RUNTIME_FILE, { pid: this.pid, profileId: this.profileId, port: this.port, startedAt: this.startedAt });
    profiles.touch(profile.id);
    this.setStatus('starting');
    this.startMonitoring(profile, 0);
    return this.getState();
  }

  startMonitoring(profile, backlogBytes) {
    this.stopMonitoring();
    this.rconPassword = profile.rconPassword;
    this.tail = new LogTail(this.paths.consoleLog, (lines) => this.pushLines(lines));
    this.tail.start(backlogBytes);
    this.pollTimer = setInterval(() => this.poll(), 3000);
    this.poll();
    // Le processus est indépendant du panel : on surveille son PID pour détecter l'arrêt.
    this.aliveTimer = setInterval(() => {
      if (!isPidAlive(this.pid)) this.onExit(null, this.pid);
    }, 2000);
  }

  /**
   * CS2 n'écoute pas forcément RCON (TCP) sur 127.0.0.1 mais sur l'IP locale principale :
   * on lit l'adresse réellement utilisée par le processus avec netstat.
   */
  async getRcon() {
    if (this.rconClient) return this.rconClient;
    if (!this.pid || !this.port) throw new Error('serveur non lancé');
    // Une seule découverte à la fois : deux appels simultanés ouvriraient deux connexions RCON.
    if (!this.rconPending) {
      this.rconPending = listeningTcpHost(this.pid, this.port)
        .then((host) => {
          this.rconClient = new Rcon({ host: host || '127.0.0.1', port: this.port, password: this.rconPassword });
          return this.rconClient;
        })
        .finally(() => {
          this.rconPending = null;
        });
    }
    return this.rconPending;
  }

  async rconExec(command) {
    const client = await this.getRcon();
    try {
      return await client.exec(command);
    } catch (e) {
      // Connexion perdue ou mauvaise adresse : on refera la découverte au prochain essai.
      client.close();
      if (this.rconClient === client) this.rconClient = null;
      throw e;
    }
  }

  stopMonitoring() {
    if (this.tail) this.tail.stop();
    if (this.rconClient) this.rconClient.close();
    clearInterval(this.pollTimer);
    clearInterval(this.aliveTimer);
    this.tail = null;
    this.rconClient = null;
    this.pollTimer = null;
    this.aliveTimer = null;
  }

  async poll() {
    if (this.polling || !this.port) return;
    this.polling = true;
    try {
      const i = await a2sInfo('127.0.0.1', this.port, 1500);
      this.info = {
        name: i.name,
        map: i.map,
        players: Math.max(0, i.players - i.bots),
        bots: i.bots,
        maxPlayers: i.maxPlayers,
        passworded: i.passworded,
        version: i.version,
      };
      if (this.status === 'starting') {
        this.panelLine('Serveur en ligne ✔');
        this.setStatus('running');
        // `status` donne l'IP publique vue par Steam : pratique pour l'adresse de connexion « Internet ».
        this.internalStatus().catch(() => {});
      } else {
        this.emitState(false);
      }
    } catch {
      /* pas encore prêt (chargement de la map…) */
    } finally {
      this.polling = false;
    }
  }

  onExit(code, pid) {
    if (!this.pid || pid !== this.pid) return;
    const wasStopping = this.stopping;
    const uptime = Date.now() - (this.startedAt || Date.now());
    this.stopMonitoring();
    this.pid = null;
    this.info = null;
    this.stopping = false;
    try {
      fs.unlinkSync(RUNTIME_FILE);
    } catch {
      /* absent */
    }
    this.writeStubCfg();

    if (wasStopping) {
      this.panelLine('Serveur arrêté.');
      this.setStatus('stopped', null);
      return;
    }

    const msg = `Le serveur s’est arrêté de façon inattendue${code != null ? ` (code ${code})` : ''}.`;
    this.panelLine(msg);
    this.setStatus('crashed', msg);

    if (!config.get().autoRestart || !this.profileId) return;
    if (uptime < 60 * 1000) {
      this.panelLine('Plantage pendant le démarrage : pas de redémarrage automatique (vérifie la configuration).');
      return;
    }
    this.crashes = this.crashes.filter((t) => Date.now() - t < 10 * 60 * 1000);
    this.crashes.push(Date.now());
    if (this.crashes.length > 3) {
      this.panelLine('Trop de plantages en 10 minutes : redémarrage automatique suspendu.');
      return;
    }
    this.panelLine('Redémarrage automatique dans 5 secondes…');
    const id = this.profileId;
    this.restartTimer = setTimeout(() => {
      this.start(id).catch((e) => this.setStatus('crashed', e.message));
    }, 5000);
  }

  async stop() {
    clearTimeout(this.restartTimer);
    if (!this.pid) {
      if (this.status !== 'stopped') this.setStatus('stopped', null);
      return this.getState();
    }
    if (this.status === 'stopping') return this.getState();
    const pid = this.pid;
    this.stopping = true;
    this.setStatus('stopping');
    this.panelLine('Arrêt du serveur…');

    await Promise.race([this.rconExec('quit').catch(() => {}), sleep(2500)]);
    const deadline = Date.now() + 10000;
    while (isPidAlive(pid) && Date.now() < deadline) await sleep(400);
    if (isPidAlive(pid)) {
      this.panelLine('Le serveur ne répond pas : arrêt forcé.');
      await killTree(pid);
      await sleep(500);
    }
    if (this.pid === pid) this.onExit(null, pid);
    return this.getState();
  }

  async restart() {
    const id = this.profileId;
    if (!id) throw new HttpError(400, 'Aucun serveur à redémarrer.');
    await this.stop();
    await sleep(1000);
    return this.start(id);
  }

  /** Au démarrage du panel : reprend la main sur un serveur lancé précédemment. */
  async attach() {
    const rt = readJson(RUNTIME_FILE, null);
    if (!rt?.pid) return;
    const name = await processName(rt.pid);
    const profile = profiles.get(rt.profileId);
    if (!name || name.toLowerCase() !== 'cs2.exe' || !profile) {
      try {
        fs.unlinkSync(RUNTIME_FILE);
      } catch {
        /* absent */
      }
      return;
    }
    this.paths = gamePaths(config.get().serverDir);
    this.pid = rt.pid;
    this.profileId = rt.profileId;
    this.port = rt.port;
    this.startedAt = rt.startedAt;
    this.panelLine('Serveur CS2 déjà en cours d’exécution : reconnexion.');
    this.setStatus('starting');
    this.startMonitoring(profile, 64 * 1024);
  }

  // ---------- commandes ----------

  async rcon(command) {
    const cmd = String(command || '').trim();
    if (!cmd) throw new HttpError(400, 'Commande vide.');
    if (cmd.length > 512) throw new HttpError(400, 'Commande trop longue.');
    if (!['starting', 'running'].includes(this.status)) throw new HttpError(409, 'Le serveur n’est pas lancé.');
    if (/^(quit|exit)$/i.test(cmd)) {
      this.stop().catch(() => {});
      return '';
    }
    this.pushLines([`] ${cmd}`]);
    let output;
    try {
      output = await this.rconExec(cmd);
    } catch (e) {
      this.panelLine(`RCON indisponible : ${e.message}`);
      throw new HttpError(503, `RCON indisponible : ${e.message}`);
    }
    // Pas besoin d'afficher la réponse : CS2 la recopie lui-même dans console.log.
    return output;
  }

  /** `status` lancé par le panel : sa sortie, recopiée dans console.log, est masquée de la console. */
  async internalStatus() {
    this.hiddenStatusBlocks += 1;
    let output;
    try {
      output = await this.rconExec('status');
    } catch (e) {
      this.hiddenStatusBlocks = Math.max(0, this.hiddenStatusBlocks - 1);
      throw e;
    }
    const status = parseStatus(output);
    if (status.publicAddress && status.publicAddress !== this.publicAddress) {
      this.publicAddress = status.publicAddress;
      this.emitState();
    }
    return status;
  }

  async players() {
    if (this.status !== 'running') return { players: [] };
    try {
      return await this.internalStatus();
    } catch (e) {
      return { players: [], error: `RCON indisponible : ${e.message}` };
    }
  }

  async action(body = {}) {
    const simple = {
      restartgame: 'mp_restartgame 1',
      warmup_end: 'mp_warmup_end',
      warmup_start: 'mp_warmup_start',
      pause: 'mp_pause_match',
      unpause: 'mp_unpause_match',
      bot_add_t: 'bot_add_t',
      bot_add_ct: 'bot_add_ct',
      bot_kick: 'bot_kick',
    };
    let cmd = simple[body.type];
    if (!cmd) {
      if (body.type === 'changelevel' && /^[a-z0-9_]{1,64}$/i.test(body.map || '')) cmd = `changelevel ${body.map}`;
      else if (body.type === 'workshop' && /^\d{1,20}$/.test(body.id || '')) cmd = `host_workshop_map ${body.id}`;
      else if (body.type === 'say' && String(body.message || '').trim()) cmd = `say ${cfgString(body.message, 180)}`;
      else if (body.type === 'kick' && /^\d{1,5}$/.test(String(body.userid))) cmd = `kickid ${body.userid}`;
      else throw new HttpError(400, 'Action inconnue ou paramètres invalides.');
    }
    return { output: await this.rcon(cmd) };
  }
}

module.exports = new ServerManager();
