const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();

const PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

function pickColor() {
  const used = db.prepare('SELECT color FROM users').all().map((r) => r.color);
  const free = PALETTE.find((c) => !used.includes(c));
  return free || PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Bootstrap the very first admin. Only works while the users table is empty.
router.post('/bootstrap', async (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    return res.status(409).json({ error: 'admin already exists; ask the admin to create your account' });
  }
  const { name, email, password } = req.body || {};
  if (!name || !isValidEmail(email) || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, valid email, and 8+ char password required' });
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), email.trim(), hash, 'admin', PALETTE[0]);
  const user = db.prepare('SELECT id, name, email, role, color FROM users WHERE id = ?').get(info.lastInsertRowid);
  const days = Number(process.env.SESSION_DAYS) || 30;
  setSessionCookie(res, signSession(user, process.env.JWT_SECRET, days), days);
  res.json({ user });
});

router.get('/status', (_req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.json({ initialized: count > 0 });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  const ok = row && await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid email or password' });
  const user = { id: row.id, name: row.name, email: row.email, role: row.role, color: row.color };
  const days = Number(process.env.SESSION_DAYS) || 30;
  setSessionCookie(res, signSession(user, process.env.JWT_SECRET, days), days);
  res.json({ user });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'current_password and 8+ char new_password required' });
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const ok = await bcrypt.compare(current_password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

module.exports = { router, pickColor };
