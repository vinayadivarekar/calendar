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

  const resetDialog = document.getElementById('resetDialog');
  const resetForm = document.getElementById('resetForm');
  const resetUserName = document.getElementById('resetUserName');
  const resetError = document.getElementById('resetError');
  let resetUserId = null;

  const confirmDialog = document.getElementById('confirmDialog');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmError = document.getElementById('confirmError');
  const confirmOkBtn = document.getElementById('confirmOkBtn');

  document.getElementById('resetCancelBtn').addEventListener('click', () => resetDialog.close());
  document.getElementById('confirmCancelBtn').addEventListener('click', () => confirmDialog.close());

  async function loadUsers() {
    const r = await fetch('/api/users');
    if (!r.ok) { toast('Could not load users.', 'error'); return; }
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
          <button class="btn ghost small" data-action="reset" data-id="${u.id}" data-name="${escapeHtml(u.name)}">Reset password</button>
          ${u.id === me.id ? '' : `<button class="btn danger small" data-action="delete" data-id="${u.id}" data-name="${escapeHtml(u.name)}">Remove</button>`}
        </td>`;
      usersBody.appendChild(tr);
    }
  }

  usersBody.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const name = btn.dataset.name || 'this user';

    if (btn.dataset.action === 'delete') {
      askConfirm({
        title: 'Remove family member',
        message: `Remove ${name}? Their events will also be deleted.`,
        okText: 'Remove',
        okClass: 'danger',
        onConfirm: async () => {
          const r = await fetch(`/api/users/${id}`, { method: 'DELETE' });
          if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.error || `Could not remove user (HTTP ${r.status})`);
          }
          await loadUsers();
          toast(`${name} removed.`, 'success');
        },
      });
    } else if (btn.dataset.action === 'reset') {
      resetUserId = id;
      resetUserName.textContent = name;
      resetForm.reset();
      resetError.hidden = true;
      resetDialog.showModal();
    }
  });

  resetForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    resetError.hidden = true;
    const data = Object.fromEntries(new FormData(resetForm).entries());
    const r = await fetch(`/api/users/${resetUserId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      resetError.textContent = body.error || `Could not reset password (HTTP ${r.status}).`;
      resetError.hidden = false;
      return;
    }
    resetDialog.close();
    toast(`Password reset for ${resetUserName.textContent}. Share it with them privately.`, 'success');
  });

  function askConfirm({ title, message, okText = 'Confirm', okClass = 'danger', onConfirm }) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmError.hidden = true;
    confirmOkBtn.textContent = okText;
    confirmOkBtn.className = `btn ${okClass}`;
    confirmOkBtn.onclick = async () => {
      confirmError.hidden = true;
      confirmOkBtn.disabled = true;
      try {
        await onConfirm();
        confirmDialog.close();
      } catch (e) {
        confirmError.textContent = e.message || String(e);
        confirmError.hidden = false;
      } finally {
        confirmOkBtn.disabled = false;
      }
    };
    confirmDialog.showModal();
  }

  createForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    createError.hidden = true;
    const data = Object.fromEntries(new FormData(createForm).entries());
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      createError.textContent = body.error || `Could not create user (HTTP ${r.status}).`;
      createError.hidden = false;
      return;
    }
    createForm.reset();
    createForm.color.value = '#3b82f6';
    await loadUsers();
    toast(`Account created for ${body.user.name}.`, 'success');
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
    const body = await r.json().catch(() => ({}));
    if (r.ok) {
      passwordStatus.textContent = 'Password updated.';
      passwordForm.reset();
      toast('Your password was updated.', 'success');
    } else {
      passwordStatus.textContent = body.error || 'Could not update password.';
    }
  });

  let toastTimer = null;
  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${kind}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  loadUsers();
})();
