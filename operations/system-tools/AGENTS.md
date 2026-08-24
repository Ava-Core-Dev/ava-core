# AGENTS — AVA Core System Tools

## Purpose

System tools provide utilities used to operate, inspect, control, or monitor
AVA Core.

## REQUIRED BEHAVIOR

Before modifying a system tool:

- Inspect the complete relevant source.
- Determine how it is launched.
- Determine what services/processes it interacts with.
- Check its nested `AGENTS.md`.
- Check `/home/ava-core/context/common-bugs/`.
- Preserve existing behavior unless explicitly changing it.

## TESTING

Use the tool itself for runtime verification when practical.

For Python:

    python3 -m py_compile <file>

is only a syntax check.

Also perform an actual launch/runtime test when the tool supports it.

For GUI applications, direct execution should be tested before diagnosing
desktop-launcher problems.

## PATCHING

Automated patches must account for actual source structure.

Do not assume:

- class boundaries
- module launchers
- configuration paths
- service names
- filesystem locations

Use AST inspection for structural Python modifications when appropriate.

## BUG MEMORY

Record reusable discoveries in:

    /home/ava-core/context/common-bugs/

Especially document failures caused by incorrect assumptions.
