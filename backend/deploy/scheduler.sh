#!/usr/bin/env bash
# المهام المجدولة على الخادم الخاص (0005 §١٤٠) — حلقة بسيطة بتوقيت UTC بلا cron داخل الحاوية:
#   01:00 النسخة الليلية لقاعدة البيانات (backup.sh)
#   04:00 GROW-01/02 (grow_compute) = 06:00 بتوقيت الخرطوم، فيصدق «الفحص التالي غداً 6 ص»
set -u
last_backup=""
last_grow=""
while true; do
  day=$(date -u +%F)
  hour=$(date -u +%H)
  if [ "$hour" = "01" ] && [ "$last_backup" != "$day" ]; then
    /app/deploy/backup.sh || echo "backup failed"
    last_backup=$day
  fi
  if [ "$hour" = "04" ] && [ "$last_grow" != "$day" ]; then
    uv run --no-sync python manage.py grow_compute || echo "grow_compute failed"
    last_grow=$day
  fi
  sleep 60
done
