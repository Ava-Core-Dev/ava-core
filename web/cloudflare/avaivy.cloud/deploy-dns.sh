#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARED="/home/ava-core/Web/cloudflare/cloudflared"
TUNNEL="03a08580-e6c3-4d07-bb58-8790706b5297"

test -x "$CLOUDFLARED"

"$CLOUDFLARED" tunnel route dns "$TUNNEL" avaivy.cloud
"$CLOUDFLARED" tunnel route dns "$TUNNEL" www.avaivy.cloud
"$CLOUDFLARED" tunnel route dns "$TUNNEL" directory.avaivy.cloud

echo "Ava Ivy DNS routes applied to tunnel $TUNNEL."
