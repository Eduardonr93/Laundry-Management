import { post } from '../api.js';
import { afterLogin, navigate } from '../app.js';
import { $, html, icon, render } from '../ui.js';

export function loginView(el) {
  render(el, html`
    <div class="login">
      <form class="login-card" novalidate>
        <div class="login-brand">
          <span class="brand-mark">${icon('washer')}</span>
          <div>
            <h1>Lavandería</h1>
            <p class="muted">Encargos, autoservicio y caja</p>
          </div>
        </div>
        <label class="field">Usuario
          <input name="username" autocomplete="username" autocapitalize="none" required>
        </label>
        <label class="field">Contraseña
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
    </div>`);

  const form = $('form', el);
  const errorEl = $('.form-error', el);
  $('input', form).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      const { user } = await post('/auth/login', values);
      await afterLogin(user);
      navigate('#/');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
}
