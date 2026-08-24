# AGENTS — AVA Core Context

## Purpose

This directory contains persistent context and operational knowledge for
AVA Core.

Treat these files as system memory, not disposable notes.

## REQUIRED BEHAVIOR

Before making architectural or operational assumptions, inspect relevant
context here.

When debugging reveals reusable information:

1. Search existing context first.
2. Update an existing entry if appropriate.
3. Create a new entry when the discovery is genuinely new.
4. Preserve exact paths, commands, service names, and important evidence.
5. Never store secrets.

## Common Bugs

The recurring-bug knowledge base is:

    /home/ava-core/context/common-bugs/

Agents debugging AVA Core should check it before assuming a problem is new.

When a bug or implementation mistake is discovered, add the finding there
when it is likely to recur or would have saved time if known earlier.

## CONTENT QUALITY

Prefer:

- Exact paths
- Exact commands
- Actual error messages
- Actual architecture
- Detection procedures
- Successful fixes
- Verification procedures
- Prevention notes

Avoid vague or speculative documentation.
