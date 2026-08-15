#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "[X] ไม่พบ Node.js — ติดตั้งจาก https://nodejs.org ก่อน"; exit 1; }
node scripts/serve.mjs start
