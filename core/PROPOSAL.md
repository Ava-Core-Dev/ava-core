# Proposal: Ava Ivy Discord assistant

## Summary

Let staff (and later players in proposal threads) talk to **Ava Ivy** for **design recommendations** and RootMC Q&A without waiting for a Cursor relay.

Trigger: bot mention, reply-to-Ava, or clear `Ava` / `Ava Ivy` address in watched channels (proposals, admins, general — configurable).

## Scope (v0)

Recommendations + wiki/help chat only in public Discord. No secret dumps. Features → proposals + votes.

## Runtime

`Web Files/rootmc-ava/`:

- Local HTTP `:8787` health + `/v1/recommend`
- Channel poller for Ava triggers → ack → one Root Server answer
- Instant canned lines + transfer beats while digging

## Success

- Asking Ava in a watched channel gets a useful, accurate reply
- No backlog spam on restart
- Public copy never brands old “Sexi” names
