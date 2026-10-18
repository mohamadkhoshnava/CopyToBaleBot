#!/bin/sh
# Runs scripts/ipcheck.js inside Telegram Serverless (without deploying it) and
# prints the egress IPs plus Bale reachability. Usage: scripts/ipcheck.sh [rounds]
# Run it a few times over a day to collect more of the pool.
# `tgcloud run` only accepts handler modules named after an update type, so the
# script is placed at the unused handlers/inline_query.js for the run only.
set -e
cd "$(dirname "$0")/.."
TMP=handlers/inline_query.js
[ -e "$TMP" ] && { echo "$TMP already exists; refusing to overwrite" >&2; exit 1; }
cp scripts/ipcheck.js "$TMP"
trap 'rm -f "$TMP"' EXIT INT TERM
scripts/tg.sh run inline_query "{rounds: ${1:-3}}"
