(async function () {
  const titleEl = document.getElementById('title');
  const subtitleEl = document.getElementById('subtitle');
  const nameLabel = document.getElementById('nameLabel');
  const submitBtn = document.getElementById('submit');
  const form = document.getElementById('form');
  const errorEl = document.getElementById('error');
  const hintEl = document.getElementById('hint');

  // Detect bootstrap (no users yet) so the first visitor becomes admin.
  let mode = 'login';
  try {
    const r = await fetch('/api/auth/status');
    const j = await r.json();
    if (!j.initialized) {
      mode = 'bootstrap';
      titleEl.textContent = 'Create the admin account';
      subtitleEl.textContent = 'You are the first to sign up — you will be the family calendar admin.';
      nameLabel.classList.remove('hidden');
      nameLabel.querySelector('input').required = true;
      submitBtn.textContent = 'Create admin account';
      form.querySelector('input[name="password"]').autocomplete = 'new-password';
      hintEl.textContent = 'Choose a password of at least 8 characters.';
    } else {
      hintEl.textContent = 'No account yet? Ask the family admin to create one for you.';
    }
  } catch (_e) {
    errorEl.textContent = 'Could not reach the server.';
    errorEl.hidden = false;
    return;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    const url = mode === 'bootstrap' ? '/api/auth/bootstrap' : '/api/auth/login';
    submitBtn.disabled = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) {
        errorEl.textContent = body.error || 'Something went wrong.';
        errorEl.hidden = false;
        return;
      }
      window.location.href = '/';
    } catch (_e) {
      errorEl.textContent = 'Could not reach the server.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
