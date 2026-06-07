require('dotenv').config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-to-a-long-random-string') {
  console.error('FATAL: JWT_SECRET is not set. Copy .env.example to .env and set a strong random value.');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { loadUser } = require('./middleware/auth');
const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const eventsRouter = require('./routes/events');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(loadUser);

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/events', eventsRouter);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Family calendar listening on http://${host}:${port}`);
});
