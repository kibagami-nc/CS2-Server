import { api } from '../api.js';
import { loadNetwork } from '../app.js';
import { esc, icon, toast, confirmDialog, copyText, fmtBytes, busy } from '../ui.js';

const GSLT_URL = 'https://steamcommunity.com/dev/managegameservers';

export function mount(el, { store, on }) {
  let detected = null;

  function render() {
    const i = store.install;
    const s = store.settings;
    const job = store.job;
    const jobRunning = job?.status === 'running';
    const serverActive = ['starting', 'running', 'stopping'].includes(store.server?.status);
    const showLogs = job && job.type === 'install';

    el.innerHTML = `
      <div class="page-head"><div><h1>Paramètres</h1><p class="sub">Installation de CS2, comportement du serveur et accès au panel.</p></div></div>

      <div class="card">
        <div class="card-head">
          <div><h2>Installation de Counter-Strike 2</h2><p>Les fichiers du serveur dédié (≈ 70 Go, réservés dès le début du téléchargement).</p></div>
          <div class="row">
            ${i.installed ? `<span class="chip ok">${icon('check', 13)} Installé</span>` : `<span class="chip err">Non installé</span>`}
            ${i.buildId ? `<span class="chip">Build ${esc(i.buildId)}</span>` : ''}
            <span class="chip">${i.steamClient ? 'Client Steam' : 'Serveur dédié (SteamCMD)'}</span>
            <span class="chip">${icon('folder', 13)} ${fmtBytes(i.freeBytes)} libres</span>
          </div>
        </div>
        <div class="stack">
          <div class="field">
            <label for="s-dir">Dossier du serveur CS2</label>
            <div class="input-group">
              <input class="input mono" id="s-dir" value="${esc(s.serverDir)}" ${serverActive || jobRunning ? 'disabled' : ''} />
              <button class="btn" id="s-dir-save" ${serverActive || jobRunning ? 'disabled' : ''}>Enregistrer</button>
            </div>
            <span class="hint">Le dossier qui contient (ou contiendra) <code>game\\bin\\win64\\cs2.exe</code>. Évite OneDrive et le dossier du projet.</span>
          </div>
          ${
            i.steamClient
              ? `<div class="callout info">${icon('info')}<div>Tu utilises le CS2 installé par Steam : les mises à jour passent par Steam et les plugins sont désactivés.
                  Pour un serveur indépendant avec plugins, mets un autre dossier (ex. <code>D:\\CS2Server\\cs2</code>) puis clique sur « Installer ».</div></div>`
              : `<div class="field">
                  <label for="s-steamcmd">Dossier de SteamCMD</label>
                  <div class="input-group">
                    <input class="input mono" id="s-steamcmd" value="${esc(s.steamcmdDir)}" ${jobRunning ? 'disabled' : ''} />
                    <button class="btn" id="s-steamcmd-save" ${jobRunning ? 'disabled' : ''}>Enregistrer</button>
                  </div>
                  <span class="hint">SteamCMD est téléchargé automatiquement ici s’il n’est pas présent.</span>
                </div>`
          }
          <div class="row">
            ${
              i.steamClient
                ? ''
                : `<button class="btn btn-primary" id="s-update" ${jobRunning || serverActive ? 'disabled' : ''}>${icon('download', 15)} ${i.installed ? 'Mettre à jour CS2' : 'Installer CS2'}</button>
                   <button class="btn" id="s-validate" ${jobRunning || serverActive || !i.installed ? 'disabled' : ''}>${icon('shield', 15)} Vérifier les fichiers</button>`
            }
            <button class="btn" id="s-detect" ${serverActive || jobRunning ? 'disabled' : ''}>${icon('search', 15)} Détecter CS2 installé par Steam</button>
          </div>
          ${serverActive ? `<p class="muted small">Arrête le serveur pour mettre à jour ou changer de dossier.</p>` : ''}
          <div id="s-detected"></div>
          ${
            showLogs
              ? `<div class="field"><label>Journal ${job.status === 'running' ? '(en cours)' : `(${job.status === 'done' ? 'terminé' : job.status === 'error' ? 'erreur' : 'annulé'})`}</label>
                 <div class="log-box" id="s-logs"></div></div>`
              : ''
          }
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div><h2>Serveur</h2><p>Comportement du processus CS2.</p></div></div>
          <label class="switch">
            <span class="txt"><b>Redémarrage automatique</b><span>Relance le serveur s’il plante (3 fois max. en 10 min).</span></span>
            <input type="checkbox" id="s-auto" ${s.autoRestart ? 'checked' : ''} />
          </label>
          <label class="switch">
            <span class="txt"><b>Afficher la fenêtre de CS2</b><span>Garde la console de cs2.exe réduite dans la barre des tâches (sinon elle est masquée).</span></span>
            <input type="checkbox" id="s-window" ${s.showConsoleWindow ? 'checked' : ''} />
          </label>
          <div class="field" style="margin-top:12px">
            <label for="s-gslt">Token GSLT par défaut</label>
            <div class="input-group">
              <input class="input mono" id="s-gslt" value="${esc(s.defaultGslt)}" placeholder="Utilisé si le serveur n’a pas son propre token" />
              <button class="btn" id="s-gslt-save">Enregistrer</button>
            </div>
            <span class="hint">Sans token, CS2 limite le serveur au réseau local.
              <a href="${GSLT_URL}" target="_blank" rel="noopener">Créer un token</a> (App ID 730, un token par serveur lancé en même temps).</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h2>Accès au panel</h2><p>Sécurité et adresse d’écoute.</p></div></div>
          <div class="stack">
            <div class="field">
              <label for="s-host">Qui peut ouvrir le panel ?</label>
              <div class="input-group">
                <select class="input" id="s-host">
                  <option value="127.0.0.1" ${s.panelHost === '127.0.0.1' ? 'selected' : ''}>Seulement ce PC (127.0.0.1)</option>
                  <option value="0.0.0.0" ${s.panelHost === '0.0.0.0' ? 'selected' : ''}>Tout mon réseau local (téléphone, autre PC…)</option>
                </select>
                <input class="input" id="s-port" type="number" min="1024" max="65535" value="${s.panelPort}" style="max-width:110px" />
                <button class="btn" id="s-host-save">Enregistrer</button>
              </div>
              <span class="hint">Pris en compte au prochain démarrage du panel. N’ouvre jamais le port du panel sur ta box.</span>
            </div>
            <form class="stack" id="s-pw-form" autocomplete="off">
              <span class="label">Changer le mot de passe</span>
              <input class="input" type="password" id="s-pw-cur" placeholder="Mot de passe actuel" autocomplete="current-password" />
              <div class="input-group">
                <input class="input" type="password" id="s-pw-new" placeholder="Nouveau (6 caractères min.)" autocomplete="new-password" />
                <button class="btn">${icon('key', 15)} Changer</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Jouer avec des amis</h2><p>Ce qu’il faut pour que d’autres personnes rejoignent ton serveur.</p></div></div>
        <div class="grid grid-3">
          <div class="stack">
            <h3>${icon('server', 16)} Même réseau (LAN)</h3>
            <p class="muted small">Tes amis connectés à ta box utilisent ton IP locale :</p>
            <div id="s-lan" class="stack"></div>
          </div>
          <div class="stack">
            <h3>${icon('globe', 16)} Par Internet</h3>
            <p class="muted small">Dans l’interface de ta box, redirige le port <b>27015 en UDP</b> (ou celui de ton serveur) vers l’IP locale de ce PC, et ajoute un token GSLT.</p>
            <div id="s-public"><button class="btn btn-sm" id="s-public-btn">${icon('globe', 14)} Afficher mon IP publique</button></div>
          </div>
          <div class="stack">
            <h3>${icon('shield', 16)} Pare-feu Windows</h3>
            <p class="muted small">Au premier lancement, Windows demande d’autoriser <code>cs2.exe</code> : coche « Réseaux privés » (et « publics » si besoin) puis valide.
              Le port TCP de RCON n’a pas besoin d’être ouvert : le panel s’y connecte en local.</p>
          </div>
        </div>
      </div>`;

    bind();
    renderDetected();
    renderLogs();
    renderNetwork();
  }

  function renderLogs() {
    const box = el.querySelector('#s-logs');
    if (!box) return;
    box.textContent = store.jobLogs.slice(-200).join('\n') || '…';
    box.scrollTop = box.scrollHeight;
  }

  function renderDetected() {
    const box = el.querySelector('#s-detected');
    if (!box || !detected) return;
    if (!detected.length) {
      box.innerHTML = `<div class="callout warn">${icon('alert')}<div>Aucune installation de CS2 trouvée dans tes bibliothèques Steam.</div></div>`;
      return;
    }
    box.innerHTML = detected
      .map(
        (d) => `<div class="connect-item"><span class="where">Steam</span><code>${esc(d.serverDir)}</code>
          <button class="btn btn-sm" data-use="${esc(d.serverDir)}">Utiliser</button></div>`
      )
      .join('');
    box.querySelectorAll('[data-use]').forEach(
      (b) =>
        (b.onclick = () =>
          busy(b, async () => {
            await api.put('/api/settings', { serverDir: b.dataset.use });
            toast('Dossier du serveur mis à jour', 'ok');
          }))
    );
  }

  function renderNetwork() {
    const lan = el.querySelector('#s-lan');
    const net = store.network;
    if (!lan || !net) return;
    lan.innerHTML =
      net.lan
        .map(
          (ip) => `<div class="connect-item"><code>${esc(ip.address)}</code><span class="muted small">${esc(ip.iface)}</span>
            <button class="btn btn-sm btn-icon" data-copy="${esc(ip.address)}" title="Copier">${icon('copy', 14)}</button></div>`
        )
        .join('') || '<p class="muted small">Aucune interface réseau détectée.</p>';
    if (net.public) {
      el.querySelector('#s-public').innerHTML = `<div class="connect-item"><code>${esc(net.public)}</code>
        <button class="btn btn-sm btn-icon" data-copy="${esc(net.public)}" title="Copier">${icon('copy', 14)}</button></div>`;
    }
    el.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
  }

  function bind() {
    const $ = (s) => el.querySelector(s);
    const saveSettings = (patch, msg = 'Paramètres enregistrés') =>
      api.put('/api/settings', patch).then(() => toast(msg, 'ok', 2000));

    const dirSave = $('#s-dir-save');
    if (dirSave) dirSave.onclick = (e) => busy(e.currentTarget, () => saveSettings({ serverDir: $('#s-dir').value }));
    const cmdSave = $('#s-steamcmd-save');
    if (cmdSave) cmdSave.onclick = (e) => busy(e.currentTarget, () => saveSettings({ steamcmdDir: $('#s-steamcmd').value }));

    const update = $('#s-update');
    if (update)
      update.onclick = (e) =>
        busy(e.currentTarget, async () => {
          const i = store.install;
          if (!i.installed) {
            const ok = await confirmDialog({
              title: 'Installer CS2 ?',
              text: `SteamCMD va télécharger environ <b>70 Go</b> dans <code>${esc(i.serverDir)}</code> (espace libre : ${fmtBytes(i.freeBytes)}).`,
              ok: 'Lancer le téléchargement',
            });
            if (!ok) return;
          }
          await api.post('/api/install/update');
        });
    const validate = $('#s-validate');
    if (validate) validate.onclick = (e) => busy(e.currentTarget, () => api.post('/api/install/validate'));
    $('#s-detect').onclick = (e) =>
      busy(e.currentTarget, async () => {
        detected = await api.get('/api/install/detect');
        renderDetected();
      });

    $('#s-auto').onchange = (e) => busy(e.target, () => saveSettings({ autoRestart: e.target.checked }));
    $('#s-window').onchange = (e) => busy(e.target, () => saveSettings({ showConsoleWindow: e.target.checked }));
    $('#s-gslt-save').onclick = (e) => busy(e.currentTarget, () => saveSettings({ defaultGslt: $('#s-gslt').value.trim() }));
    $('#s-host-save').onclick = (e) =>
      busy(e.currentTarget, () =>
        saveSettings({ panelHost: $('#s-host').value, panelPort: Number($('#s-port').value) }, 'Enregistré : redémarre le panel pour l’appliquer')
      );
    $('#s-pw-form').onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        await api.post('/api/auth/password', { current: $('#s-pw-cur').value, password: $('#s-pw-new').value });
        $('#s-pw-cur').value = '';
        $('#s-pw-new').value = '';
        toast('Mot de passe modifié', 'ok');
      });
    };
    $('#s-public-btn').onclick = (e) =>
      busy(e.currentTarget, async () => {
        const net = await loadNetwork(true);
        if (net.publicError) toast(net.publicError, 'err');
        renderNetwork();
      });
  }

  render();
  loadNetwork(false).then(renderNetwork).catch(() => {});

  const offs = [
    on('install', render),
    on('settings', render),
    on('job', ({ value, prev }) => {
      if (value?.status !== prev?.status || value?.id !== prev?.id) render();
    }),
    on('jobLog', renderLogs),
    on('server', ({ value, prev }) => prev?.status !== value.status && render()),
  ];
  return { destroy: () => offs.forEach((off) => off()) };
}
