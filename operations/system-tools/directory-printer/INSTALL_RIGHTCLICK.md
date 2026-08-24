# How to add Directory Printer to Right-Click menu

## 1. Nautilus (GNOME) – easiest method

1. Create the scripts folder (one-time):
   ```bash
   mkdir -p ~/.local/share/nautilus/scripts
   ```

2. Copy the launcher:
   ```bash
   cp /path/to/Directory_Printer/dirprint_rightclick.sh \
      ~/.local/share/nautilus/scripts/"Directory Printer"
   chmod +x ~/.local/share/nautilus/scripts/"Directory Printer"
   ```

3. Restart Nautilus (or log out/in):
   ```bash
   nautilus -q
   ```

4. Now right-click any folder or file → Scripts → Directory Printer

---

## 2. Nemo (Cinnamon / Linux Mint)

Same as Nautilus, but the folder is:
```bash
mkdir -p ~/.local/share/nemo/scripts
cp ... ~/.local/share/nemo/scripts/"Directory Printer"
```

---

## 3. Dolphin (KDE)

1. Create a service menu:
   ```bash
   mkdir -p ~/.local/share/kio/servicemenus
   ```

2. Create the file `~/.local/share/kio/servicemenus/directory-printer.desktop` with:

```ini
[Desktop Entry]
Type=Service
ServiceTypes=inode/directory,application/octet-stream
Actions=printDir

[Desktop Action printDir]
Name=Directory Printer
Icon=folder
Exec=/full/path/to/Directory_Printer/dirprint_rightclick.sh %f
```

3. Make it executable and restart Dolphin.

---

## 4. Thunar (XFCE)

1. Open Thunar → Edit → Configure custom actions
2. Add a new action:
   - Name: Directory Printer
   - Command: `/full/path/to/Directory_Printer/dirprint_rightclick.sh %f`
   - Appearance conditions: check “Directories” (and optionally “Other files”)

---

## What the right-click action does

- Scans the folder (or parent of a file)
- Saves a timestamped report to `~/.ava/dirprints/`
- Copies the whole report to the clipboard (if xclip / wl-copy is installed)
- Opens the report in your default text editor
- Shows a desktop notification when finished
