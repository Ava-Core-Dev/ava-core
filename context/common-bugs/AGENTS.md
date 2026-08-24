# AGENTS — AVA Core Common Bugs

## Purpose

This directory is the persistent operational memory for recurring bugs,
failure modes, incorrect assumptions, implementation mistakes, and useful
discoveries encountered while debugging, fixing, building, or investigating
AVA Core.

The objective is:

> DO NOT MAKE AVA REDISCOVER THE SAME PROBLEM TWICE.

## REQUIRED BEHAVIOR

When debugging, fixing, building, reviewing, or investigating AVA Core:

1. Check this directory for relevant known issues BEFORE assuming the problem
   is new.

2. When a known issue is encountered again, update the existing documentation
   with the new finding rather than creating an unnecessary duplicate.

3. When a genuinely new recurring issue, failure mode, or important
   implementation discovery is found, CREATE a new entry in the appropriate
   category.

4. Findings should be inserted into these documents as they are discovered,
   even if the larger task is still in progress.

5. Do not wait for a bug to become a major incident before documenting a
   useful discovery.

6. Include the actual evidence whenever practical:
   - Exact error messages
   - Exact paths
   - Commands used
   - Relevant service/process names
   - Configuration locations
   - What was expected
   - What actually happened
   - Detection method
   - Successful fix
   - Verification performed

7. If an earlier entry is discovered to be incomplete, incorrect, or based
   on an assumption, CORRECT the entry.

8. Prefer operationally useful information over generic explanations.

## FINDING FORMAT

For significant findings, use:

### Finding — YYYY-MM-DD

**Symptom**

What was observed.

**Cause**

What actually caused it.

**Detection**

How the problem was identified.

**Fix**

What resolved it.

**Verification**

How the fix was confirmed.

**Prevention**

How to avoid rediscovering the problem.

**Evidence**

Relevant commands, paths, errors, or output when useful.

## CATEGORIES

Use the existing categories where appropriate:

- `ava-desk/`
  GUI, launcher, Tkinter, desktop integration, Visual CLI

- `cloudflare/`
  Cloudflare tunnels, ingress, cloudflared, DNS, origin routing

- `ssh/`
  OpenSSH, remote access, keys, ports, authentication

- `cronologicals/`
  Scheduled jobs, recurring processing, SQLite jobs, aggregation,
  locking, missed runs, duplicate processing

- `python/`
  Python runtime behavior, packaging, imports, syntax/runtime differences,
  AST/code-generation issues

Create another category when an existing category does not fit.

## IMPORTANT DISTINCTION

Not every ordinary error needs to become a bug entry.

Document something when it is:

- Likely to recur
- Easy to misunderstand
- Caused by an incorrect architectural assumption
- Relevant to future debugging
- Relevant to automated agents modifying the system
- A non-obvious implementation constraint
- A discovery that could save substantial time later

## AUTOMATED CODE CHANGES

When an automated agent modifies AVA Core code and discovers that its
assumption about the codebase was wrong, document that discovery.

Especially document failures involving:

- Incorrect file locations
- Incorrect service assumptions
- Incorrect class/module boundaries
- Incorrect configuration locations
- Incorrect process ownership
- Incorrect launcher assumptions
- Incorrect API assumptions
- Incorrect filesystem assumptions

## SECURITY

NEVER place the following in this directory:

- Private SSH keys
- Passwords
- API keys
- Cloudflare tokens
- Authentication credentials
- Session cookies
- Private wallet keys
- Other secrets

Document the LOCATION and TYPE of a credential when useful, but never record
the credential itself.

## WEB DIRECTORY

This directory is intentionally stored under:

    /home/ava-core/context/common-bugs/

It is exposed through the AVA directory system and should therefore remain
human- and agent-readable.

Keep filenames descriptive and Markdown content clean enough to be browsed
through the directory web interface.

## FINAL RULE

Every debugging session should leave the system slightly smarter than it
was before.

If a discovery would have saved time had it been known at the beginning of
the investigation, it belongs here.
