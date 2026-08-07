#!/usr/bin/env bash
# Mirror absolute RootMC core MySQL → on-device backup DB (rootmc_core_mirror).
# Primary: Shockbyte ebca4f8c3a-avacore. Local MariaDB is backup only.
set -euo pipefail
ENV_FILE="${AVA_HANDOFF:-/home/ava-core/ava}/.env"
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^\"//;s/\"$//;s/\r$//' | sed "s/^'//;s/'$//"; }
CORE_HOST=$(get ROOTMC_CORE_MYSQL_HOST)
CORE_PORT=$(get ROOTMC_CORE_MYSQL_PORT)
CORE_DB=$(get ROOTMC_CORE_MYSQL_DATABASE)
CORE_USER=$(get ROOTMC_CORE_MYSQL_USER)
CORE_PASS=$(get ROOTMC_CORE_MYSQL_PASSWORD)
LOC_HOST=$(get AVA_MYSQL_HOST)
LOC_PORT=$(get AVA_MYSQL_PORT)
LOC_USER=$(get AVA_MYSQL_USER)
LOC_PASS=$(get AVA_MYSQL_PASSWORD)
LOC_DB="${ROOTMC_MIRROR_DB:-rootmc_core_mirror}"
STAMP=$(date -u +%Y%m%d-%H%M%S)
DUMP="/mnt/e/Ava-Archive/mysql-core-mirror-$STAMP.sql"
LOG_DIR="${AVA_HANDOFF:-/home/ava-core/ava}/data/notes/dev"
mkdir -p /mnt/e/Ava-Archive "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] dumping core $CORE_DB@$CORE_HOST ..."
export MYSQL_PWD="$CORE_PASS"
mysqldump -h"$CORE_HOST" -P"${CORE_PORT:-3306}" -u"$CORE_USER" \
  --single-transaction --no-tablespaces --set-gtid-purged=OFF \
  "$CORE_DB" > "$DUMP" 2>/tmp/mysqldump-core.err || {
  # retry without gtid flag (MariaDB client variance)
  mysqldump -h"$CORE_HOST" -P"${CORE_PORT:-3306}" -u"$CORE_USER" \
    --single-transaction --no-tablespaces "$CORE_DB" > "$DUMP"
}
echo "importing into local mirror $LOC_DB ..."
export MYSQL_PWD="$LOC_PASS"
mysql -h"${LOC_HOST:-127.0.0.1}" -P"${LOC_PORT:-3306}" -u"$LOC_USER" -e \
  "CREATE DATABASE IF NOT EXISTS \`$LOC_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true
mysql -h"${LOC_HOST:-127.0.0.1}" -P"${LOC_PORT:-3306}" -u"$LOC_USER" "$LOC_DB" < "$DUMP"
# keep last 5 dumps
ls -1t /mnt/e/Ava-Archive/mysql-core-mirror-*.sql 2>/dev/null | tail -n +6 | xargs -r rm -f
TABLES=$(mysql -h"${LOC_HOST:-127.0.0.1}" -P"${LOC_PORT:-3306}" -u"$LOC_USER" -N -e "SHOW TABLES;" "$LOC_DB" | wc -l)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] OK mirror tables=$TABLES dump=$DUMP -> $LOC_DB" | tee -a "$LOG_DIR/mysql-mirror.log"
