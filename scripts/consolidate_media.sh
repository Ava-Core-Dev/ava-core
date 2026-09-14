#!/usr/bin/env bash
# Consolidate ALL Ava media/docs/persona/reports/audio/video into ONE library:
#   /home/ava-core/ava/media
# Idempotent. Copy, don't delete sources. Skip bulk junk (Lala dump, files.log).
set -euo pipefail

MEDIA="${AVA_MEDIA_DIR:-/home/ava-core/ava/media}"
OLD="/home/ava-core/ava-old-20260819"
LIVE="/home/ava-core/ava"
STAGED="/home/ava-core/ava/ava-core-v2/apps/media"
VOICE_ASSETS="/home/ava-core/ava/ava-core-v2/apps/voice/assets"
V2="/home/ava-core/ava/ava-core-v2"
LOG="/tmp/ava-media-consolidate.log"

rsync_copy() {
  local src="$1" dest="$2"
  shift 2
  mkdir -p "$dest"
  if [ ! -e "$src" ]; then
    echo "  skip missing $src"
    return 0
  fi
  echo "  rsync $src -> $dest"
  rsync -a --info=stats0,flist0 "$@" "$src" "$dest"
}

echo "=== Consolidate media ===" | tee "$LOG"
echo "Canonical: $MEDIA" | tee -a "$LOG"
date | tee -a "$LOG"

# ── Layout (matches files.log + video/stream/persona/context) ─────────────────
mkdir -p \
  "$MEDIA/audio/station" "$MEDIA/audio/reports" "$MEDIA/audio/crons" \
  "$MEDIA/audio/words" "$MEDIA/audio/numbers" "$MEDIA/audio/time_clips" \
  "$MEDIA/audio/sounds" "$MEDIA/audio/generated" \
  "$MEDIA/video/clips" "$MEDIA/video/reports" "$MEDIA/video/current" \
  "$MEDIA/video/appearance" \
  "$MEDIA/images/channels" "$MEDIA/images/character" "$MEDIA/images/thumbnails" \
  "$MEDIA/images/discord" "$MEDIA/images/slack" "$MEDIA/images/telegram" \
  "$MEDIA/images/brand" "$MEDIA/images/emojis/discord" \
  "$MEDIA/images/direct messages/discord" \
  "$MEDIA/images/direct messages/slack" \
  "$MEDIA/images/direct messages/telegram" \
  "$MEDIA/images/imports" \
  "$MEDIA/documents/discord" "$MEDIA/documents/reports" \
  "$MEDIA/documents/slack" "$MEDIA/documents/telegram" \
  "$MEDIA/documents/persona" "$MEDIA/documents/notes" \
  "$MEDIA/documents/plans" "$MEDIA/documents/docs" \
  "$MEDIA/documents/context" "$MEDIA/documents/logs" \
  "$MEDIA/stream/overlays" "$MEDIA/stream/obs-cams"

# Keep the original skeleton spelling as an alias
if [ ! -e "$MEDIA/images/thumnails" ]; then
  ln -sfn thumbnails "$MEDIA/images/thumnails"
fi
# Compat aliases so older code looking at media/portraits still works
ln -sfn images/character "$MEDIA/portraits"
ln -sfn images/thumbnails "$MEDIA/thumbnails"
ln -sfn images/brand "$MEDIA/brand"
ln -sfn video "$MEDIA/videos"
ln -sfn images/emojis "$MEDIA/emojis"

# ── 1. Staged v2 PG-13 library ────────────────────────────────────────────────
echo "== staged apps/media ==" | tee -a "$LOG"
if [ -d "$STAGED" ] && [ ! -L "$STAGED" ]; then
  rsync_copy "$STAGED/brand/"            "$MEDIA/images/brand/"
  rsync_copy "$STAGED/portraits/"        "$MEDIA/images/character/"
  rsync_copy "$STAGED/thumbnails/"       "$MEDIA/images/thumbnails/"
  rsync_copy "$STAGED/emojis/"           "$MEDIA/images/emojis/"
  rsync_copy "$STAGED/videos/clips/"     "$MEDIA/video/clips/"
  rsync_copy "$STAGED/videos/mp4-current/" "$MEDIA/video/current/"
  rsync_copy "$STAGED/audio/station/"    "$MEDIA/audio/station/"
  rsync_copy "$STAGED/audio/reports/"    "$MEDIA/audio/reports/"
  rsync_copy "$STAGED/stream/overlays/"  "$MEDIA/stream/overlays/"
  rsync_copy "$STAGED/stream/obs-cams/"  "$MEDIA/stream/obs-cams/"
  # Keep README/manifest as historical; new README is written at the end
  [ -f "$STAGED/manifest.json" ] && cp -n "$STAGED/manifest.json" "$MEDIA/manifest.v2-staged.json" || true
fi

