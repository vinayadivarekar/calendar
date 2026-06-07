const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function isIsoLike(s) {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s));
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    start: row.start_at,
    end: row.end_at,
    all_day: !!row.all_day,
    rrule: row.rrule,
    reminder_minutes: row.reminder_minutes,
    created_by: {
      id: row.created_by,
      name: row.creator_name,
      color: row.creator_color,
    },
  };
}

const SELECT_WITH_CREATOR = `
  SELECT e.*, u.name AS creator_name, u.color AS creator_color
  FROM events e
  JOIN users u ON u.id = e.created_by
`;

// All signed-in users see all events.
router.get('/', requireAuth, (req, res) => {
  const { from, to } = req.query;
  let sql = SELECT_WITH_CREATOR;
  const params = [];
  const where = [];
  // Filter out plainly-out-of-window non-recurring events; recurring ones
  // are always returned and expanded on the client.
  if (from && isIsoLike(from)) {
    where.push('(e.rrule IS NOT NULL OR e.start_at >= ? OR (e.end_at IS NOT NULL AND e.end_at >= ?))');
    params.push(from, from);
  }
  if (to && isIsoLike(to)) {
    where.push('(e.rrule IS NOT NULL OR e.start_at <= ?)');
    params.push(to);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY e.start_at ASC';
  const rows = db.prepare(sql).all(...params);
  res.json({ events: rows.map(serialize) });
});

router.post('/', requireAuth, (req, res) => {
  const { title, description, location, start, end, all_day, rrule, reminder_minutes } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  if (!isIsoLike(start)) return res.status(400).json({ error: 'start must be an ISO date/datetime' });
  if (end && !isIsoLike(end)) return res.status(400).json({ error: 'end must be an ISO date/datetime' });

  const info = db.prepare(`
    INSERT INTO events
      (title, description, location, start_at, end_at, all_day, rrule, reminder_minutes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    description?.trim() || null,
    location?.trim() || null,
    start,
    end || null,
    toBool(all_day) ? 1 : 0,
    typeof rrule === 'string' && rrule.trim() ? rrule.trim() : null,
    Number.isFinite(Number(reminder_minutes)) ? Number(reminder_minutes) : null,
    req.user.id,
  );
  const row = db.prepare(SELECT_WITH_CREATOR + ' WHERE e.id = ?').get(info.lastInsertRowid);
  res.status(201).json({ event: serialize(row) });
});

router.patch('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'event not found' });
  if (row.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'only the creator or an admin can edit this event' });
  }

  const { title, description, location, start, end, all_day, rrule, reminder_minutes } = req.body || {};
  const fields = [];
  const values = [];
  if (typeof title === 'string' && title.trim()) { fields.push('title = ?'); values.push(title.trim()); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description?.trim() || null); }
  if (location !== undefined) { fields.push('location = ?'); values.push(location?.trim() || null); }
  if (start !== undefined) {
    if (!isIsoLike(start)) return res.status(400).json({ error: 'start must be ISO' });
    fields.push('start_at = ?'); values.push(start);
  }
  if (end !== undefined) {
    if (end !== null && !isIsoLike(end)) return res.status(400).json({ error: 'end must be ISO or null' });
    fields.push('end_at = ?'); values.push(end || null);
  }
  if (all_day !== undefined) { fields.push('all_day = ?'); values.push(toBool(all_day) ? 1 : 0); }
  if (rrule !== undefined) {
    fields.push('rrule = ?');
    values.push(typeof rrule === 'string' && rrule.trim() ? rrule.trim() : null);
  }
  if (reminder_minutes !== undefined) {
    fields.push('reminder_minutes = ?');
    values.push(Number.isFinite(Number(reminder_minutes)) ? Number(reminder_minutes) : null);
  }
  if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare(SELECT_WITH_CREATOR + ' WHERE e.id = ?').get(id);
  res.json({ event: serialize(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT created_by FROM events WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'event not found' });
  if (row.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'only the creator or an admin can delete this event' });
  }
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
