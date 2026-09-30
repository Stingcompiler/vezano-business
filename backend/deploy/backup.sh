#!/usr/bin/env bash
# النسخة الليلية (PLT-10؛ 0005 §١٤٠): pg_dump بصيغة custom إلى /backups، يُحتفظ بـ14 يوماً، ويُسجَّل
# في «النسخ» عند المشغّل بحجمه وحالته. الجمعة «أسبوعية». الاتصال بدور يتجاوز RLS
# (`BACKUP_DATABASE_URL`) وإلا رفض pg_dump الجداول المحمية أو نسخها فارغة.
set -u
umask 077  # النسخة فيها بيانات كل المستأجرين — لصاحبها وحده
stamp=$(date -u +%Y%m%d-%H%M)
file="/backups/vezano-${stamp}.dump"
kind=nightly
[ "$(date -u +%u)" = "5" ] && kind=weekly
if pg_dump --format=custom --no-owner --file="$file" "$BACKUP_DATABASE_URL"; then
  size=$(stat -c %s "$file")
  status=ok
  note="pg_dump custom"
else
  size=0
  status=failed
  note="pg_dump فشل — راجع سجل الحاوية"
  rm -f "$file"
fi
uv run --no-sync python manage.py record_backup --kind "$kind" --size "$size" --status "$status" \
  --note "$note" --location "$file"
find /backups -name 'vezano-*.dump' -mtime +14 -delete
