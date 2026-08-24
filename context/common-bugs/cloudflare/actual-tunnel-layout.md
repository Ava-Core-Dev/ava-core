# Actual Cloudflare Tunnel Layout

## Important

Do not assume Cloudflare is installed system-wide.

The active cloudflared binary may be installed under the AVA Core user's
home directory.

Known executable:

    /home/ava-core/Web/cloudflare/cloudflared

## Active Process

Known active process pattern:

    /home/ava-core/Web/cloudflare/cloudflared \
      --config /home/ava-core/Web/cloudflare/avaivy.cloud/config.yml \
      tunnel run

## User Configuration

    /home/ava-core/.cloudflared/config.yml

## Important

The configuration is NOT necessarily:

    /etc/cloudflared/config.yml

and:

    sudo cloudflared ...

may fail even when the user's cloudflared works.

Use:

    which cloudflared
    cloudflared --version
    ps aux | grep '[c]loudflared'

before making assumptions.

## Incident

2026-08-23 — SSH/Cloudflare investigation.
