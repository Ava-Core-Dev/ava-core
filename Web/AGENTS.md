# AGENTS — AVA Core Web

## Purpose

This directory contains AVA Core web-facing infrastructure, applications,
assets, services, and related web tooling.

## REQUIRED BEHAVIOR

Before modifying web infrastructure:

1. Inspect the actual directory and deployment structure.
2. Read nested `AGENTS.md` files.
3. Check relevant context under `/home/ava-core/context/`.
4. Verify actual running services and configuration.
5. Do not assume Cloudflare, DNS, tunnel, origin, or deployment paths.

## CLOUDFLARE

Cloudflare configuration must be based on the actual installed binary,
process, configuration, and service state.

Do not assume:

    /etc/cloudflared/

or a system-wide `cloudflared` installation.

Inspect the actual environment before making changes.

## DEPLOYMENT

When debugging a web deployment, distinguish between:

- Source problem
- Local application problem
- Web server problem
- Tunnel problem
- DNS problem
- Browser/client problem
- Cache/CDN problem

Verify each layer rather than guessing.

## BUG MEMORY

Reusable deployment and infrastructure discoveries belong in:

    /home/ava-core/context/common-bugs/cloudflare/

or the appropriate common-bugs category.

Do not store credentials or tokens in documentation.
