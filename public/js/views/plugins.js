import { api } from '../api.js';
import { esc, icon, toast, confirmDialog, busy } from '../ui.js';

const EXAMPLES = [
  { name: 'MatchZy', desc: 'Matchs, practice, pauses techniques', url: 'https://github.com/shobhit-pathak/MatchZy/releases' },
  { name: 'cs2-retakes', desc: 'Retakes communautaire', url: 'https://github.com/B3none/cs2-retakes/releases' },
  { name: 'CS2-SimpleAdmin', desc: 'Commandes d’administration', url: 'https://github.com/daffyyyy/CS2-SimpleAdmin/releases' },
];

export function mount(el, { store, on }) {
  let admins = null;

  function render() {
    const p = store.plugins;
    const jobRunning = store.job?.status === 'running';
    const serverActive = ['starting', 'running', 'stopping'].includes(store.server?.status);

    if (!p?.installed) {
      el.innerHTML = `${head()}<div class="card empty"><div class="big">${icon('plug', 26)}</div><h3>CS2 n’est pas encore installé</h3><p>Installe le serveur dans les paramètres pour pouvoir ajouter des plugins.</p><a class="btn btn-primary" href="#/settings">Aller aux paramètres</a></div>`;
      return;
    }
    if (p.steamClient) {
      el.innerHTML = `${head()}
        <div class="callout warn">${icon('shield')}<div>
          <b>Plugins désactivés sur l’installation Steam de CS2.</b><br />
          Metamod modifie les fichiers du jeu : sur le jeu que tu utilises pour jouer, cela pourrait déclencher VAC sur ton compte.
          Pour utiliser des plugins, installe le serveur dédié via SteamCMD dans un dossier séparé (<a href="#/settings">Paramètres</a>).
        </div></div>`;
      return;
    }

    const fwReady = p.metamod.installed && p.css.installed;
    el.innerHTML = `
      ${head()}
      <div class="card">
        <div class="card-head">
          <div><h2>Framework de plugins</h2><p>Metamod:Source charge CounterStrikeSharp, qui charge tes plugins (.dll).</p></div>
          <button class="btn ${fwReady ? '' : 'btn-primary'}" id="p-fw" ${jobRunning || serverActive ? 'disabled' : ''}>
            ${icon('download', 15)} ${fwReady ? 'Mettre à jour' : 'Installer Metamod + CounterStrikeSharp'}</button>
        </div>
        <div class="framework">
          <div class="fw">
            <div class="logo" style="background:linear-gradient(135deg,#6c7bff,#3a47c9)">MM</div>
            <div><b>Metamod:Source 2.0</b><span>${p.metamod.installed ? `Installé${p.metamod.version ? ` · ${esc(p.metamod.version)}` : ''}` : 'Non installé'}</span></div>
            <span class="spacer"></span>${p.metamod.installed ? `<span class="chip ok">${icon('check', 13)} OK</span>` : ''}
          </div>
          <div class="fw">
            <div class="logo" style="background:linear-gradient(135deg,#8b5cf6,#5b21b6)">C#</div>
            <div><b>CounterStrikeSharp</b><span>${p.css.installed ? `Installé${p.css.version ? ` · ${esc(p.css.version)}` : ''}` : 'Non installé'}</span></div>
            <span class="spacer"></span>${p.css.installed ? `<span class="chip ok">${icon('check', 13)} OK</span>` : ''}
          </div>
        </div>
        ${serverActive ? `<p class="muted small" style="margin-top:12px">Arrête le serveur pour installer ou mettre à jour le framework.</p>` : ''}
        ${
          fwReady
            ? `<label class="switch" style="margin-top:8px">
                 <span class="txt"><b>Charger les plugins au lancement</b><span>Désactive pour lancer un serveur 100 % vanilla (gameinfo.gi ${p.gameinfoPatched ? 'patché' : 'non patché'}).</span></span>
                 <input type="checkbox" id="p-enabled" ${p.enabled ? 'checked' : ''} ${serverActive ? 'disabled' : ''} />
               </label>`
            : ''
        }
      </div>

      ${
        fwReady
          ? `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div><h2>Plugins installés</h2><p>Dossier addons/counterstrikesharp/plugins</p></div></div>
          ${
            p.plugins.length
              ? p.plugins
                  .map(
                    (pl) => `
                <div class="plugin-row">
                  ${icon('plug', 16)}
                  <span class="name" title="${esc(pl.name)}">${esc(pl.name)}</span>
                  ${pl.hasDll ? '' : `<span class="chip warn">sans .dll</span>`}
                  <label class="switch" title="${pl.enabled ? 'Désactiver' : 'Activer'}"><input type="checkbox" data-toggle="${esc(pl.name)}" ${pl.enabled ? 'checked' : ''} /></label>
                  <button class="btn btn-sm btn-icon btn-danger" data-del="${esc(pl.name)}" title="Supprimer">${icon('trash', 14)}</button>
                </div>`
                  )
                  .join('')
              : `<div class="empty"><p>Aucun plugin pour l’instant.</p></div>`
          }
          <p class="muted small" style="margin-top:10px">CounterStrikeSharp recharge les plugins modifiés à chaud ; sinon redémarre le serveur.</p>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h2>Ajouter un plugin</h2><p>Glisse l’archive .zip téléchargée depuis la page « Releases » du plugin.</p></div></div>
            <label class="dropzone" id="p-drop">
              ${icon('upload', 26)}
              <b>Dépose un fichier .zip ici</b>
              <span class="small">ou clique pour le choisir — la structure de l’archive est détectée automatiquement</span>
              <input type="file" accept=".zip" id="p-file" hidden />
            </label>
            <div class="stack" style="margin-top:14px">
              <span class="label">Exemples de plugins populaires</span>
              ${EXAMPLES.map((x) => `<a class="row small" href="${x.url}" target="_blank" rel="noopener">${icon('link', 14)} <b>${esc(x.name)}</b> <span class="muted">— ${esc(x.desc)}</span></a>`).join('')}
              <span class="muted small">Vérifie toujours qu’un plugin est compatible avec la dernière version de CS2 et de CounterStrikeSharp.</span>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Admins en jeu</h2><p>Accès complet (@css/root) aux commandes des plugins.</p></div></div>
            <div id="p-admins"><p class="muted">Chargement…</p></div>
          </div>
        </div>
      </div>`
          : ''
      }`;
    bind();
    if (fwReady) renderAdmins();
  }

  function head() {
    return `<div class="page-head"><div><h1>Plugins</h1><p class="sub">Ajoute des modes et des fonctionnalités communautaires (retakes, skins, admin…) comme sur les serveurs publics.</p></div></div>`;
  }

  function bind() {
    const $ = (s) => el.querySelector(s);
    const fw = $('#p-fw');
    if (fw)
      fw.onclick = (e) =>
        busy(e.currentTarget, async () => {
          const ok = await confirmDialog({
            title: 'Installer le framework de plugins ?',
            text: 'Le panel va télécharger la dernière version de <b>Metamod:Source</b> (alliedmods.net) et de <b>CounterStrikeSharp</b> (GitHub, ~80 Mo avec le runtime .NET) puis activer Metamod dans <code>gameinfo.gi</code>.',
            ok: 'Installer',
          });
          if (ok) await api.post('/api/plugins/framework');
        });
    const enabled = $('#p-enabled');
    if (enabled) enabled.onchange = () => busy(enabled, () => api.put('/api/settings', { pluginsEnabled: enabled.checked }));

    el.querySelectorAll('[data-toggle]').forEach(
      (input) =>
        (input.onchange = () =>
          busy(input, async () => {
            await api.post(`/api/plugins/${encodeURIComponent(input.dataset.toggle)}/toggle`, { enabled: input.checked });
          }).finally(render))
    );
    el.querySelectorAll('[data-del]').forEach(
      (b) =>
        (b.onclick = () =>
          busy(b, async () => {
            const ok = await confirmDialog({ title: 'Supprimer ce plugin ?', text: `Le dossier <b>${esc(b.dataset.del)}</b> sera supprimé.`, ok: 'Supprimer', danger: true });
            if (ok) await api.del(`/api/plugins/${encodeURIComponent(b.dataset.del)}`);
          }))
    );

    const drop = $('#p-drop');
    if (!drop) return;
    const upload = async (file) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.zip')) return toast('Seuls les fichiers .zip sont acceptés.', 'err');
      toast(`Installation de ${file.name}…`, 'info', 2000);
      try {
        const r = await api.upload(`/api/plugins/upload?name=${encodeURIComponent(file.name)}`, file);
        toast(`${file.name} installé (${r.files} fichiers)`, 'ok');
      } catch (e) {
        toast(e.message, 'err', 7000);
      }
    };
    $('#p-file').onchange = (e) => upload(e.target.files[0]);
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      upload(e.dataTransfer.files[0]);
    };
  }

  async function renderAdmins() {
    const box = el.querySelector('#p-admins');
    if (!box) return;
    if (!admins) admins = await api.get('/api/plugins/admins').catch(() => []);
    box.innerHTML = `
      ${admins
        .map(
          (a, i) => `<div class="plugin-row">${icon('shield', 15)}<span class="name">${esc(a.name)} <span class="muted mono small">${esc(a.steamId)}</span></span>
            <button class="btn btn-sm btn-icon btn-danger" data-rm="${i}" title="Retirer">${icon('x', 14)}</button></div>`
        )
        .join('') || '<p class="muted small">Aucun admin.</p>'}
      <form class="input-group" id="p-admin-form" style="margin-top:12px">
        <input class="input" id="p-admin-name" placeholder="Pseudo" style="max-width:140px" />
        <input class="input mono" id="p-admin-id" placeholder="SteamID64 (7656…)" />
        <button class="btn">${icon('plus', 15)}</button>
      </form>
      <p class="muted small" style="margin-top:8px">Ton SteamID64 : profil Steam → « Copier l’URL » (le nombre de 17 chiffres), ou steamid.io.</p>`;

    const saveAdmins = async (list) => {
      admins = await api.put('/api/plugins/admins', { admins: list });
      renderAdmins();
    };
    box.querySelectorAll('[data-rm]').forEach(
      (b) => (b.onclick = () => busy(b, () => saveAdmins(admins.filter((_, i) => i !== Number(b.dataset.rm)))))
    );
    box.querySelector('#p-admin-form').onsubmit = (e) => {
      e.preventDefault();
      const name = box.querySelector('#p-admin-name').value.trim();
      const steamId = box.querySelector('#p-admin-id').value.trim();
      busy(e.submitter, () => saveAdmins([...admins, { name, steamId }]));
    };
  }

  render();
  const offs = [
    on('plugins', render),
    on('job', ({ value, prev }) => value?.status !== prev?.status && render()),
    on('server', ({ value, prev }) => prev?.status !== value.status && render()),
  ];
  return { destroy: () => offs.forEach((off) => off()) };
}
