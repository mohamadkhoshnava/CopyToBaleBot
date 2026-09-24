#!/bin/sh
# Registers the command menu on both bots (uses tokens from .env).
set -e
cd "$(dirname "$0")/.."
set -a
. ./.env
set +a
CMDS='{"commands":[{"command":"start","description":"منوی اصلی"},{"command":"new","description":"اتصال کانال جدید"},{"command":"links","description":"اتصال‌های من"},{"command":"stats","description":"آمار"},{"command":"help","description":"راهنما"},{"command":"cancel","description":"لغو عملیات"}]}'
curl -s -X POST -H 'Content-Type: application/json' -d "$CMDS" "https://api.telegram.org/bot$TG_BOT_TOKEN/setMyCommands"; echo
curl -s -X POST -H 'Content-Type: application/json' -d "$CMDS" "https://tapi.bale.ai/bot$BALE_BOT_TOKEN/setMyCommands"; echo
