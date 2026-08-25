# AVA IVY — DEVELOPER CONTEXT / AGENT RULES

## 1. READ THIS FIRST

This directory is the machine-readable developer context for Ava Ivy.
Agents working on Ava Ivy MUST read this file before making architectural,
operational, debugging, or file-change decisions.

The public site is a view of the system, not proof that the underlying system
is healthy. A page loading successfully does not prove that its API, backend,
database, collector, scheduler, or runtime is healthy.

## 2. SOURCE-OF-TRUTH DEBUGGING RULE

When a public page shows bad, missing, stale, empty, or nonsensical data,
DO NOT stop at the visible page and DO NOT guess.

Trace the actual data path:

    public page
        -> API endpoint
        -> backend/API handler
        -> database or source data
        -> collector/builder
        -> Cronological/scheduler/service
        -> runtime state

Inspect the real files and live responses at each relevant layer until the
actual source of the problem is established.

Fix the originating layer whenever possible. Do not hide a backend/data
problem with a frontend-only patch.

If a page says something such as "CORE OFFLINE", treat that as an observed
frontend status signal only. Verify the underlying service/API/runtime before
claiming that Core is actually offline.

## 3. MACHINE ACCESS COMES BEFORE ASSUMPTIONS

Use the documented machine-readable interfaces immediately.

Preferred sequence:

1. Read the developer context and resource index.
2. Discover the real project tree and relevant paths.
3. Read the actual source files involved.
4. Query the relevant live API endpoint when applicable.
5. Inspect the actual database/source/collector/scheduler that produces the data.
6. Only then decide what needs to change.

Known machine-readable file access:

    /ava-ivy/file/<relative-path>

Use the documented JSON/file interfaces from the live developer context rather
than inventing paths.

Never claim that a file, endpoint, database, service, or operation was inspected
unless it was actually inspected.

If a machine interface fails, report the exact resource/endpoint attempted and
the actual failure. Do not silently substitute a guess.

## 4. HANDOFF RULE — THIS IS THE DEFAULT AND REQUIRED METHOD

Ava Ivy code changes are handed off as FILES THAT DROP DIRECTLY INTO THE
EXISTING DIRECTORY TREE.

The recipient should be able to:

    drag/drop or copy the provided files into the existing Ava Ivy tree

and have the files replace their same-path counterparts and merge naturally
with the existing tree.

### DO NOT create installation procedures for ordinary edits.

Do NOT create:

- installers
- setup programs
- migration scripts
- wrapper scripts
- renamed project directories
- alternate project roots
- "v2", "new", "fixed", or other replacement directory names
- extra manual file-moving steps
- giant one-off installation workflows

Do NOT rename an existing file or directory merely to deliver an update.
A handoff must preserve the existing path so the user does not have to repair
paths, references, cron entries, services, or configuration after receiving it.

### Allowed exception: simple terminal automation

If the change can be applied safely and quickly by ONE SIMPLE BASH COMMAND
(or a short direct terminal command) against the existing paths, a terminal
handoff is allowed and may be preferable.

The command must:

- use the existing paths
- make no unnecessary renames
- avoid creating an installer
- fail safely when expected files are absent
- validate the result
- preserve a backup when the change is destructive

The automated agent terminal route may use this method directly.

## 5. FILE HANDOFF FORMAT

For normal file-based changes, provide the actual files at their final paths.
The directory structure must mirror the live Ava Ivy tree.

Example:

    context/dev/AGENTS.md
    context/dev/llms.txt
    web/sites/avaivy.cloud/js/energy-board.js

Do not make the user rename files, move files into newly invented directories,
or run a second installer just to make a handoff work.

## 6. PRESERVE THE EXISTING SYSTEM

Before replacing a file, verify that the target path exists and inspect its
current contents when the change depends on existing code.

Do not overwrite unrelated work.
Do not rebuild an entire subsystem when the requested change only needs a
specific existing file.
Do not create duplicate implementations when the project already has the
operation, collector, state file, database, API, or Cronological required.

For example, if an operation already exists under:

    /home/ava-core/operations/news/<state>/news.py

use that existing operation rather than creating a second state-news system.

## 7. VALIDATION IS PART OF THE HANDOFF

Before declaring a change complete:

- inspect the changed files
- validate syntax
- validate the relevant API
- validate the relevant live page when applicable
- validate the selected time window/data path when applicable
- check for regressions
- verify that the intended source data changed
- verify the backup when one was required

A successful write or successful command exit is NOT proof that the change is
correct.

Never hand the user an unverified patch.

## 8. DO NOT LIE ABOUT CONTEXT OR WORK DONE

Never say "I checked", "I read", "I tested", "I verified", "the service is
running", "the API is working", or similar unless the evidence was actually
obtained.

Distinguish clearly between:

- observed fact
- file/source evidence
- live API evidence
- inference
- proposed change

If the required evidence cannot be obtained, say exactly what is unavailable.

## 9. CONTEXT MAINTENANCE

When a debugging discovery is reusable, record it in the appropriate existing
context/common-bugs or developer-context entry.

Prefer exact:

- paths
- filenames
- endpoints
- commands
- database names
- scheduler locations
- error messages
- validation procedures
- successful fixes

Never store secrets, credentials, tokens, private keys, cookies, or other
sensitive authentication material in public/machine-readable context.
