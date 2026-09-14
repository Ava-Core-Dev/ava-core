#!/bin/bash
# archive-to-hdd.sh — keep SSD lean; preserve history on /mnt/e/Ava-Archive
set -euo pipefail
AVA_HOME=/home/ava-core/ava
ARC=/mnt/e/Ava-Archive
DAYS="${ARCHIVE_DAYS:-14}"

if [[ ! -d /mnt/e ]]; then
  echo "HDD /mnt/e not mounted — skip archive"
  exit 0
fi
mkdir -p "$ARC"/{logs,training,cold,paper-worlds}

# logs older than DAYS
if [[ -d $AVA_HOME/logs ]]; then
  find "$AVA_HOME/logs" -type f -mtime +"$DAYS" -print0 2>/dev/null |
    rsync -a --remove-source-files --files-from=- --from0 "$AVA_HOME/logs/" "$ARC/logs/" 2>/dev/null || \
  find "$AVA_HOME/logs" -type f -mtime +"$DAYS" -exec rsync -a {} "$ARC/logs/" \; -delete 2>/dev/null || true
fi

# training packs older than DAYS (keep recent on SSD)
if [[ -d $AVA_HOME/data/training ]]; then
  find "$AVA_HOME/data/training" -type f -mtime +"$DAYS" -exec rsync -a {} "$ARC/training/" \; -delete 2>/dev/null || true
fi

# paper logs
if [[ -d $AVA_HOME/workstations/minecraft-test/logs ]]; then
  find "$AVA_HOME/workstations/minecraft-test/logs" -type f -mtime +7 -exec rsync -a {} "$ARC/logs/paper/" \; -delete 2>/dev/null || true
  mkdir -p "$ARC/logs/paper"
fi

df -h / /mnt/e | head -5
du -sh "$AVA_HOME" "$ARC" 2>/dev/null || true
echo "archive pass done (days>$DAYS → HDD)"
