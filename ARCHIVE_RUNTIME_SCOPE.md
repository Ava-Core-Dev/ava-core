# AVA Ivy runtime archive scope

This archive is the complete runnable code/configuration tree for the current AVA Core build.

Intentionally left on the host and not packaged:
- `database/` — persistent databases and collected data
- `credentials/` — secrets/credentials
- `snap/` — host snapshot/state
- token/secret-bearing files and historical backup/log artifacts
- historical `Downloads/` artifacts — old generated ZIPs and snapshots

Install the runtime tree with:

```bash
./install-ava-core.sh
```

The installer preserves the host-local persistent directories above.
