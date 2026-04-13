#!/usr/bin/env bash
# One command to run all local checks (no comment lines to paste — safe for zsh).
# Prereqs: backend :5000, Vite :3000
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/full_verify.sh"
