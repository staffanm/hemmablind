#!/bin/bash
# Run by the `update-hemmablind` hook in /etc/webhook.conf when GitHub pushes to the `deploy` branch.
# Copies the `deploy` branch (the build output from .github/workflows/deploy.yml) to the web root.
# Installed as ~/sites/update-hemmablind.sh by deploy/setup.sh.
set -euo pipefail

REPO=https://github.com/staffanm/hemmablind.git
CLONE=$HOME/.cache/hemmablind-deploy
ROOT=$HOME/sites/hemmablind.tomtebo.org

mkdir -p "$CLONE"
cd "$CLONE"

# Two runs can overlap
exec 9>"$CLONE.lock"
flock 9

git init -q
git fetch -q --depth 1 "$REPO" deploy
git reset -q --hard FETCH_HEAD

rsync -r --delete --exclude /.git/ ./ "$ROOT/"
echo "$(date): Updated hemmablind.tomtebo.org to $(git log -1 --format=%s)" >> /var/log/webhook-updates.log
