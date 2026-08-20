#!/usr/bin/env bash
set -euo pipefail

APP="/home/ava-core/ava/ava-core-v2/packages/web/alexrs94.site"
PROJECT="alexrs94-site"

bash "/home/ava-core/ava/ava-core-v2/scripts/deploy-next-to-pages.sh" "$APP" "$PROJECT"

