#!/usr/bin/env bash
# Numbered menu. No coding. Run in a terminal on the Ava machine:
#   bash /home/ava-core/ava/ava-core-v2/scripts/ava-ops.sh
set -euo pipefail
CORE="/home/ava-core/ava/ava-core-v2"
PY="$CORE/.venv/bin/python"
[ -x "$PY" ] || PY=python3

echo ""
echo "  AVA DESK — no Cursor needed"
echo "  Browser desk: http://127.0.0.1:8787/ops"
echo ""
echo "  1) Open the desk in your browser"
echo "  2) Rebuild blogs from markdown (after you edited posts)"
echo "  3) First-time: copy existing blogs into editable markdown"
echo "  4) Publish RootMC website"
echo "  5) Restart Ava (core service)"
echo "  6) Open homepage words file (avaivy content.json)"
echo "  7) Open blog folders in the file manager"
echo "  8) Ask local Ava (Ollama) to rewrite text you paste"
echo "  9) Quit"
echo ""
read -r -p "Number: " n
case "$n" in
  1) xdg-open "http://127.0.0.1:8787/ops" 2>/dev/null || echo "Open http://127.0.0.1:8787/ops" ;;
  2) "$PY" "$CORE/scripts/sync-blogs.py" ;;
  3) "$PY" "$CORE/scripts/sync-blogs.py" --seed ;;
  4) bash "$CORE/scripts/publish-rootmc.sh" ;;
  5) sudo systemctl restart ava-core.service && echo "Ava core restarted." ;;
  6) xdg-open "$CORE/packages/web/avaivy.cloud/src/content.json" 2>/dev/null || echo "$CORE/packages/web/avaivy.cloud/src/content.json" ;;
  7) xdg-open /home/ava-core/ava/media/documents/reports/posts 2>/dev/null || echo /home/ava-core/ava/media/documents/reports/posts ;;
  8)
    echo "Paste text, then Ctrl-D:"
    draft=$(cat)
    curl -sS http://127.0.0.1:11434/api/chat -H 'Content-Type: application/json' \
      -d "$(python3 -c "import json,sys; print(json.dumps({'model':'qwen3:8b','stream':False,'think':False,'messages':[{'role':'user','content':'Rewrite clearly for a public blog. Do not invent facts.\\n\\n'+sys.argv[1]}]}))" "$draft")" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message',{}).get('content',d))"
    ;;
  *) echo "Bye." ;;
esac
