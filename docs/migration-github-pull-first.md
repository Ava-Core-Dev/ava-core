# Migration Milestone: GitHub Pull First

The first VPS capability is a controlled update path that mirrors the current AVA workstation behavior: GitHub is the source of deployable code, and the server pulls changes on a schedule.

## Contract

- The server checkout is a clone of `Ava-Core-Dev/ava-core`.
- The server uses a dedicated deployment branch/upstream, normally `origin/main` or `origin/master` as configured by the clone.
- A scheduled pull runs every 10 minutes after boot.
- The updater fetches with prune and uses `git pull --ff-only`.
- A dirty tree, detached HEAD, missing upstream, merge/rebase state, or failed fetch stops the update.
- The updater never pushes, stashes, resets, force-updates, merges, or deletes local runtime data.
- Git output is logged without tokens or passwords.
- The updater uses a lock shared with other future deployment actions so two Git operations cannot overlap.

## Local Desk Database Backup

The VPS is not the only copy of operational state. Ava Desk maintains a local,
rotating backup set and can restore the database without requiring the VPS to be
available.

- The desk requests a consistent export from the server on a schedule and on demand.
- The server creates the export using the database's backup/export mechanism; the desk never copies a live SQLite file over HTTP.
- Each export includes a schema/version marker, source commit, creation timestamp, database type, and SHA-256 checksum.
- The desk verifies the checksum before marking a backup usable.
- Backups are written outside the Git checkout and never auto-pushed to GitHub.
- Keep multiple generations, including daily and weekly retention, rather than replacing one file forever.
- The desk reports last-successful backup, age, size, checksum status, and available restore points.
- Restore is an explicit operator action with a confirmation step; it must stop or coordinate the affected service before replacement.

For SQLite, use a consistent SQLite backup or dump operation. For PostgreSQL,
use a versioned `pg_dump` export and test restoration into a temporary database.
The migration should not call the system protected by a backup until at least
one restore has been proven on the desk.

## Server Files

- `scripts/auto-pull-server.py`: portable updater and status command
- `operations/systemd/ava-github-pull.service`: one pull invocation
- `operations/systemd/ava-github-pull.timer`: ten-minute schedule
- `/opt/ava/data/logs/git-pull-server.log`: operational log

The service runs as the unprivileged `ava` user. The checkout path is `/opt/ava`; change the unit environment and working directory together if another path is chosen.

## GitHub Authentication

Use a deploy key or a non-interactive Git credential mechanism installed on the VPS. The private key belongs outside the repository, with permissions restricted to the `ava` user. Do not put the key, personal access token, `.env`, or `credentials.env` into the checkout.

The deploy credential should have read-only access. The VPS does not need permission to push to GitHub.

## Initial Installation

After cloning the repository and installing the runtime:

```bash
sudo install -o ava -g ava -m 0755 scripts/auto-pull-server.py /opt/ava/scripts/auto-pull-server.py
sudo install -o root -g root -m 0644 operations/systemd/ava-github-pull.service /etc/systemd/system/ava-github-pull.service
sudo install -o root -g root -m 0644 operations/systemd/ava-github-pull.timer /etc/systemd/system/ava-github-pull.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ava-github-pull.timer
sudo systemctl start ava-github-pull.service
```

Verify the checkout without pulling:

```bash
sudo -u ava env AVA_REPO=/opt/ava python3 /opt/ava/scripts/auto-pull-server.py status
```

Inspect the last run:

```bash
journalctl -u ava-github-pull.service -n 50 --no-pager
```

## Restart Boundary

The pull service updates files only. It must not blindly restart AVA on every timer tick. The next migration step should add a deployment coordinator that:

1. Runs the pull service.
2. Detects whether `apps/core`, runtime dependencies, or service configuration changed.
3. Runs the relevant validation or install step.
4. Restarts only the affected managed service.
5. Reports the commit and result to the operator desk.

This keeps a content-only pull from unnecessarily interrupting the radio or API.

## Cutover Safety

Before the first production pull:

- Clone into a parallel VPS path or take a snapshot.
- Confirm the working tree is clean.
- Confirm GitHub authentication is read-only.
- Confirm `.env` and runtime data are ignored and external to Git.
- Run `status` and `--dry-run` manually.
- Keep the current PC as rollback until the VPS has completed a 24-72 hour observation period.
