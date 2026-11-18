import { api } from './api.js';
import { esc } from './ui.js';

/** Écran de connexion, ou de création du mot de passe au premier lancement. */
export function showAuth(setupRequired, onSuccess) {
  const root = document.getElementById('auth');
  document.getElementById('app').hidden = true;
  root.hidden = false;
  root.innerHTML = `
    <div class="auth">
      <form class="card auth-card" autocomplete="on">
        <div class="brand"><img src="/img/logo.svg" alt="" /><div><b>CS2 Home Panel</b></div></div>
        <p>${
          setupRequired
            ? 'Bienvenue ! Choisis le mot de passe qui protégera ton panel.'
            : 'Connecte-toi pour gérer ton serveur.'
        }</p>
        <div class="field">
          <label for="pw">Mot de passe</label>
          <input class="input" id="pw" type="password" required minlength="6"
            autocomplete="${setupRequired ? 'new-password' : 'current-password'}" />
        </div>
        ${
          setupRequired
            ? `<div class="field"><label for="pw2">Confirmation</label>
               <input class="input" id="pw2" type="password" required minlength="6" autocomplete="new-password" /></div>`
            : ''
        }
        <div class="callout err" id="auth-err" hidden></div>
        <button class="btn btn-primary btn-lg" type="submit">${setupRequired ? 'Créer le mot de passe' : 'Se connecter'}</button>
      </form>
    </div>`;

  const form = root.querySelector('form');
  const err = root.querySelector('#auth-err');
  root.querySelector('#pw').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const password = root.querySelector('#pw').value;
    try {
      if (setupRequired) {
        if (password !== root.querySelector('#pw2').value) throw new Error('Les deux mots de passe ne correspondent pas.');
        await api.post('/api/auth/setup', { password });
      } else {
        await api.post('/api/auth/login', { password });
      }
      root.hidden = true;
      root.innerHTML = '';
      onSuccess();
    } catch (ex) {
      err.innerHTML = esc(ex.message);
      err.hidden = false;
    }
  });
}
