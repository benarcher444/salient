#!/usr/bin/env bash
# Update the server to the latest code on GitHub and restart.
#
# Runs on every push to main, through a copy installed BY HAND at
# /usr/local/bin/salient-deploy — the only command the GitHub deploy key may
# run. A root-owned copy means a push can change the app, never this
# privileged command. By hand:  ssh root@91.99.202.188 salient-deploy
# After editing this file, reinstall that copy:
#   install -m 755 /opt/salient/deploy/deploy.sh /usr/local/bin/salient-deploy
set -euo pipefail

NAME=salient
APP=/opt/$NAME
PORT=3002
HEALTH=/healthz
cd "$APP"

# Migrations run at boot, so a copy taken just before is the undo button.
echo "→ Backing up the database"
sudo -u "$NAME" -H "$APP/node_modules/.bin/tsx" scripts/backup-db.ts --label=pre-deploy --keep=10

echo "→ Pulling the latest code"
sudo -u "$NAME" -H git pull --ff-only

echo "→ Installing dependencies"
sudo -u "$NAME" -H npm ci --omit=dev

echo "→ Restarting"
systemctl restart "$NAME"

# Wait for it to answer, so a broken deploy fails loudly (and fails the
# GitHub run) rather than leaving the site down unnoticed.
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT$HEALTH"; then
    echo "✓ $NAME is up at $(sudo -u "$NAME" git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "✗ $NAME did not come back up. Last log lines:"
journalctl -u "$NAME" -n 30 --no-pager
exit 1
