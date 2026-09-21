#!/bin/bash
# Supabase SQL helper — reads the Supabase CLI's cached token from macOS Keychain.
RAW=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)
TOK=$(echo "$RAW" | sed 's/^go-keyring-base64://' | base64 -d 2>/dev/null); [ -z "$TOK" ] && TOK="$RAW"
python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" | \
  curl -s -X POST https://api.supabase.com/v1/projects/uazpbuvqisbpykiuebbn/database/query \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d @-
