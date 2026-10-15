#!/usr/bin/env bash
# تجهيز النشر التلقائي مرة واحدة (0005 §١٥٣) — يشغّله المالك على الخادم بمستخدم ubuntu (بلا sudo):
#   bash /srv/apps/vezano-plus/deploy/ovh/setup-auto-deploy.sh            (أول مرة)
#   bash /srv/apps/vezano-plus/deploy/ovh/setup-auto-deploy.sh --rotate   (مفتاح جديد يُبطل القديم)
# ينشئ مفتاحاً لـGitHub Actions مقيَّداً بأمر النشر وحده، ونسخة مصدر من المستودع العام.
# المفتاح الخاص يبقى في ملف لينقله المالك إلى أسرار GitHub ثم يحذفه — لا يُطبع.
set -euo pipefail

KEY="$HOME/.ssh/vezano_plus_actions"
SRC=/srv/apps/vezano-plus-src
HOOK=/srv/apps/vezano-plus/deploy/ovh/auto-deploy.sh

[ -d "$SRC/.git" ] || git clone --quiet https://github.com/Stingcompiler/vezano-business.git "$SRC"
chmod +x "$HOOK"

if [ "${1:-}" = "--rotate" ]; then
  # يُبطل المفتاح القديم: سطره في authorized_keys وملفاه — ثم يُنشأ جديد
  sed -i '/github-actions-vezano-plus-deploy/d' "$HOME/.ssh/authorized_keys" 2>/dev/null || true
  rm -f "$KEY" "$KEY.pub"
fi
if [ ! -f "$KEY.pub" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "github-actions-vezano-plus-deploy" -f "$KEY"
fi
line="command=\"$HOOK\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat "$KEY.pub")"
touch "$HOME/.ssh/authorized_keys"
if ! grep -qF "$(cut -d' ' -f2 "$KEY.pub")" "$HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$line" >>"$HOME/.ssh/authorized_keys"
fi
chmod 600 "$HOME/.ssh/authorized_keys"

if [ ! -f "$KEY" ]; then
  echo "تنبيه: المفتاح الخاص حُذف من قبل ولا يُستعاد — شغّل بـ--rotate لمفتاح جديد."
  exit 1
fi
echo "جاهز. المفتاح الخاص في $KEY — انقله إلى أسرار GitHub من جهازك (يُحذف من الخادم في الخطوة نفسها):"
echo "  k=\$(ssh ubuntu@<الخادم> 'cat ~/.ssh/vezano_plus_actions && rm ~/.ssh/vezano_plus_actions') && [ -n \"\$k\" ] && printf '%s\\n' \"\$k\" | gh secret set VPS_DEPLOY_KEY -R Stingcompiler/vezano-business"
