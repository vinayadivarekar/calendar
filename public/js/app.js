(async function () {
  // --- Auth gate -----------------------------------------------------------
  let me;
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) { window.location.href = '/login.html'; return; }
    me = (await r.json()).user;
  } catch (_e) {
    window.location.href = '/login.html'; return;
  }
  document.getElementById('who').textContent = `Signed in as ${me.name}`;
  if (me.role === 'admin') document.getElementById('adminLink').classList.remove('hidden');

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // --- Family roster legend ------------------------------------------------
  const usersRes = await fetch('/api/users');
  const users = (await usersRes.json()).users;
  const familyList = document.getElementById('familyList');
  familyList.innerHTML = '';
  for (const u of users) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${u.color}"></span>${escapeHtml(u.name)}`;
    familyList.appendChild(li);
  }

  // --- Event store + recurrence expansion ----------------------------------
  let rawEvents = [];

  async function loadEvents(fetchInfo) {
    const url = new URL('/api/events', window.location.origin);
    if (fetchInfo?.startStr) url.searchParams.set('from', fetchInfo.startStr);
    if (fetchInfo?.endStr) url.searchParams.set('to', fetchInfo.endStr);
    const res = await fetch(url);
    const body = await res.json();
    rawEvents = body.events;
    return expandForRange(rawEvents, fetchInfo.start, fetchInfo.end);
  }

  function expandForRange(events, rangeStart, rangeEnd) {
    const out = [];
    for (const e of events) {
      const base = {
        id: String(e.id),
        title: e.title,
        backgroundColor: e.created_by.color,
        borderColor: e.created_by.color,
        allDay: e.all_day,
        extendedProps: {
          description: e.description,
          location: e.location,
          rrule: e.rrule,
          reminder_minutes: e.reminder_minutes,
          created_by: e.created_by,
          original: e,
        },
      };
      if (!e.rrule) {
        out.push({ ...base, start: e.start, end: e.end || undefined });
        continue;
      }
      try {
        const dtstart = new Date(e.start);
        const rule = new rrule.RRule({
          ...rrule.RRule.parseString(e.rrule),
          dtstart,
        });
        const durMs = e.end ? new Date(e.end) - dtstart : 0;
        const occs = rule.between(rangeStart, rangeEnd, true);
        for (const occ of occs) {
          out.push({
            ...base,
            id: `${e.id}@${occ.toISOString()}`,
            start: occ.toISOString(),
            end: durMs > 0 ? new Date(occ.getTime() + durMs).toISOString() : undefined,
          });
        }
      } catch (err) {
        console.warn('Bad rrule for event', e.id, err);
        out.push({ ...base, start: e.start, end: e.end || undefined });
      }
    }
    return out;
  }

  // --- Calendar ------------------------------------------------------------
  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
    },
    height: 'auto',
    nowIndicator: true,
    selectable: true,
    selectMirror: true,
    editable: false,
    weekNumbers: true,
    weekNumberCalculation: 'ISO',
    weekText: 'W',
    events: (fetchInfo, success, failure) => {
      loadEvents(fetchInfo).then(success).catch(failure);
    },
    select: (info) => openCreateDialog(info.start, info.end, info.allDay),
    eventClick: (info) => openEditDialog(info.event.extendedProps.original),
  });
  calendar.render();

  // --- Event dialog --------------------------------------------------------
  const dialog = document.getElementById('eventDialog');
  const form = document.getElementById('eventForm');
  const errorEl = document.getElementById('eventError');
  const titleEl = document.getElementById('eventDialogTitle');
  const deleteBtn = document.getElementById('deleteEventBtn');
  const cancelBtn = document.getElementById('cancelEventBtn');
  const saveBtn = document.getElementById('saveEventBtn');
  let editing = null;

  document.getElementById('newEventBtn').addEventListener('click', () => openCreateDialog(new Date(), null, false));
  cancelBtn.addEventListener('click', () => dialog.close());

  function openCreateDialog(start, end, allDay) {
    editing = null;
    titleEl.textContent = 'New event';
    deleteBtn.classList.add('hidden');
    saveBtn.disabled = false;
    form.reset();
    form.title.value = '';
    form.all_day.checked = allDay;
    form.start.value = toLocalInput(start);
    if (end) form.end.value = toLocalInput(end);
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openEditDialog(ev) {
    editing = ev;
    titleEl.textContent = 'Edit event';
    const canModify = ev.created_by.id === me.id || me.role === 'admin';
    saveBtn.disabled = !canModify;
    deleteBtn.classList.toggle('hidden', !canModify);
    form.title.value = ev.title;
    form.start.value = toLocalInput(new Date(ev.start));
    form.end.value = ev.end ? toLocalInput(new Date(ev.end)) : '';
    form.all_day.checked = !!ev.all_day;
    form.location.value = ev.location || '';
    form.description.value = ev.description || '';
    form.repeat.value = ev.rrule || '';
    form.reminder_minutes.value = ev.reminder_minutes != null ? String(ev.reminder_minutes) : '';
    errorEl.hidden = true;
    if (!canModify) {
      errorEl.textContent = `Only ${ev.created_by.name} or an admin can change this event.`;
      errorEl.hidden = false;
    }
    dialog.showModal();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      title: data.title,
      start: new Date(data.start).toISOString(),
      end: data.end ? new Date(data.end).toISOString() : null,
      all_day: !!data.all_day,
      location: data.location || null,
      description: data.description || null,
      rrule: data.repeat || null,
      reminder_minutes: data.reminder_minutes === '' ? null : Number(data.reminder_minutes),
    };
    try {
      const url = editing ? `/api/events/${editing.id}` : '/api/events';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        errorEl.textContent = body.error || 'Could not save event.';
        errorEl.hidden = false;
        return;
      }
      dialog.close();
      calendar.refetchEvents();
    } catch (_e) {
      errorEl.textContent = 'Could not reach the server.';
      errorEl.hidden = false;
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editing) return;
    if (!confirm(`Delete "${editing.title}"?`)) return;
    const res = await fetch(`/api/events/${editing.id}`, { method: 'DELETE' });
    if (res.ok) {
      dialog.close();
      calendar.refetchEvents();
    } else {
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = body.error || 'Could not delete event.';
      errorEl.hidden = false;
    }
  });

  // --- Browser reminders ---------------------------------------------------
  const notifyBtn = document.getElementById('notifyBtn');
  notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications.');
      return;
    }
    const perm = await Notification.requestPermission();
    notifyBtn.textContent = perm === 'granted' ? '🔔 Reminders on' : '🔔 Reminders';
  });
  if ('Notification' in window && Notification.permission === 'granted') {
    notifyBtn.textContent = '🔔 Reminders on';
  }

  const fired = new Set();
  setInterval(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    const horizonStart = new Date(now);
    const horizonEnd = new Date(now + 24 * 60 * 60 * 1000);
    const upcoming = expandForRange(rawEvents, horizonStart, horizonEnd);
    for (const ev of upcoming) {
      const mins = ev.extendedProps.reminder_minutes;
      if (mins == null) continue;
      const fireAt = new Date(ev.start).getTime() - mins * 60_000;
      const delta = fireAt - now;
      if (delta > -30_000 && delta <= 30_000) {
        const key = `${ev.id}|${fireAt}`;
        if (fired.has(key)) continue;
        fired.add(key);
        new Notification(ev.title, {
          body: ev.extendedProps.location
            ? `${formatTime(ev.start)} • ${ev.extendedProps.location}`
            : formatTime(ev.start),
        });
      }
    }
  }, 30_000);

  // --- Helpers -------------------------------------------------------------
  function toLocalInput(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }
  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();
