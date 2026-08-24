#!/usr/bin/env bash
# Directory Printer – Right-click launcher
# Hardened for large folders (especially the user home)

set -euo pipefail

# ========== FIXED PATH ==========
TOOL_DIR="/home/ava-core/operations/system-tools/directory-printer"
PRINTER="$TOOL_DIR/directory-printer.py"
# ================================

notify() {
    if command -v notify-send >/dev/null 2>&1; then
        notify-send -a "Directory Printer" "$1" "$2"
    else
        echo "$1: $2" >&2
    fi
}

copy_to_clipboard() {
    local file="$1"
    if command -v xclip >/dev/null 2>&1; then
        xclip -selection clipboard < "$file" && return 0
    elif command -v xsel >/dev/null 2>&1; then
        xsel --clipboard < "$file" && return 0
    elif command -v wl-copy >/dev/null 2>&1; then
        wl-copy < "$file" && return 0
    fi
    return 1
}

# ---------- Resolve target ----------
TARGET=""

if [[ $# -gt 0 ]]; then
    TARGET="$1"
fi

if [[ -z "$TARGET" || ! -e "$TARGET" ]]; then
    if [[ -n "${NAUTILUS_SCRIPT_CURRENT_URI:-}" ]]; then
        TARGET="${NAUTILUS_SCRIPT_CURRENT_URI#file://}"
        TARGET="$(printf '%b' "${TARGET//%/\\x}")"
    fi
fi

if [[ -z "$TARGET" || ! -e "$TARGET" ]]; then
    if [[ -n "${NAUTILUS_SCRIPT_SELECTED_FILE_PATHS:-}" ]]; then
        TARGET="$(echo "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS" | head -n1)"
    fi
fi

if [[ -z "$TARGET" || ! -e "$TARGET" ]]; then
    TARGET="$PWD"
fi

if [[ -f "$TARGET" ]]; then
    TARGET="$(dirname "$TARGET")"
fi

if [[ ! -d "$TARGET" ]]; then
    notify "Directory Printer" "Could not determine a valid directory"
    exit 1
fi

if [[ ! -f "$PRINTER" ]]; then
    notify "Directory Printer" "Cannot find directory-printer.py"
    exit 1
fi

FOLDER_NAME=$(basename "$TARGET")
BASE_OUT="${TARGET}/${FOLDER_NAME}"
DETAILED="${BASE_OUT}.txt"
TREE="${BASE_OUT}_tree.txt"

# Detect if this is the user home (or very large) → use fast mode + background
IS_HOME=0
if [[ "$TARGET" == "$HOME" || "$TARGET" == "/home/ava-core" || "$TARGET" == "/home/ava-ivy" ]]; then
    IS_HOME=1
fi

notify "Directory Printer" "Scanning ${FOLDER_NAME} … (this can take a while for home)"

if [[ $IS_HOME -eq 1 ]]; then
    # Fast mode for home: tree only, runs in background so Nautilus stays responsive
    (
        python3 "$PRINTER" "$TARGET" -o "$BASE_OUT" --fast
        if [[ -f "$TREE" ]]; then
            copy_to_clipboard "$TREE" || true
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "$TREE" >/dev/null 2>&1 &
            fi
            notify "Directory Printer" "Finished: ${FOLDER_NAME}_tree.txt (home scan)"
        else
            notify "Directory Printer" "Scan failed or produced no output"
        fi
    ) &
else
    # Normal folders: full detailed + tree
    python3 "$PRINTER" "$TARGET" -o "$BASE_OUT"

    CLIP_MSG=""
    if [[ -f "$TREE" ]] && copy_to_clipboard "$TREE"; then
        CLIP_MSG=" (tree copied)"
    fi

    if command -v xdg-open >/dev/null 2>&1 && [[ -f "$TREE" ]]; then
        xdg-open "$TREE" >/dev/null 2>&1 &
    fi

    notify "Directory Printer" "Created ${FOLDER_NAME}.txt + ${FOLDER_NAME}_tree.txt${CLIP_MSG}"
fi
