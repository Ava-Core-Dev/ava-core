# AVA Core — Common Bugs

Operational memory for recurring failures, mistakes, and implementation
patterns encountered while developing and maintaining AVA Core.

This is NOT a general documentation directory.

Record problems that are likely to recur, especially problems caused by:

- Incorrect assumptions about the actual filesystem
- Incorrect assumptions about AVA's architecture
- Automated code modifications
- Service/process interactions
- Cloudflare configuration
- SSH configuration
- Cronological jobs
- Python/Tkinter behavior
- Desktop launcher behavior

Each bug should document:

1. Symptom
2. Cause
3. Detection
4. Fix
5. Prevention
6. Date/incident when useful

Prefer exact paths, commands, error messages, and verification procedures
over vague descriptions.

The goal is simple:

DO NOT MAKE AVA REDISCOVER THE SAME BUG TWICE.
