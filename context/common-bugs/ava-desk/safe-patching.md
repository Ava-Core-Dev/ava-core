# Safe AVA Desk Patching

## Rule

Always create a timestamped backup before modifying AVA Desk source.

Example:

    cp ava_core_visual_cli.py ava_core_visual_cli.py.backup_YYYYMMDD_HHMMSS

## Required Checks

After modifying the file:

    python3 -m py_compile ava_core_visual_cli.py

For class modifications, use AST inspection where possible.

For GUI changes:

    python3 ava_core_visual_cli.py

For launcher verification, test the actual desktop launcher afterward.

## Important

Do not repeatedly patch based on guessed file structure.

Inspect the actual source first.

If the source structure differs from assumptions, adapt the patch to the
real structure.

## Incident

2026-08-23 — SSH Mode integration.
