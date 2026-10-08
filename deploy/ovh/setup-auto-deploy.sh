#!/usr/bin/env bash
# تجهيز النشر التلقائي مرة واحدة (0005 §١٥٣) — يشغّله المالك على الخادم بمستخدم ubuntu (بلا sudo):
#   bash /srv/apps/vezano-plus/deploy/ovh/setup-auto-deploy.sh
# ينشئ مفتاحاً لـGitHub Actions مقيَّداً بأمر النشر وحده، ونسخة مصدر من المستودع العام.
# المفتاح الخاص يبقى في ملف لينقله المالك إلى أسرار GitHub ثم يحذفه — لا يُطبع.
set -euo pipefail

KEY="$HOME/.ssh/vezano_plus_actions"
SRC=/srv/apps/vezano-plus-src
HOOK=/srv/apps/vezano-plus/deploy/ovh/auto-deploy.sh

[ -d "$SRC/.git" ] || git clone --quiet https://github.com/Stingcompiler/vezano-business.git "$SRC"
chmod +x "$HOOK"

if [ ! -f "$KEY.pub" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "github-actions-vezano-plus-deploy" -f "$KEY"
fi
line="command=\"$HOOK\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat "$KEY.pub")"
touch "$HOME/.ssh/authorized_keys"
if ! grep -qF "$(cut -d' ' -f2 "$KEY.pub")" "$HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$line" >>"$HOME/.ssh/authorized_keys"
fi
chmod 600 "$HOME/.ssh/authorized_keys"

echo "جاهز. المفتاح الخاص في $KEY — انقله إلى أسرار GitHub من جهازك ثم احذفه من الخادم:"
echo "  ssh ubuntu@<الخادم> 'cat ~/.ssh/vezano_plus_actions' | gh secret set VPS_DEPLOY_KEY -R Stingcompiler/vezano-business"
echo "  ssh ubuntu@<الخادم> 'rm ~/.ssh/vezano_plus_actions'"