# ── 2. Voice clips (words / numbers / time / sounds) ──────────────────────────
echo "== voice clips ==" | tee -a "$LOG"
if [ -d "$VOICE_ASSETS" ] && [ ! -L "$VOICE_ASSETS" ]; then
  rsync_copy "$VOICE_ASSETS/words/"      "$MEDIA/audio/words/"
  rsync_copy "$VOICE_ASSETS/numbers/"    "$MEDIA/audio/numbers/"
  rsync_copy "$VOICE_ASSETS/time_clips/" "$MEDIA/audio/time_clips/"
  rsync_copy "$VOICE_ASSETS/sounds/"     "$MEDIA/audio/sounds/"
  [ -f "$VOICE_ASSETS/thumbnail.jpg" ] && cp -n "$VOICE_ASSETS/thumbnail.jpg" "$MEDIA/images/thumbnails/" || true
fi
# Old trees (gap-fill)
rsync_copy "$OLD/voice/words/"           "$MEDIA/audio/words/"
rsync_copy "$OLD/voice/numbers/"         "$MEDIA/audio/numbers/"
rsync_copy "$OLD/voice/time_clips/"      "$MEDIA/audio/time_clips/"
rsync_copy "$OLD/python version/ava-core/voice/time_clips/" "$MEDIA/audio/time_clips/"
rsync_copy "$OLD/voice/generated/"       "$MEDIA/audio/generated/"
rsync_copy "$OLD/voice/ara_report_words/" "$MEDIA/audio/crons/ara_report_words/"
if [ -f "$OLD/python version/ava-core/sounds/futuristic_bell.mp3" ]; then
  cp -n "$OLD/python version/ava-core/sounds/futuristic_bell.mp3" "$MEDIA/audio/sounds/" || true
fi
# Station / long-form from old media root
for f in "$OLD"/media/*.mp3; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  case "$base" in
    *station*) dest="$MEDIA/audio/station/" ;;
    *)         dest="$MEDIA/audio/reports/" ;;
  esac
  cp -n "$f" "$dest" || true
done
rsync_copy "$LIVE/voice/generated/"      "$MEDIA/audio/generated/"

# ── 3. Images / video from old media + appearance ─────────────────────────────
echo "== images / video ==" | tee -a "$LOG"
rsync_copy "$OLD/media/Thumbnails/"      "$MEDIA/images/thumbnails/"
rsync_copy "$OLD/from-e-ava-ivy/appearance/" "$MEDIA/images/character/" \
  --exclude 'video/' --exclude '*.mp4' --exclude '*.gif' --exclude '*.webm'
rsync_copy "$OLD/from-e-ava-ivy/appearance/video/" "$MEDIA/video/appearance/"
rsync_copy "$OLD/from-e-ava-ivy/emojis/" "$MEDIA/images/emojis/"
rsync_copy "$OLD/from-e-ava-ivy/media/gifs/" "$MEDIA/video/clips/" \
  --max-size=20m
# Unsorted mixed dump: split by extension
if [ -d "$OLD/media/unsorted" ]; then
  mkdir -p "$MEDIA/images/character" "$MEDIA/video/clips" "$MEDIA/audio/reports"
  find "$OLD/media/unsorted" -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
    -exec cp -n {} "$MEDIA/images/character/" \;
  find "$OLD/media/unsorted" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.gif' -o -iname '*.webm' -o -iname '*.mov' \) \
    -exec cp -n {} "$MEDIA/video/clips/" \;
  find "$OLD/media/unsorted" -maxdepth 1 -type f \( -iname '*.mp3' -o -iname '*.wav' \) \
    -exec cp -n {} "$MEDIA/audio/reports/" \;
fi
rsync_copy "$LIVE/data/obs-cams/"        "$MEDIA/stream/obs-cams/"
rsync_copy "$OLD/obs scripts/"           "$MEDIA/stream/overlays/"
rsync_copy "$OLD/media/obs scripts/"     "$MEDIA/stream/overlays/"

# ── 4. Documents: persona, notes, plans, reports, chat history ────────────────
echo "== documents ==" | tee -a "$LOG"
# Persona / identity
for f in \
  "$OLD/docs/persona.md" \
  "$OLD/docs/persona-source.mjs" \
  "$OLD/docs/WHAT-IS-AVA.md" \
  "$OLD/docs/known-people-alexrs94.md" \
  "$OLD/core/src/persona.mjs" \
  "$V2/docs/ava-identity.md" \
  "$OLD/llama-baseline/SYSTEM.txt" \
  "$OLD/llama-baseline/Modelfile" \
  "$OLD/llama-baseline/few-shot.json" \
  "$OLD/data/node-identity.json"
do
  [ -f "$f" ] && cp -n "$f" "$MEDIA/documents/persona/" || true
done
rsync_copy "$OLD/llama-baseline/"        "$MEDIA/documents/persona/llama-baseline/"
rsync_copy "$OLD/from-e-ava-ivy/dream-pack/bundle/" "$MEDIA/documents/persona/dream-pack/" \
  --include '11-persona-snapshot.md' --include '16-persona.mjs' --include '*/' --exclude '*'
