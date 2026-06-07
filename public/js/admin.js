(async function () {
  let me;
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) { window.location.href = '/login.html'; return; }
    me = (await r.json()).user;
  } catch (_e) {
    window.location.href = '/login.html'; return;
  }
  if (me.role !== 'admin') { window.location.href = '/'; return; }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  const createForm = document.getElementById('createForm');
  const createError = document.getElementById('createError');
  const usersBody = document.getElementById('usersBody');

  async function loadUsers() {
    const r = await fetch('/api/users');
    const j = await r.json();
    usersBody.innerHTML = '';
    for (const u of j.users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${u.role}</td>
        <td><span class="swatch" style="background:${u.color}"></span> ${u.color}</td>
        <td class="actions">
          <button class="btn ghost small" data-action="reset" data-id="${u.id}">Reset password</button>
          ${u.id === me.id ? '' : `<button class="btn danger small" data-action="delete" data-id="${u.id}" data-name="${escapeHtml(u.name)}">Remove</button>`}
        </td>`;
      usersBody.appendChild(tr);
    }
  }

  usersBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'delete') {
      if (!confirm(`Remove ${btn.dataset.name}? Their events will also be deleted.`)) return;
      const r = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        alert(b.error || 'Could not remove user.');
        return;
      }
      loadUsers();
    } else if (btn.dataset.action === 'reset') {
      const pw = prompt('Enter a new temporary password (8+ characters):');
      if (!pw) return;
      const r = await fetch(`/api/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: pw }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        alert(b.error || 'Could not reset password.');
      } else {
        alert('Password reset. Share the new password with them securely.');
      }
    }
  });

  createForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    createError.hidden = true;
    const data = Object.fromEntries(new FormData(createForm).entries());
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    if (!r.ok) {
      createError.textContent = body.error || 'Could not create user.';
      createError.hidden = false;
      return;
    }
    createForm.reset();
    createForm.color.value = '#3b82f6';
    loadUsers();
  });

  const passwordForm = document.getElementById('passwordForm');
  const passwordStatus = document.getElementById('passwordStatus');
  passwordForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(passwordForm).entries());
    const r = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    passwordStatus.textContent = r.ok ? 'Password updated.' : (body.error || 'Could not update password.');
    if (r.ok) passwordForm.reset();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  loadUsers();
})();
