const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { pickColor } = require('./auth');

const router = express.Router();

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Anyone signed in can see the family roster (needed for color legend).
router.get('/', requireAuth, (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, email, role, color FROM users ORDER BY name COLLATE NOCASE'
  ).all();
  res.json({ users: rows });
});

// Admin: create a new family member account.
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role, color } = req.body || {};
  if (!name || !isValidEmail(email) || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, valid email, and 8+ char password required' });
  }
  const finalRole = role === 'admin' ? 'admin' : 'member';
  const finalColor = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : pickColor();
  const hash = await bcrypt.hash(password, 12);
  try {
    const info = db.prepare(
      'INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), email.trim(), hash, finalRole, finalColor);
    const user = db.prepare(
      'SELECT id, name, email, role, color FROM users WHERE id = ?'
    ).get(info.lastInsertRowid);
    res.status(201).json({ user });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'a user with that email already exists' });
    }
    throw e;
  }
});

// Admin: update a user's name, role, or color.
router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'user not found' });

  const { name, role, color } = req.body || {};
  const fields = [];
  const values = [];
  if (typeof name === 'string' && name.trim()) {
    fields.push('name = ?'); values.push(name.trim());
  }
  if (role === 'admin' || role === 'member') {
    if (existing.role === 'admin' && role === 'member') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
      if (admins <= 1) return res.status(400).json({ error: 'cannot demote the last admin' });
    }
    fields.push('role = ?'); values.push(role);
  }
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
    fields.push('color = ?'); values.push(color);
  }
  if (!fields.length) return res.status(400).json({ error: 'no valid fields to update' });
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const user = db.prepare('SELECT id, name, email, role, color FROM users WHERE id = ?').get(id);
  res.json({ user });
});

// Admin: reset another user's password.
router.post('/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: '8+ char new_password required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'user not found' });
  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  res.json({ ok: true });
});

// Admin: delete a user (their events cascade-delete).
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'you cannot delete your own account' });
  const existing = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'user not found' });
  if (existing.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: 'cannot delete the last admin' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
