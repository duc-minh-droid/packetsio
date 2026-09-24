#!/usr/bin/env bash
# Rebuild the WebAssembly engine used by the frontend.
# Needs: rustup target add wasm32-unknown-unknown
#        cargo install wasm-bindgen-cli --version 0.2.127   (must match Cargo.lock)
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --lib --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/packetsio.wasm \
  --target web --out-dir packetsio-frontend-port/src/wasm --out-name packetsio
ls -l packetsio-frontend-port/src/wasm
