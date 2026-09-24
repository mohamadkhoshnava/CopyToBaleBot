#!/bin/sh
# Runs the tgcloud CLI with TGCLOUD_TOKEN (and friends) loaded from .env.
set -e
cd "$(dirname "$0")/.."
set -a
. ./.env
set +a
exec npx tgcloud "$@"
