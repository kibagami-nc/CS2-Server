import { api } from '../api.js';
import { loadMaps } from '../app.js';
import { esc, icon, toast, confirmDialog, modeTag, busy } from '../ui.js';

const DIFFICULTIES = ['Facile', 'Normal', 'Difficile', 'Expert'];
const WORKSHOP_BROWSE = 'https://steamcommunity.com/workshop/browse/?appid=730';
const GSLT_URL = 'https://steamcommunity.com/dev/managegameservers';

function defaultsFor(mode) {
  return {
    name: 'Mon serveur CS2',
    mode: mode.id,
    map: mode.defaultMap,
    workshopId: '',
    useWorkshop: Boolean(mode.workshopRecommended),
    maxPlayers: mode.maxPlayers,
    port: 27015,
    password: '',
    gslt: '',
    bots: { quota: mode.bots, difficulty: 1 },
    extraCvars: '',
    insecure: false,
  };
}

export function mount(el, { store, params, navigate }) {
  const editId = params[0];
  const existing = editId ? store.profiles.find((p) => p.id === editId) : null;
  if (editId && !existing) {
    el.innerHTML = `<div class="card empty"><h3>Serveur introuvable</h3><a class="btn" href="#/">Retour à l’accueil</a></div>`;
    return null;
  }

  const form = existing
    ? { ...structuredClone(existing), useWorkshop: Boolean(existing.workshopId) }
    : defaultsFor(store.modes[0]);
  let maps = { maps: [], fromInstall: false };

  const mode = () => store.modes.find((m) => m.id === form.mode) || store.modes[0];
  const isRunningThis = () =>
    existing && store.server?.profileId === existing.id && ['starting', 'running', 'stopping'].includes(store.server.status);

  function render() {
    const m = mode();
    el.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${existing ? `Modifier « ${esc(existing.name)} »` : 'Créer un serveur'}</h1>
          <p class="sub">${existing ? 'Les changements s’appliquent au prochain lancement.' : 'Choisis un mode, une map, et lance ton serveur en un clic.'}</p>
        </div>
      </div>

      <section class="section">
        <div class="step-title"><span class="n">1</span><h2>Mode de jeu</h2></div>
        <div class="modes">
          ${store.modes
            .map(
              (md) => `
              <button type="button" class="mode ${md.id === form.mode ? 'selected' : ''}" data-mode="${esc(md.id)}" style="--c1:${md.color[0]};--c2:${md.color[1]}">
                <div class="row between">${modeTag(md)}<span class="players">${icon('users', 13)} ${md.maxPlayers}</span></div>
                <b>${esc(md.label)}</b>
                <p>${esc(md.desc)}</p>
              </button>`
            )
            .join('')}
        </div>
      </section>

      <section class="section">
        <div class="step-title"><span class="n">2</span><h2>Map</h2></div>
        <div class="card stack">
          <div class="row between">
            <div class="segmented">
              <button type="button" data-src="official" class="${form.useWorkshop ? '' : 'active'}">Maps installées</button>
              <button type="button" data-src="workshop" class="${form.useWorkshop ? 'active' : ''}">Workshop Steam</button>
            </div>
            ${m.workshopRecommended && !form.useWorkshop ? `<span class="chip warn">${icon('info', 13)} Ce mode est fait pour une map du Workshop</span>` : ''}
          </div>
          <div id="c-maps"></div>
        </div>
      </section>

      <section class="section">
        <div class="step-title"><span class="n">3</span><h2>Réglages</h2></div>
        <div class="card">
          <div class="form-grid">
            <div class="field full">
              <label for="f-name">Nom du serveur</label>
              <input class="input" id="f-name" maxlength="64" value="${esc(form.name)}" />
              <span class="hint">Affiché dans le navigateur de serveurs et sur le tableau des scores.</span>
            </div>
            <div class="field">
              <label for="f-max">Joueurs maximum</label>
              <div class="range-row">
                <input type="range" id="f-max" min="2" max="64" value="${form.maxPlayers}" />
                <output id="f-max-out">${form.maxPlayers}</output>
              </div>
            </div>
            <div class="field">
              <label for="f-pass">Mot de passe du serveur</label>
              <input class="input" id="f-pass" maxlength="64" value="${esc(form.password)}" placeholder="Laisser vide pour un serveur ouvert" />
            </div>
            <div class="field">
              <label for="f-bots">Bots</label>
              <div class="range-row">
                <input type="range" id="f-bots" min="0" max="20" value="${form.bots.quota}" />
                <output id="f-bots-out">${form.bots.quota}</output>
              </div>
              <span class="hint">Le serveur complète avec des bots jusqu’à ce nombre de joueurs.</span>
            </div>
            <div class="field">
              <label for="f-diff">Difficulté des bots</label>
              <select class="input" id="f-diff">
                ${DIFFICULTIES.map((d, i) => `<option value="${i}" ${form.bots.difficulty === i ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="f-port">Port</label>
              <input class="input" id="f-port" type="number" min="1024" max="65535" value="${form.port}" />
              <span class="hint">27015 par défaut. C’est ce port (UDP) qu’il faut ouvrir sur ta box pour jouer à distance.</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <details class="card advanced" ${form.gslt || form.extraCvars || form.insecure ? 'open' : ''}>
          <summary>Options avancées</summary>
          <div class="form-grid" style="margin-top:16px">
            <div class="field full">
              <label for="f-gslt">Token GSLT (Game Server Login Token)</label>
              <input class="input mono" id="f-gslt" value="${esc(form.gslt)}" placeholder="${store.settings?.defaultGslt ? 'Vide = token par défaut des paramètres' : 'Optionnel'}" />
              <span class="hint">Nécessaire pour que ton serveur soit visible et joignable depuis Internet.
                Crée-le gratuitement sur <a href="${GSLT_URL}" target="_blank" rel="noopener">steamcommunity.com/dev/managegameservers</a> (App ID : <b>730</b>).</span>
            </div>
            <div class="field full">
              <label for="f-cvars">Cvars et commandes personnalisées</label>
              <textarea class="input" id="f-cvars" spellcheck="false" placeholder="mp_maxrounds 16&#10;mp_friendlyfire 1&#10;sv_alltalk 1">${esc(form.extraCvars)}</textarea>
              <span class="hint">Une commande par ligne, exécutées après celles du mode (elles ont donc le dernier mot).</span>
            </div>
            <label class="switch full">
              <span class="txt"><b>Mode -insecure</b><span>Désactive VAC sur ce serveur. Uniquement si un plugin le demande.</span></span>
              <input type="checkbox" id="f-insecure" ${form.insecure ? 'checked' : ''} />
            </label>
          </div>
        </details>
      </section>

      <div class="sticky-actions">
        ${existing ? `<button class="btn btn-danger" id="f-delete" ${isRunningThis() ? 'disabled' : ''}>${icon('trash', 15)} Supprimer</button><span class="spacer"></span>` : ''}
        <a class="btn btn-ghost" href="#/">Annuler</a>
        <button class="btn" id="f-save">${icon('check', 15)} Enregistrer</button>
        <button class="btn btn-primary" id="f-launch">${icon('play', 15)} ${existing ? 'Enregistrer et relancer' : 'Créer et lancer'}</button>
      </div>`;

    bind();
    renderMaps();
  }

  function renderMaps() {
    const box = el.querySelector('#c-maps');
    if (form.useWorkshop) {
      box.innerHTML = `
        <div class="field">
          <label for="f-ws">ID ou lien de la map Workshop</label>
          <input class="input" id="f-ws" value="${esc(form.workshopId)}" placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…" />
          <span class="hint">Trouve une map sur le <a href="${WORKSHOP_BROWSE}" target="_blank" rel="noopener">Workshop CS2</a>, copie le lien de sa page et colle-le ici. Le serveur la télécharge au lancement.</span>
        </div>`;
      box.querySelector('#f-ws').oninput = (e) => {
        const v = e.target.value.trim();
        form.workshopId = (v.match(/[?&]id=(\d+)/) || [])[1] || v.replace(/\D/g, '');
      };
      return;
    }
    if (!maps.maps.length) {
      box.innerHTML = `<p class="muted">Chargement des maps…</p>`;
      return;
    }
    const list = maps.maps.some((x) => x.id === form.map) ? maps.maps : [{ id: form.map, name: form.map, type: '' }, ...maps.maps];
    box.innerHTML = `
      ${maps.fromInstall ? '' : `<div class="callout info">${icon('info')}<div>CS2 n’est pas encore installé : voici les maps officielles habituelles.</div></div>`}
      <div class="maps">
        ${list
          .map(
            (mp) => `<button type="button" class="map-tile ${mp.id === form.map ? 'selected' : ''}" data-map="${esc(mp.id)}">
              <b>${esc(mp.name)}</b><span>${esc(mp.id)}</span></button>`
          )
          .join('')}
      </div>`;
    box.querySelectorAll('[data-map]').forEach(
      (b) =>
        (b.onclick = () => {
          form.map = b.dataset.map;
          box.querySelectorAll('.map-tile').forEach((t) => t.classList.toggle('selected', t === b));
        })
    );
  }

  function bind() {
    const $ = (s) => el.querySelector(s);
    el.querySelectorAll('[data-mode]').forEach(
      (b) =>
        (b.onclick = () => {
          const md = store.modes.find((x) => x.id === b.dataset.mode);
          readInputs();
          form.mode = md.id;
          if (!existing) {
            form.map = md.defaultMap;
            form.maxPlayers = md.maxPlayers;
            form.bots.quota = md.bots;
            form.useWorkshop = Boolean(md.workshopRecommended);
          }
          render();
        })
    );
    el.querySelectorAll('[data-src]').forEach(
      (b) =>
        (b.onclick = () => {
          readInputs();
          form.useWorkshop = b.dataset.src === 'workshop';
          render();
        })
    );
    $('#f-max').oninput = (e) => ($('#f-max-out').textContent = e.target.value);
    $('#f-bots').oninput = (e) => ($('#f-bots-out').textContent = e.target.value);
    $('#f-save').onclick = (e) => busy(e.currentTarget, () => save(false));
    $('#f-launch').onclick = (e) => busy(e.currentTarget, () => save(true));
    const del = $('#f-delete');
    if (del)
      del.onclick = (e) =>
        busy(e.currentTarget, async () => {
          const ok = await confirmDialog({ title: 'Supprimer ce serveur ?', text: `La configuration <b>${esc(existing.name)}</b> sera supprimée.`, ok: 'Supprimer', danger: true });
          if (!ok) return;
          await api.del(`/api/profiles/${existing.id}`);
          toast('Serveur supprimé', 'ok');
          navigate('#/');
        });
  }

  function readInputs() {
    const $ = (s) => el.querySelector(s);
    if (!$('#f-name')) return;
    form.name = $('#f-name').value;
    form.maxPlayers = Number($('#f-max').value);
    form.password = $('#f-pass').value;
    form.bots = { quota: Number($('#f-bots').value), difficulty: Number($('#f-diff').value) };
    form.port = Number($('#f-port').value);
    form.gslt = $('#f-gslt').value.trim();
    form.extraCvars = $('#f-cvars').value;
    form.insecure = $('#f-insecure').checked;
  }

  async function save(launch) {
    readInputs();
    if (form.useWorkshop && !form.workshopId) throw new Error('Indique l’ID ou le lien de la map Workshop.');
    const payload = { ...form, workshopId: form.useWorkshop ? form.workshopId : '' };
    delete payload.useWorkshop;
    delete payload.id;

    const saved = existing ? await api.put(`/api/profiles/${existing.id}`, payload) : await api.post('/api/profiles', payload);
    if (!launch) {
      toast(existing ? 'Modifications enregistrées' : 'Serveur créé', 'ok');
      navigate('#/');
      return;
    }
    const s = store.server;
    const active = s && ['starting', 'running', 'stopping'].includes(s.status);
    if (active && s.profileId === saved.id) {
      await api.post('/api/server/restart');
    } else if (active) {
      const ok = await confirmDialog({
        title: 'Un autre serveur tourne déjà',
        text: `« ${esc(s.profile?.name)} » est en cours d’exécution. L’arrêter pour lancer celui-ci ?`,
        ok: 'Arrêter et lancer',
        danger: true,
      });
      if (!ok) return navigate('#/');
      await api.post('/api/server/stop');
      await api.post('/api/server/start', { profileId: saved.id });
    } else {
      await api.post('/api/server/start', { profileId: saved.id });
    }
    toast('Lancement du serveur…', 'info');
    navigate('#/');
  }

  render();
  loadMaps()
    .then((m) => {
      maps = m;
      renderMaps();
    })
    .catch((e) => toast(e.message, 'err'));
  return null;
}
