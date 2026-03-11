#!/usr/bin/env bash
set -euo pipefail

# Run this only inside WSL/Linux.
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script must be run in WSL/Linux."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "Checking runtime..."
echo "node: $(which node || true)"
echo "pnpm: $(which pnpm || true)"
node -p "process.platform + ' ' + process.arch"

echo "Removing node_modules..."
rm -rf node_modules

echo "Installing dependencies for Linux..."
pnpm install

echo "Rebuilding esbuild for Linux..."
pnpm rebuild esbuild

echo "Verifying tsx/esbuild toolchain..."
pnpm tsx -e "const x: number = 1; console.log('tsx ok', x)"

echo "WSL dependency reset complete."
