# Deploying Cutline · Girlfriend Edition on Ubuntu 24.04 (DigitalOcean)

This app is a React frontend + a tiny Node server. The Node server does two jobs:
1. Serves the built website.
2. Proxies the AI requests to Anthropic **using a key that stays on the server** (the browser
   never sees it). This is required — you cannot call the Anthropic API directly from a browser.

What you need:
- A DigitalOcean droplet running Ubuntu 24.04 (x64). You have this.
- An Anthropic API key with credits → https://console.anthropic.com  (paid, usage-billed).
- (Optional) a domain name pointed at the droplet's IP, if you want HTTPS.

Throughout, replace `YOUR_DROPLET_IP` and `yourdomain.com` with your real values.

---

## 1. Get your Anthropic API key
Sign in at https://console.anthropic.com → API keys → create one → copy it (starts with `sk-ant-`).
Add a little credit under Billing. Check the current model names at
https://docs.claude.com/en/docs/about-claude/models (the app defaults to `claude-sonnet-4-6`).

## 2. Upload the project to the droplet
From your own computer, in the folder where `cutline-gf-edition.tar.gz` downloaded:

```bash
scp cutline-gf-edition.tar.gz root@YOUR_DROPLET_IP:/root/
```

Then SSH in:

```bash
ssh root@YOUR_DROPLET_IP
```

Unpack into the web directory:

```bash
mkdir -p /var/www
tar xzf /root/cutline-gf-edition.tar.gz -C /var/www
mv /var/www/cutline-deploy /var/www/cutline
cd /var/www/cutline
```

## 3. Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v        # should print v20.x
```

## 4. Install dependencies and build the site
```bash
cd /var/www/cutline
npm install
npm run build        # creates the dist/ folder
```

## 5. Add your API key
```bash
cp .env.example .env
nano .env
```
Set `ANTHROPIC_API_KEY=` to your real key, pick a model for `ANTHROPIC_MODEL`, save (Ctrl+O, Enter, Ctrl+X).

Quick test that it runs:
```bash
npm start
# visit http://YOUR_DROPLET_IP:3000  (it won't be reachable yet if the firewall blocks 3000 —
# that's fine, we'll put Nginx in front next). Press Ctrl+C to stop.
```

## 6. Run it as a service (auto-starts, survives reboots)
```bash
chown -R www-data:www-data /var/www/cutline
sudo nano /etc/systemd/system/cutline.service
```
Paste:

```ini
[Unit]
Description=Cutline GF Edition
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/cutline
EnvironmentFile=/var/www/cutline/.env
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start it:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cutline
sudo systemctl status cutline      # should say "active (running)"
```
(If `ExecStart` errors, run `which node` and use that path.)

## 7. Put Nginx in front (port 80)
```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/cutline
```
Paste (use your domain, or just the droplet IP if you have no domain):

```nginx
server {
    listen 80;
    server_name yourdomain.com YOUR_DROPLET_IP;

    client_max_body_size 25M;   # screenshots are uploaded as base64; don't cut them off

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

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/cutline /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t           # should say "syntax is ok"
sudo systemctl reload nginx
```

## 8. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

Now open **http://YOUR_DROPLET_IP** (or http://yourdomain.com) in a browser. The app should load,
and the Variant Lab should work end-to-end (it calls your server, which calls Anthropic with your key).

## 9. (Optional) HTTPS — only if you have a domain
Point an A record for `yourdomain.com` at `YOUR_DROPLET_IP`, then:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```
Certbot edits your Nginx config for TLS and auto-renews. Visit https://yourdomain.com.

---

## Your data & backups
All your data (subjects, Variant Lab history, schedule checkmarks) is stored on the droplet in
`/var/www/cutline/data/` — one small JSON file per record, written atomically. It survives restarts,
reboots, and app updates, and every device that opens the site sees the same data.

- **Back it up:** just copy the folder — `cp -r /var/www/cutline/data ~/cutline-backup-$(date +%F)`
  (or take a DigitalOcean snapshot). To restore, copy it back and `sudo systemctl restart cutline`.
- **Permissions:** the app creates and writes `data/` as the service user; the `chown -R www-data`
  in step 6 covers it. If history ever stops saving, run that chown again.
- **Privacy:** there's no login, so anyone who reaches the site shares the same data — fine for a
  private personal app. To lock it down, add HTTP Basic Auth in Nginx:
  ```bash
  sudo apt-get install -y apache2-utils
  sudo htpasswd -c /etc/nginx/.htpasswd username   # set a password when prompted
  ```
  then inside the Nginx `location / { ... }` block add these two lines and reload Nginx:
  `auth_basic "Private";  auth_basic_user_file /etc/nginx/.htpasswd;`

## Updating later
If I give you a new `App.jsx`, replace it and rebuild:
```bash
# copy the new file into /var/www/cutline/src/App.jsx, then:
cd /var/www/cutline
npm run build
sudo systemctl restart cutline
```
(Your `data/` folder is never touched by a rebuild, so all history and progress is preserved.)

## Troubleshooting
- **App loads but Variant Lab fails:** check the key. `sudo journalctl -u cutline -n 50` shows server logs.
  A `401` from Anthropic = bad/edited key; a `404`/model error = the model name in `.env` isn't valid
  (check https://docs.claude.com/en/docs/about-claude/models).
- **502 Bad Gateway:** the Node service isn't running. `sudo systemctl status cutline`.
- **Screenshots fail to upload / 413 error:** make sure `client_max_body_size 25M;` is in the Nginx
  config and you reloaded Nginx.
- **Your data (subjects, history, schedule):** it's stored server-side in the `data/` folder on the
  droplet, so it persists forever and is the same on every device. (See "Your data & backups" above.)
- **Cat GIFs:** they load from cataas.com; if that service is down you'll see the 🐾 fallback.

Notes:
- The bundled `src/App.jsx` is already wired to call your server's `/api/messages` (not Anthropic
  directly) and its token limit was raised from 1000 to 2000 for fuller answers.
- Persistence: `src/main.jsx` points the app's storage at the server database (`/api/store`), with
  localStorage kept only as an offline cache. Data that previously existed in just a browser is pushed
  up to the server automatically the first time that browser loads the site.
