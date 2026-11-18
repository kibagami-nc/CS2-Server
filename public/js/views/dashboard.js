import { api } from '../api.js';
import { modeOf, loadMaps, loadNetwork } from '../app.js';
import { esc, icon, toast, confirmDialog, copyText, fmtBytes, fmtDuration, fmtDate, statusPill, modeTag, busy } from '../ui.js';

export function mount(el, { store, on, navigate }) {
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Tableau de bord</h1>
        <p class="sub">Ton serveur Counter-Strike 2, hébergé directement sur ce PC.</p>
      </div>
      <a class="btn btn-primary" href="#/create">${icon('plus')} Créer un serveur</a>
    </div>
    <div id="d-install"></div>
    <div id="d-server"></div>
    <div id="d-live"></div>
    <section class="section">
      <div class="section-head">
        <div><h2>Mes serveurs</h2><p>Tes configurations enregistrées : un clic pour les lancer.</p></div>
      </div>
      <div id="d-profiles"></div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const timers = [];
  let liveStatus = null;
  let playersTimer = null;

  // ---------- installation manquante ----------
  function renderInstall() {
    const i = store.install;
    const box = $('#d-install');
    if (!i || i.installed) {
      box.innerHTML = '';
      return;
    }
    const jobRunning = store.job?.status === 'running';
    box.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h2>Première étape : installer CS2 sur ce PC</h2>
            <p>Le panel a besoin des fichiers du serveur dédié Counter-Strike 2.</p>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="stack">
            <h3>${icon('download', 16)} Serveur dédié (recommandé)</h3>
            <p class="muted small">Téléchargé via SteamCMD dans <code>${esc(i.serverDir)}</code>.
              Environ 70 Go (réservés d’un coup) — espace libre : <b>${fmtBytes(i.freeBytes)}</b>. Permet les plugins.</p>
            <div class="row"><button class="btn btn-primary" id="d-install-btn" ${jobRunning ? 'disabled' : ''}>Installer maintenant</button>
            <a class="btn btn-ghost" href="#/settings">Changer de dossier</a></div>
          </div>
          <div class="stack">
            <h3>${icon('bolt', 16)} Utiliser mon CS2 Steam</h3>
            <p class="muted small">Aucun téléchargement : le serveur se lance depuis le jeu déjà installé par Steam.
              Plugins désactivés dans ce cas (protection de ton compte).</p>
            <div class="row"><button class="btn" id="d-detect-btn">Détecter mon installation</button></div>
          </div>
        </div>
      </div>`;
    $('#d-install-btn').onclick = (e) =>
      busy(e.currentTarget, async () => {
        const ok = await confirmDialog({
          title: 'Installer le serveur CS2 ?',
          text: `SteamCMD va télécharger environ 70 Go dans <code>${esc(i.serverDir)}</code>. Tu peux suivre la progression en haut de l’écran.`,
          ok: 'Lancer le téléchargement',
        });
        if (ok) await api.post('/api/install/update');
      });
    $('#d-detect-btn').onclick = (e) =>
      busy(e.currentTarget, async () => {
        const found = await api.get('/api/install/detect');
        if (!found.length) return toast('Aucune installation Steam de CS2 trouvée sur ce PC.', 'err');
        const target = found[0];
        const ok = await confirmDialog({
          title: 'Utiliser cette installation ?',
          text: `CS2 trouvé dans <code>${esc(target.serverDir)}</code>.`,
          ok: 'Utiliser ce dossier',
        });
        if (!ok) return;
        await api.put('/api/settings', { serverDir: target.serverDir });
        toast('Installation Steam sélectionnée', 'ok');
      });
  }

  // ---------- serveur actif ----------
  function connectRows(s) {
    const pw = s.profile?.password;
    const suffix = pw ? `; password ${pw}` : '';
    const rows = [{ where: 'Sur ce PC', ip: '127.0.0.1' }];
    for (const ip of (store.network?.lan || []).slice(0, 2)) rows.push({ where: 'Réseau local', ip: ip.address });
    const items = rows.map(
      (r) => `
        <div class="connect-item">
          <span class="where">${esc(r.where)}</span>
          <code>connect ${esc(r.ip)}:${s.port}${esc(suffix)}</code>
          <button class="btn btn-sm btn-icon" data-copy="connect ${esc(r.ip)}:${s.port}${esc(suffix)}" title="Copier">${icon('copy', 15)}</button>
        </div>`
    );
    const pub = s.publicAddress || store.network?.public;
    items.push(
      pub
        ? `<div class="connect-item" title="Pour tes amis hors de chez toi. Depuis ce PC ou ton réseau, utilise l'adresse locale : beaucoup de box ne savent pas renvoyer vers leur propre IP publique."><span class="where">Internet (amis)</span>
             <code>connect ${esc(pub)}:${s.port}${esc(suffix)}</code>
             <button class="btn btn-sm btn-icon" data-copy="connect ${esc(pub)}:${s.port}${esc(suffix)}" title="Copier">${icon('copy', 15)}</button></div>`
        : `<div class="connect-item"><span class="where">Internet</span>
             <span class="muted small" style="flex:1">Pour tes amis à distance (port ${s.port} UDP à ouvrir sur ta box).</span>
             <button class="btn btn-sm" id="d-public">${icon('globe', 15)} Afficher mon IP publique</button></div>`
    );
    if (!s.profile?.gslt && !store.settings?.defaultGslt) {
      items.push(
        `<div class="callout warn">${icon('alert')}<div>Pas de token GSLT : CS2 limite le serveur au <b>réseau local</b>. Ajoute un token dans les options avancées du serveur pour jouer par Internet.</div></div>`
      );
    }
    return items.join('');
  }

  function renderServer() {
    const s = store.server;
    const box = $('#d-server');
    if (!s || !s.profile) {
      box.innerHTML = `
        <div class="card empty">
          <div class="big">${icon('server', 26)}</div>
          <h3>Aucun serveur lancé</h3>
          <p>Crée un serveur ou lance une de tes configurations ci-dessous.</p>
        </div>`;
      return;
    }
    const p = s.profile;
    const mode = modeOf(p.mode);
    const active = ['starting', 'running', 'stopping'].includes(s.status);
    const map = s.info?.map || (p.workshopId ? `Workshop ${p.workshopId}` : p.map);
    const players = s.info ? `${s.info.players}<small> / ${s.info.maxPlayers}</small>` : `—<small> / ${p.maxPlayers}</small>`;
    const joinUrl = `steam://connect/127.0.0.1:${s.port || p.port}${p.password ? `/${encodeURIComponent(p.password)}` : ''}`;

    box.innerHTML = `
      <div class="hero" style="--c1:${mode?.color[0]};--c2:${mode?.color[1]}">
        <div class="hero-top">
          <div>
            <div class="row">${statusPill(s.status)} ${modeTag(mode)}</div>
            <h2>${esc(p.name)}</h2>
            <div class="meta">
              <span>${esc(mode?.label || p.mode)}</span><span class="sep">•</span>
              <span>${icon('map', 15)} ${esc(map)}</span><span class="sep">•</span>
              <span>Port ${s.port || p.port}</span>
              ${p.password ? `<span class="sep">•</span><span>${icon('key', 15)} Protégé par mot de passe</span>` : ''}
            </div>
          </div>
          <div class="row">
            ${
              active
                ? `<a class="btn btn-ok" href="${esc(joinUrl)}" ${s.status !== 'running' ? 'style="pointer-events:none;opacity:.45"' : ''}>${icon('play', 16)} Rejoindre</a>
                   <button class="btn" id="d-restart" ${s.status === 'stopping' ? 'disabled' : ''}>${icon('restart', 16)} Redémarrer</button>
                   <button class="btn btn-danger" id="d-stop" ${s.status === 'stopping' ? 'disabled' : ''}>${icon('stop', 16)} Arrêter</button>`
                : `<button class="btn btn-primary" id="d-start">${icon('play', 16)} Relancer</button>
                   <a class="btn" href="#/edit/${esc(p.id)}">${icon('edit', 16)} Modifier</a>`
            }
          </div>
        </div>
        ${
          s.status === 'crashed' && s.lastError
            ? `<div class="callout err" style="margin-top:16px;position:relative;z-index:1">${icon('alert')}<div>${esc(s.lastError)} <a href="#/console">Voir la console</a></div></div>`
            : ''
        }
        ${
          s.status === 'starting'
            ? `<div class="callout info" style="margin-top:16px;position:relative;z-index:1">${icon('info')}<div>Chargement de la map… Le premier démarrage peut prendre une minute (et plus pour une map Workshop). <a href="#/console">Suivre dans la console</a></div></div>`
            : ''
        }
        <div class="stats">
          <div class="stat"><span>Joueurs</span><b>${players}</b></div>
          <div class="stat"><span>Bots</span><b>${s.info ? s.info.bots : '—'}</b></div>
          <div class="stat"><span>Map</span><b title="${esc(map)}">${esc(map)}</b></div>
          <div class="stat"><span>En ligne depuis</span><b id="d-uptime">${active ? fmtDuration(Date.now() - s.startedAt) : '—'}</b></div>
        </div>
        ${active ? `<div class="connect-list">${connectRows(s)}</div>` : ''}
      </div>`;

    box.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
    const pub = $('#d-public');
    if (pub) pub.onclick = (e) => busy(e.currentTarget, async () => {
      const net = await loadNetwork(true);
      if (net.publicError) toast(net.publicError, 'err');
      renderServer();
    });
    const stop = $('#d-stop');
    if (stop) stop.onclick = (e) => busy(e.currentTarget, async () => {
      const ok = await confirmDialog({ title: 'Arrêter le serveur ?', text: 'Les joueurs connectés seront déconnectés.', ok: 'Arrêter', danger: true });
      if (ok) await api.post('/api/server/stop');
    });
    const restart = $('#d-restart');
    if (restart) restart.onclick = (e) => busy(e.currentTarget, () => api.post('/api/server/restart'));
    const start = $('#d-start');
    if (start) start.onclick = (e) => busy(e.currentTarget, () => api.post('/api/server/start', { profileId: p.id }));
  }

  // ---------- actions rapides + joueurs (seulement en ligne) ----------
  async function renderLive() {
    const s = store.server;
    const box = $('#d-live');
    const status = s?.status === 'running' ? 'running' : 'off';
    if (status === liveStatus) return;
    liveStatus = status;
    clearInterval(playersTimer);
    if (status !== 'running') {
      box.innerHTML = '';
      return;
    }
    const maps = await loadMaps().catch(() => ({ maps: [] }));
    box.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div><h2>Actions rapides</h2><p>Envoyées au serveur via RCON.</p></div></div>
          <div class="stack">
            <div class="chips">
              <button class="btn btn-sm" data-act="restartgame">${icon('restart', 14)} Relancer la partie</button>
              <button class="btn btn-sm" data-act="warmup_end">${icon('flag', 14)} Fin d’échauffement</button>
              <button class="btn btn-sm" data-act="pause">${icon('pause', 14)} Pause</button>
              <button class="btn btn-sm" data-act="unpause">${icon('play', 14)} Reprendre</button>
            </div>
            <div class="chips">
              <button class="btn btn-sm" data-act="bot_add_t">${icon('bot', 14)} + Bot T</button>
              <button class="btn btn-sm" data-act="bot_add_ct">${icon('bot', 14)} + Bot CT</button>
              <button class="btn btn-sm" data-act="bot_kick">${icon('x', 14)} Retirer les bots</button>
            </div>
            <div class="field">
              <label for="d-map">Changer de map</label>
              <div class="input-group">
                <select class="input" id="d-map">
                  ${maps.maps.map((m) => `<option value="${esc(m.id)}" ${m.id === s.info?.map ? 'selected' : ''}>${esc(m.name)} (${esc(m.id)})</option>`).join('')}
                </select>
                <button class="btn" id="d-changelevel">${icon('map', 15)} Charger</button>
              </div>
            </div>
            <div class="field">
              <label for="d-ws">Map du Workshop</label>
              <div class="input-group">
                <input class="input" id="d-ws" placeholder="ID ou lien de la map Workshop" />
                <button class="btn" id="d-workshop">${icon('download', 15)} Charger</button>
              </div>
            </div>
            <div class="field">
              <label for="d-say">Message à tous les joueurs</label>
              <div class="input-group">
                <input class="input" id="d-say" maxlength="180" placeholder="GG ! Prochaine map dans 2 minutes" />
                <button class="btn" id="d-say-btn">${icon('message', 15)} Envoyer</button>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h2>Joueurs connectés</h2><p>Actualisé toutes les 5 secondes.</p></div>
          </div>
          <div id="d-players"><p class="muted">Chargement…</p></div>
        </div>
      </div>`;

    box.querySelectorAll('[data-act]').forEach(
      (b) => (b.onclick = () => busy(b, async () => {
        await api.post('/api/server/action', { type: b.dataset.act });
        toast('Commande envoyée', 'ok', 1500);
      }))
    );
    $('#d-changelevel').onclick = (e) =>
      busy(e.currentTarget, () => api.post('/api/server/action', { type: 'changelevel', map: $('#d-map').value }));
    $('#d-workshop').onclick = (e) =>
      busy(e.currentTarget, async () => {
        const raw = $('#d-ws').value.trim();
        const id = (raw.match(/[?&]id=(\d+)/) || [])[1] || raw.replace(/\D/g, '');
        if (!id) throw new Error('Colle l’ID (ou le lien) de la map Workshop.');
        await api.post('/api/server/action', { type: 'workshop', id });
        toast('Téléchargement de la map Workshop lancé', 'ok');
      });
    const say = () =>
      busy($('#d-say-btn'), async () => {
        const message = $('#d-say').value.trim();
        if (!message) return;
        await api.post('/api/server/action', { type: 'say', message });
        $('#d-say').value = '';
      });
    $('#d-say-btn').onclick = say;
    $('#d-say').onkeydown = (e) => e.key === 'Enter' && say();

    const refreshPlayers = async () => {
      const target = $('#d-players');
      if (!target) return;
      const data = await api.get('/api/server/players').catch((e) => ({ players: [], error: e.message }));
      if (data.error) {
        target.innerHTML = `<div class="callout warn">${icon('alert')}<div>${esc(data.error)}</div></div>`;
        return;
      }
      if (!data.players.length) {
        target.innerHTML = `<div class="empty"><div class="big">${icon('users', 24)}</div><p>Personne pour l’instant. Partage l’adresse de connexion à tes amis !</p></div>`;
        return;
      }
      target.innerHTML = `
        <table class="table">
          <thead><tr><th>Joueur</th><th class="num">Ping</th><th>Temps</th><th></th></tr></thead>
          <tbody>
            ${data.players
              .map(
                (pl) => `<tr>
                  <td>${pl.bot ? icon('bot', 15) : icon('users', 15)} ${esc(pl.name)}</td>
                  <td class="num">${pl.bot ? '—' : `${pl.ping} ms`}</td>
                  <td>${esc(pl.time || 'bot')}</td>
                  <td class="num"><button class="btn btn-sm btn-danger" data-kick="${pl.userid}" data-name="${esc(pl.name)}">Expulser</button></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>`;
      target.querySelectorAll('[data-kick]').forEach(
        (b) => (b.onclick = () => busy(b, async () => {
          const ok = await confirmDialog({ title: 'Expulser ce joueur ?', text: `<b>${esc(b.dataset.name)}</b> sera déconnecté du serveur.`, ok: 'Expulser', danger: true });
          if (!ok) return;
          await api.post('/api/server/action', { type: 'kick', userid: b.dataset.kick });
          refreshPlayers();
        }))
      );
    };
    refreshPlayers();
    playersTimer = setInterval(refreshPlayers, 5000);
  }

  // ---------- profils ----------
  function renderProfiles() {
    const box = $('#d-profiles');
    const s = store.server;
    const busyServer = s && ['starting', 'running', 'stopping'].includes(s.status);
    if (!store.profiles.length) {
      box.innerHTML = `
        <div class="card empty">
          <div class="big">${icon('crosshair', 26)}</div>
          <h3>Pas encore de serveur</h3>
          <p>Choisis un mode de jeu, une map, et c’est parti.</p>
          <a class="btn btn-primary" href="#/create">${icon('plus')} Créer mon premier serveur</a>
        </div>`;
      return;
    }
    const sorted = [...store.profiles].sort((a, b) => (b.lastStartedAt || b.createdAt) - (a.lastStartedAt || a.createdAt));
    box.innerHTML = `<div class="profiles">${sorted
      .map((p) => {
        const mode = modeOf(p.mode);
        const isCurrent = s?.profileId === p.id && busyServer;
        return `
          <div class="card profile ${isCurrent ? 'active' : ''}">
            <div class="profile-top">
              ${modeTag(mode)}
              <div class="t"><h3 title="${esc(p.name)}">${esc(p.name)}</h3><p>${esc(mode?.label || p.mode)}</p></div>
              <span class="spacer"></span>
              ${isCurrent ? statusPill(s.status) : ''}
            </div>
            <div class="facts">
              <span class="chip">${icon('map', 13)} ${esc(p.workshopId ? `Workshop ${p.workshopId}` : p.map)}</span>
              <span class="chip">${icon('users', 13)} ${p.maxPlayers}</span>
              ${p.bots.quota ? `<span class="chip">${icon('bot', 13)} ${p.bots.quota}</span>` : ''}
              ${p.password ? `<span class="chip">${icon('key', 13)} privé</span>` : ''}
              <span class="chip">:${p.port}</span>
            </div>
            <div class="muted small">${icon('clock', 13)} Dernier lancement : ${esc(fmtDate(p.lastStartedAt))}</div>
            <div class="row">
              ${
                isCurrent
                  ? `<a class="btn" href="#/console">${icon('terminal', 15)} Console</a>`
                  : `<button class="btn btn-primary" data-start="${esc(p.id)}" ${busyServer || store.job?.status === 'running' || !store.install?.installed ? 'disabled' : ''}>${icon('play', 15)} Lancer</button>`
              }
              <a class="btn btn-icon" href="#/edit/${esc(p.id)}" title="Modifier">${icon('edit', 15)}</a>
              <button class="btn btn-icon btn-danger" data-del="${esc(p.id)}" title="Supprimer" ${isCurrent ? 'disabled' : ''}>${icon('trash', 15)}</button>
            </div>
          </div>`;
      })
      .join('')}</div>`;

    box.querySelectorAll('[data-start]').forEach(
      (b) => (b.onclick = () => busy(b, async () => {
        await api.post('/api/server/start', { profileId: b.dataset.start });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }))
    );
    box.querySelectorAll('[data-del]').forEach(
      (b) => (b.onclick = () => busy(b, async () => {
        const p = store.profiles.find((x) => x.id === b.dataset.del);
        const ok = await confirmDialog({ title: 'Supprimer ce serveur ?', text: `La configuration <b>${esc(p?.name)}</b> sera supprimée (les fichiers de CS2 ne sont pas touchés).`, ok: 'Supprimer', danger: true });
        if (ok) await api.del(`/api/profiles/${b.dataset.del}`);
      }))
    );
  }

  const renderAll = () => {
    renderInstall();
    renderServer();
    renderLive();
    renderProfiles();
  };

  renderAll();
  loadNetwork(false).then(renderServer).catch(() => {});

  const offs = [
    on('server', ({ value, prev }) => {
      // Mise à jour légère : on ne redessine pas les champs de saisie à chaque sondage.
      renderServer();
      renderLive();
      if (!prev || prev.status !== value.status || prev.profileId !== value.profileId) renderProfiles();
    }),
    on('profiles', renderProfiles),
    on('install', renderAll),
    on('settings', () => {
      store.maps = null;
    }),
    on('job', () => {
      renderInstall();
      renderProfiles();
    }),
  ];
  timers.push(
    setInterval(() => {
      const s = store.server;
      const u = el.querySelector('#d-uptime');
      if (u && s?.startedAt && ['starting', 'running'].includes(s.status)) u.textContent = fmtDuration(Date.now() - s.startedAt);
    }, 1000)
  );

  return {
    destroy() {
      offs.forEach((off) => off());
      timers.forEach(clearInterval);
      clearInterval(playersTimer);
    },
  };
}
