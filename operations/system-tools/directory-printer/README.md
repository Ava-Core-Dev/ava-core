# Directory Printer

Ava Ops tool for capturing the complete state of a directory tree.

## What it records for every file & folder

- Name + kind label (`DIR`, `IMAGE`, `VIDEO`, `AUDIO`, `TEXT`, `PDF`, `ARCHIVE`, `FILE`)
- Full absolute path + relative path
- Size (files)
- Modified / Created / Accessed / Changed timestamps
- Exact scan timestamp
- First 3 lines of text files (media & binary are skipped)

### Extra media info (when available)
- **Images** → dimensions + format (e.g. `1920x1080 JPEG`)
- **Video / Audio** → duration + resolution + codec (via ffprobe)

## Usage

```bash
# Scan current directory
python3 directory_printer.py

# Scan a specific path
python3 directory_printer.py /path/to/folder

# Save output to a file (recommended for large trees)
python3 directory_printer.py /path/to/folder -o scan_report.txt

# Limit depth
python3 directory_printer.py /path/to/folder --max-depth 3
```

## Quick alias (optional)

```bash
alias dirprint='python3 "/path/to/Directory_Printer/directory_printer.py"'
```
