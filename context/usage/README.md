# AI Account Usage Ledger

This folder is the local, persistent data store for Ava Desk's **Usage** tab.

- `accounts.json` contains account names, providers, reset schedules, availability,
  billing/information, notes, and API-token *usage summaries*.
- `sessions/<account-id>/` contains session logs saved from the Usage tab as `.txt` files.

Never put API tokens, passwords, cookies, SSH keys, or other credentials here. The
Usage tab records token usage only, not token values.
