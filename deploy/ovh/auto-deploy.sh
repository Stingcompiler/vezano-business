#!/usr/bin/env bash
# النشر التلقائي بعد الدمج (0005 §١٥٣) — يشغّله مفتاح GitHub Actions على الخادم كأمر مفروض
# (`command=` في authorized_keys)، فلا يملك المفتاح غير هذا: لا صدفة ولا ملفات ولا أي مشروع آخر.
#
# المُدخل الوحيد: `deploy <sha>` في SSH_ORIGINAL_COMMAND — 40 حرفاً ست عشرية، ويجب أن يكون على main.
# الخطوات: جلب main ← نسخ الشجرة إلى مجلد التشغيل (بلا .env) ← بناء ← تشغيل ← فحص الصحة؛
# إن فشل الفحص أعاد الصور السابقة وخرج بخطأ فيفشل سير العمل ويصل بريده.
set -euo pipefail

APP=/srv/apps/vezano-plus
SRC=/srv/apps/vezano-plus-src
REPO=https://github.com/Stingcompiler/vezano-business.git
LOG="$HOME/vezano-plus-deploy.log"
COMPOSE=(sudo docker compose -f "$APP/deploy/ovh/docker-compose.yml" --project-directory "$APP/deploy/ovh")

exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -u +%FT%TZ) ${SSH_ORIGINAL_COMMAND:-<none>}"

read -r verb sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [ "${verb:-}" != deploy ] || [ -n "${extra:-}" ] || ! [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "مرفوض: المسموح «deploy <sha من 40 حرفاً>» وحده"
  exit 2
fi

# نشر واحد في كل مرة
exec 9>"$HOME/.vezano-plus-deploy.lock"
flock -w 1800 9

[ -d "$SRC/.git" ] || git clone --quiet "$REPO" "$SRC"
git -C "$SRC" fetch --quiet origin main
if ! git -C "$SRC" merge-base --is-ancestor "$sha" origin/main; then
  echo "مرفوض: $sha ليس على main"
  exit 3
fi
git -C "$SRC" checkout --quiet --force "$sha"

rsync -a --delete \
  --exclude .git --exclude 'deploy/ovh/.env' --exclude 'deploy/ovh/.env.bak-*' \
  --exclude .deployed-sha \
  "$SRC/" "$APP/"

# الصور الحالية «سابقة» قبل البناء — للرجوع إن فشل الفحص
for img in vezano-api ovh-web; do
  sudo docker image inspect "$img:latest" >/dev/null 2>&1 && sudo docker tag "$img:latest" "$img:previous"
done

"${COMPOSE[@]}" build api web
"${COMPOSE[@]}" up -d db api worker web

healthy() {
  curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:3100/ &&
    curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:3100/api/health
}
for _ in $(seq 1 30); do
  if healthy; then
    echo "$sha" >"$APP/.deployed-sha"
    echo "نُشر $sha وهو سليم"
    exit 0
  fi
  sleep 5
done

echo "الفحص فشل بعد النشر — رجوع إلى الصور السابقة"
for img in vezano-api ovh-web; do
  sudo docker image inspect "$img:previous" >/dev/null 2>&1 && sudo docker tag "$img:previous" "$img:latest"
done
"${COMPOSE[@]}" up -d --no-build db api worker web
# ترحيلات قاعدة البيانات لا تُعكس تلقائياً — راجع docs/deploy-ovh.md §«النشر التلقائي»
exit 1
