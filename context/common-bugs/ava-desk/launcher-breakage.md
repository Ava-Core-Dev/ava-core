# AVA Desk Launcher Breakage

## Symptom

The AVA Core desktop launcher appears not to open the application.

## Detection

Test the executable directly from a terminal:

    python3 /home/ava-core/operations/system-tools/desk/ava_core_visual_cli/ava_core_visual_cli.py

A desktop launcher can hide Python tracebacks, so direct execution should
always be used to distinguish launcher problems from application crashes.

## Known Launcher

    /home/ava-core/Desktop/AVA Core.desktop

Current launcher executes:

    /usr/bin/python3 /home/ava-core/operations/system-tools/desk/ava_core_visual_cli/ava_core_visual_cli.py

## Prevention

When changing AVA Desk:

1. Compile the Python source.
2. Direct-launch the application.
3. Confirm the GUI opens.
4. Only then test the desktop launcher.

Do not assume the launcher itself is broken until direct execution has been
tested.

## Incident

2026-08-23 — SSH Mode integration.
