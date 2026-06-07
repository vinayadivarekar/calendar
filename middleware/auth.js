const jwt = require('jsonwebtoken');
const db = require('../db');

const COOKIE_NAME = 'fc_session';

function signSession(user, secret, days) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    secret,
    { expiresIn: `${days}d` }
  );
}

function setSessionCookie(res, token, days) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare(
      'SELECT id, name, email, role, color FROM users WHERE id = ?'
    ).get(payload.sub);
    if (user) req.user = user;
  } catch (_e) {
    // invalid/expired token — treat as anonymous
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

module.exports = {
  COOKIE_NAME,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  loadUser,
  requireAuth,
  requireAdmin,
};
