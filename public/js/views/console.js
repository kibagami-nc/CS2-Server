import { api } from '../api.js';
import { esc, icon, statusPill, busy } from '../ui.js';

const QUICK = ['status', 'mp_restartgame 1', 'mp_warmup_end', 'bot_add', 'bot_kick', 'mp_pause_match', 'mp_unpause_match', 'maps *'];
const MAX_NODES = 3000;
const history = [];

function lineClass(line) {
  if (line.startsWith('[panel]')) return 'panel';
  if (line.startsWith('] ')) return 'cmd';
  if (/\b(error|failed|fatal|could not|couldn't)\b/i.test(line)) return 'err';
  if (/\bwarn(ing)?\b/i.test(line)) return 'warn';
  if (/\bsay(_team)?\b|"chat"|\[ALL\]|\[CT\]|\[T\]/i.test(line)) return 'chat';
  return '';
}

export function mount(el, { store, on }) {
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Console</h1>
        <p class="sub" id="c-sub"></p>
      </div>
    </div>
    <div class="card console-card">
      <div class="console-toolbar">
        <div class="input-group" style="flex:1;max-width:300px">
          <input class="input" id="c-filter" placeholder="Filtrer les lignes…" />
        </div>
        <label class="row small muted" style="cursor:pointer"><input type="checkbox" id="c-auto" checked /> Défilement auto</label>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" id="c-clear">${icon('trash', 14)} Vider l’affichage</button>
      </div>
      <div class="console" id="c-out" tabindex="0"></div>
      <div>
        <div class="console-toolbar" style="border-bottom:0;border-top:1px solid var(--border)">
          <div class="chips">${QUICK.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        </div>
        <form class="console-input" id="c-form" autocomplete="off">
          <span class="prompt">›</span>
          <input class="input" id="c-cmd" placeholder="Commande serveur (ex : changelevel de_inferno)" spellcheck="false" />
          <button class="btn btn-primary" id="c-send">Envoyer</button>
        </form>
      </div>
    </div>`;

  const out = el.querySelector('#c-out');
  const filterInput = el.querySelector('#c-filter');
  const auto = el.querySelector('#c-auto');
  const cmd = el.querySelector('#c-cmd');
  let filter = '';
  let histIndex = history.length;

  const matches = (line) => !filter || line.toLowerCase().includes(filter);

  function append(lines) {
    const frag = document.createDocumentFragment();
    for (const line of lines) {
      if (!matches(line)) continue;
      const div = document.createElement('div');
      div.className = `l ${lineClass(line)}`;
      div.textContent = line;
      frag.appendChild(div);
    }
    out.appendChild(frag);
    while (out.childNodes.length > MAX_NODES) out.firstChild.remove();
    if (auto.checked) out.scrollTop = out.scrollHeight;
  }

  function renderAll() {
    out.innerHTML = '';
    if (!store.console.length) {
      out.innerHTML = '<div class="l muted">La console est vide. Lance un serveur pour voir ce qu’il raconte.</div>';
      return;
    }
    append(store.console);
  }

  function renderSub() {
    const s = store.server;
    el.querySelector('#c-sub').innerHTML = s?.profile
      ? `${statusPill(s.status)} &nbsp;${esc(s.profile.name)} — port ${s.port || s.profile.port}`
      : 'Aucun serveur lancé.';
    const active = s && ['starting', 'running'].includes(s.status);
    cmd.disabled = !active;
    el.querySelector('#c-send').disabled = !active;
    cmd.placeholder = active ? 'Commande serveur (ex : changelevel de_inferno)' : 'Le serveur doit être lancé pour envoyer des commandes';
  }

  async function send(command) {
    const c = command.trim();
    if (!c) return;
    if (history[history.length - 1] !== c) history.push(c);
    if (history.length > 100) history.shift();
    histIndex = history.length;
    await api.post('/api/server/rcon', { command: c });
  }

  el.querySelector('#c-form').onsubmit = (e) => {
    e.preventDefault();
    const value = cmd.value;
    cmd.value = '';
    busy(el.querySelector('#c-send'), () => send(value)).then(() => cmd.focus());
  };
  cmd.onkeydown = (e) => {
    if (e.key === 'ArrowUp' && histIndex > 0) {
      histIndex -= 1;
      cmd.value = history[histIndex];
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      histIndex = Math.min(history.length, histIndex + 1);
      cmd.value = history[histIndex] || '';
      e.preventDefault();
    }
  };
  el.querySelectorAll('[data-q]').forEach(
    (b) =>
      (b.onclick = () => {
        if (cmd.disabled) return;
        busy(b, () => send(b.dataset.q));
      })
  );
  filterInput.oninput = () => {
    filter = filterInput.value.trim().toLowerCase();
    renderAll();
  };
  el.querySelector('#c-clear').onclick = () => {
    out.innerHTML = '';
  };

  renderAll();
  renderSub();
  if (!cmd.disabled) cmd.focus();

  const offs = [
    on('console', (lines) => {
      if (out.querySelector('.muted') && out.childNodes.length === 1) out.innerHTML = '';
      append(lines);
    }),
    on('console:reset', renderAll),
    on('server', renderSub),
  ];
  return { destroy: () => offs.forEach((off) => off()) };
}
