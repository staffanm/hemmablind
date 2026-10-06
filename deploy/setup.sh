#!/bin/bash
# One-time setup of hemmablind.tomtebo.org on the web server. Run it on the server, as a user with sudo.
# It makes the nginx site, requests the Let's Encrypt certificate, installs the deploy hook and copies the site.
# It needs deploy/hemmablind.tomtebo.org.nginx and deploy/update-site.sh in the same directory.
#
#   scp deploy/setup.sh deploy/hemmablind.tomtebo.org.nginx deploy/update-site.sh staffan@ludo.tomtebo.org:/tmp/
#   ssh -t staffan@ludo.tomtebo.org 'bash /tmp/setup.sh'
#
# The hook needs the secret of the GitHub webhook of the repository. Give it as the first argument.
# Without an argument, the script takes the secret of the hook `update-landmark-cards`,
# which is the hook from the time when the game had the name Landmark Cards.
set -euo pipefail

SITE=hemmablind.tomtebo.org
HOOK_ID=update-hemmablind
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$HOME/sites/$HOOK_ID.sh

SECRET=${1:-$(sudo jq -r '.[] | select(.id == "update-landmark-cards") | .["trigger-rule"].and[0].match.secret' /etc/webhook.conf)}
if [ -z "$SECRET" ] || [ "$SECRET" = null ]; then
    echo "usage: setup.sh <secret>"
    exit 1
fi

# 1. The nginx site and the certificate. certbot edits the nginx site and adds the HTTPS redirect.
mkdir -p "$HOME/sites/$SITE"
sudo cp "$HERE/$SITE.nginx" "/etc/nginx/sites-available/$SITE"
sudo ln -sf "/etc/nginx/sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --redirect -d "$SITE"

# 2. The deploy hook. Add it, or replace it if it is there. It runs only for a signed push to the deploy branch.
install -m 755 "$HERE/update-site.sh" "$SCRIPT"
HOOK=$(jq -n --arg id "$HOOK_ID" --arg cmd "$SCRIPT" --arg secret "$SECRET" '{
  id: $id,
  "execute-command": $cmd,
  "http-methods": ["POST"],
  "trigger-rule": {and: [
    {match: {type: "payload-hmac-sha256", secret: $secret, parameter: {source: "header", name: "X-Hub-Signature-256"}}},
    {match: {type: "value", value: "refs/heads/deploy", parameter: {source: "payload", name: "ref"}}}
  ]}}')
sudo cp /etc/webhook.conf /etc/webhook.conf.bak
sudo jq --argjson hook "$HOOK" --arg id "$HOOK_ID" 'map(select(.id != $id)) + [$hook]' /etc/webhook.conf.bak | sudo tee /etc/webhook.conf >/dev/null
sudo systemctl restart webhook

# 3. The first copy of the site, from the deploy branch on GitHub.
"$SCRIPT"

echo "Done. https://$SITE/ serves the game."
echo "Now point the GitHub webhook at http://<this server>:9000/hooks/$HOOK_ID, so that a push to main deploys here."
