# AGENTS — AVA Core Operations

## Purpose

This directory contains operational tools, services, automation, and system
management components for AVA Core.

## REQUIRED BEHAVIOR

Treat operational code as production-sensitive.

Before changing an operational component:

1. Inspect its current implementation.
2. Check relevant nested `AGENTS.md` files.
3. Check `/home/ava-core/context/common-bugs/`.
4. Identify dependencies, services, schedules, and callers.
5. Make a backup when appropriate.
6. Test the change directly.

Do not assume a service, path, process, or configuration location.

## VERIFICATION

For operational changes verify:

- Syntax/compile status
- Runtime behavior
- Relevant service/process state
- Logs where applicable
- Actual filesystem/configuration state

A successful compile is not considered a successful operational test by
itself.

## KNOWLEDGE

When debugging reveals a reusable operational discovery, document it under:

    /home/ava-core/context/common-bugs/

Do this during the investigation rather than waiting until later.
