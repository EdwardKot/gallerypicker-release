#!/data/data/com.termux/files/usr/bin/bash

cd "$(dirname "$0")"

mkdir -p data cache

export PHOTO_ROOT=/storage/emulated/0/DCIM/Camera
export DATABASE_PATH="$PWD/data/gallery.db"
export CACHE_DIR="$PWD/cache"

python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
