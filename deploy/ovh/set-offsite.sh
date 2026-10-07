#!/usr/bin/env bash
# ضبط النسخ خارج الخادم (0005 §١٥١) — يشغّله المالك على الخادم من deploy/ovh:
#   bash set-offsite.sh
# يسأل عن القيم (السرّية منها بلا عرض) ويكتبها في .env بعد نسخة احتياطية منه. لا يطبع سرّاً.
set -eu
cd "$(dirname "$0")"
[ -f .env ] || { echo "لا .env هنا — شغّله من deploy/ovh على الخادم"; exit 1; }

# Cloudflare R2 (المعتمد؛ 0005 §١٥٢): Endpoint ‎https://<ACCOUNT_ID>.r2.cloudflarestorage.com والمنطقة auto
read -r -p "Endpoint (مثل https://<ACCOUNT_ID>.r2.cloudflarestorage.com): " endpoint
read -r -p "Region [auto]: " region
region=${region:-auto}
read -r -p "Bucket (اسم الحاوية): " bucket
read -r -p "Access Key ID: " access
read -r -s -p "Secret Access Key (لا يظهر): " secret; echo
read -r -s -p "عبارة سرّ التشفير — 20 حرفاً فأكثر، احفظها في مدير كلماتك (لا تظهر): " pass; echo
read -r -s -p "أعد عبارة السرّ للتأكيد: " pass2; echo
[ "$pass" = "$pass2" ] || { echo "العبارتان مختلفتان — لم يتغيّر شيء"; exit 1; }
[ "${#pass}" -ge 20 ] || { echo "العبارة أقصر من 20 حرفاً — لم يتغيّر شيء"; exit 1; }
case "$pass" in *"'"*) echo "العبارة فيها علامة ' — اختر غيرها؛ لم يتغيّر شيء"; exit 1;; esac
case "$endpoint" in https://*) ;; *) echo "الـEndpoint يبدأ بـhttps:// — لم يتغيّر شيء"; exit 1;; esac

cp -p .env ".env.bak-$(date -u +%Y%m%d%H%M%S)"
tmp=$(mktemp)
keys='STING_OFFSITE_ENDPOINT|STING_OFFSITE_REGION|STING_OFFSITE_BUCKET|STING_OFFSITE_ACCESS_KEY|STING_OFFSITE_SECRET_KEY|STING_BACKUP_PASSPHRASE'
grep -v -E "^(# النسخ خارج الخادم|($keys)=)" .env > "$tmp" || true
{
  cat "$tmp"
  printf '\n# النسخ خارج الخادم (0005 §١٥١)\n'
  printf 'STING_OFFSITE_ENDPOINT=%s\n' "$endpoint"
  printf 'STING_OFFSITE_REGION=%s\n' "$region"
  printf 'STING_OFFSITE_BUCKET=%s\n' "$bucket"
  printf 'STING_OFFSITE_ACCESS_KEY=%s\n' "$access"
  printf 'STING_OFFSITE_SECRET_KEY=%s\n' "$secret"
  printf "STING_BACKUP_PASSPHRASE='%s'\n" "$pass"
} > .env
rm -f "$tmp"
chmod 600 .env
echo "كُتب. التالي: sudo docker compose up -d worker ثم نسخة تجريبية الآن:"
echo "  sudo docker compose exec worker /app/deploy/backup.sh"
