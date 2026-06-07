# Family Calendar

A shared calendar your whole family can sign in to from any device. The admin creates accounts for each family member, everyone sees everyone's events (color-coded), and the app runs as a single Node.js process backed by a SQLite file — so it is easy to install on any small server.

## Features

- Day / week / month / agenda views (FullCalendar)
- Per-family-member color coding
- Recurring events (daily, weekly, biweekly, monthly, yearly)
- In-browser reminders (5 min / 15 min / 1 hour / 1 day before)
- Admin-only account creation; first registrant becomes the admin
- Admin can reset passwords, change roles, or remove members
- Each member can change their own password
- Mobile-friendly responsive layout

---

## Quick start (local)

You need **Node.js 22.5 or newer** (this app uses the built-in `node:sqlite` module, which avoids any native compile step during `npm install`).

```bash
git clone <your-repo-url> family-calendar
cd family-calendar
npm install
cp .env.example .env

# Generate a strong JWT secret and paste it into .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm start
```

Open `http://localhost:3000` in your browser. The first signup screen creates the **admin** account — that is you. After that, use **Manage family** to add accounts for everyone else.

---

## Deploying to a server

These steps work on any Linux VPS (DigitalOcean, Hetzner, Linode, an old Raspberry Pi, etc.).

### 1. Install prerequisites

```bash
# Ubuntu / Debian example
sudo apt update
sudo apt install -y nodejs npm nginx
sudo npm install -g pm2
```

If your distro's Node is older than 22.5, install a newer one with `nvm`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 22
```

### 2. Copy the code and install

```bash
git clone <your-repo-url> /opt/family-calendar
cd /opt/family-calendar
npm install --production
cp .env.example .env
nano .env   # set JWT_SECRET, COOKIE_SECURE=true, HOST=127.0.0.1
```

### 3. Run it as a service with PM2

```bash
pm2 start server.js --name family-calendar
pm2 save
pm2 startup        # follow the printed command so it survives reboots
```

### 4. Front it with nginx + HTTPS

Create `/etc/nginx/sites-available/family-calendar`:

```nginx
server {
    listen 80;
    server_name calendar.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and get a certificate:

```bash
sudo ln -s /etc/nginx/sites-available/family-calendar /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d calendar.example.com
```

Once HTTPS is live, set `COOKIE_SECURE=true` in `.env` and `pm2 restart family-calendar`.

### 5. Onboard the family

1. Visit `https://calendar.example.com` — you'll see **Create the admin account**. Sign up with your details.
2. Click **Manage family** → fill in name, email, a temporary password, and a color for each family member.
3. Share each person's email + temporary password with them privately. They sign in and use **Change my password** to set their own.

---

## Environment variables

| Variable        | Purpose                                                                              | Default                |
|-----------------|--------------------------------------------------------------------------------------|------------------------|
| `PORT`          | Port to bind on                                                                      | `3000`                 |
| `HOST`          | Bind address. `127.0.0.1` behind nginx; `0.0.0.0` to accept direct LAN connections   | `0.0.0.0`              |
| `JWT_SECRET`    | **Required.** Long random string used to sign session cookies                        | _(none — must be set)_ |
| `COOKIE_SECURE` | `true` only when serving over HTTPS                                                  | `false`                |
| `DB_PATH`       | Path to the SQLite database file (auto-created)                                      | `./data/calendar.db`   |
| `SESSION_DAYS`  | How long a sign-in stays valid                                                       | `30`                   |

---

## Backups

The entire calendar is one SQLite file at `DB_PATH` (default `./data/calendar.db`). Back it up with a nightly cron job:

```bash
0 3 * * * /usr/bin/sqlite3 /opt/family-calendar/data/calendar.db ".backup '/opt/family-calendar/backups/calendar-$(date +\%F).db'"
```

Restore by stopping the service and copying a backup over `calendar.db`.

---

## Reminders

Reminders use the browser's built-in notification API. Each user clicks **🔔 Reminders** once to grant permission. Reminders fire when the calendar tab is open — for true push notifications even when the tab is closed, you'd need to add a service worker (future enhancement).

---

## Tech stack

- Node.js 22.5+ + Express
- `node:sqlite` (built-in single-file embedded database — no native compile)
- `bcryptjs` for password hashing, JWT in httpOnly cookie for sessions
- FullCalendar 6 + rrule.js (loaded from CDN)
- Vanilla HTML / CSS / JS — no build step

---

## License

MIT — use it for your family.