rsync_copy "$OLD/data/training/"         "$MEDIA/documents/persona/training/"

# Notes / plans / docs
rsync_copy "$OLD/notes/"                 "$MEDIA/documents/notes/"
rsync_copy "$OLD/plans/"                 "$MEDIA/documents/plans/"
rsync_copy "$OLD/docs/"                  "$MEDIA/documents/docs/"
rsync_copy "$OLD/data/notes/"            "$MEDIA/documents/notes/data-notes/"
rsync_copy "$OLD/unsorted/"              "$MEDIA/documents/notes/unsorted-context/" \
  --include '*.md' --include '*.txt' --include '*/' --exclude '*'
rsync_copy "$V2/docs/"                   "$MEDIA/documents/docs/v2/"

# Reports (historical + live)
rsync_copy "$OLD/reports/"               "$MEDIA/documents/reports/" \
  --exclude 'channel-dumps/'
rsync_copy "$LIVE/reports/"              "$MEDIA/documents/reports/" \
  --exclude 'channel-dumps/'
rsync_copy "$OLD/AIConversations/reports/" "$MEDIA/documents/reports/conversation-summaries/"
rsync_copy "$OLD/reports/channel-dumps/" "$MEDIA/documents/reports/channel-dumps/"

# Channel dumps stay under documents/reports/channel-dumps (already rsynced).
# Platform-specific live state:
rsync_copy "$OLD/data/slack/"            "$MEDIA/documents/slack/data/"
rsync_copy "$OLD/data/telegram/"         "$MEDIA/documents/telegram/data/"
rsync_copy "$LIVE/reports/channel-dumps/" "$MEDIA/documents/reports/channel-dumps-live/"

# Chat history / AIConversations → documents/context
echo "== chat history (AIConversations) ==" | tee -a "$LOG"
rsync_copy "$OLD/AIConversations/"       "$MEDIA/documents/context/AIConversations/" \
  --exclude 'files.txt'

# Useful historical logs (skip giant runtime artifacts)
echo "== logs ==" | tee -a "$LOG"
for f in ava-brain.log ava-core.log ava-desktop.log ava-voice.log; do
  [ -f "$OLD/logs/$f" ] && cp -n "$OLD/logs/$f" "$MEDIA/documents/logs/" || true
done
rsync_copy "$LIVE/data/logs/"            "$MEDIA/documents/logs/ops/" \
  --max-size=20m

# ── 5. Point leftover live paths at the library ───────────────────────────────
echo "== live aliases ==" | tee -a "$LOG"
# ~/ava/reports, ~/ava/voice/generated, ~/ava/logs used to be the write targets
if [ -d "$LIVE/reports" ] && [ ! -L "$LIVE/reports" ]; then
  mkdir -p "$LIVE/reports.bak-pre-media"
  # leave originals; add a sibling pointer
  ln -sfn "$MEDIA/documents/reports" "$LIVE/reports-canonical"
fi
if [ -d "$LIVE/voice" ]; then
  ln -sfn "$MEDIA/audio" "$LIVE/voice/media-audio"
fi
ln -sfn "$MEDIA/documents/logs" "$LIVE/logs-canonical" 2>/dev/null || true

# ── 6. Point the v2 app tree at this library (symlinks, no second copy) ───────
echo "== v2 app symlinks ==" | tee -a "$LOG"
if [ -d "$STAGED" ] && [ ! -L "$STAGED" ]; then
  # Staged files are now in $MEDIA; replace the dir with a pointer
  BACK="/tmp/apps-media-bak-$$"
  mv "$STAGED" "$BACK"
  ln -sfn "$MEDIA" "$STAGED"
  echo "  apps/media -> $MEDIA  (old dir at $BACK)"
fi
if [ -d "$VOICE_ASSETS" ] && [ ! -L "$VOICE_ASSETS" ]; then
  BACK="/tmp/voice-assets-bak-$$"
  mv "$VOICE_ASSETS" "$BACK"
  ln -sfn "$MEDIA/audio" "$VOICE_ASSETS"
  echo "  apps/voice/assets -> $MEDIA/audio  (old dir at $BACK)"
fi

echo "" | tee -a "$LOG"
echo "=== counts ===" | tee -a "$LOG"
{
  echo -n "audio files:     "; find "$MEDIA/audio" -type f | wc -l
  echo -n "video files:     "; find "$MEDIA/video" -type f | wc -l
  echo -n "image files:     "; find "$MEDIA/images" -type f | wc -l
  echo -n "document files:  "; find "$MEDIA/documents" -type f | wc -l
  echo -n "stream files:    "; find "$MEDIA/stream" -type f | wc -l
  du -sh "$MEDIA" "$MEDIA"/* 2>/dev/null
} | tee -a "$LOG"

echo "Done. Log: $LOG"
