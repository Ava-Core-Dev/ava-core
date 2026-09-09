# AGENTS — AVA Core

## Purpose

This is the root operational guidance for the AVA Core system.

AVA Core is a real, running system. Treat the existing filesystem, services,
applications, configuration, databases, automation, and operational
conventions as authoritative.

## REQUIRED BEHAVIOR

Before modifying anything:

1. Inspect the actual files and directories involved.
2. Read applicable nested `AGENTS.md` files.
3. Check `/home/ava-core/context/common-bugs/` for known recurring issues.
4. Do not assume paths, service names, launchers, configuration locations,
   architectures, or process ownership.
5. Preserve working functionality unless the requested change explicitly
   requires otherwise.

When debugging or investigating:

- Prefer evidence over assumptions.
- Inspect actual processes, files, services, logs, and configuration.
- Reproduce failures where practical.
- Verify fixes rather than stopping at successful compilation.

When a reusable discovery is made:

- Update the relevant entry in `/home/ava-core/context/common-bugs/`.
- Add a new entry when the issue is genuinely new.
- Correct existing documentation when an earlier assumption was wrong.

## CODE CHANGES

Before modifying source:

- Inspect the relevant source.
- Make a timestamped backup when working on important operational files.
- Make the smallest safe change.
- Compile or syntax-check where applicable.
- Perform a runtime test when applicable.
- Verify the actual behavior.

Do not repeatedly patch based on guessed structure.

## PROJECT BOUNDARIES

Do not treat dependency caches, generated files, or third-party source as
AVA Core project code.

In particular, avoid creating or modifying project-level agent guidance
inside:

- `.cargo/registry/`
- `.cursor/plugins/cache/`
- `.codex/.tmp/`
- `node_modules/`
- `__pycache__/`
- `.venv/`
- `venv/`

unless explicitly required.

## CONTEXT

Persistent operational knowledge belongs under:

    /home/ava-core/context/

Recurring bugs and discoveries belong under:

    /home/ava-core/context/common-bugs/

Read and update that knowledge as part of debugging and development.

## NESTED AGENTS

Nested `AGENTS.md` files provide more specific instructions for their
directory and descendants.

When a nested file conflicts with this file, follow the more specific
instruction unless it violates a higher-level system requirement.

## SECURITY

Never place passwords, private keys, API keys, tokens, session cookies,
wallet secrets, or other credentials in source-control-style documentation.

Document credential locations/types when operationally useful, but never
record the secret itself.

## FINAL RULE

Every debugging, building, and development session should leave AVA Core
better understood than it was before.
