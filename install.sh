#!/data/data/com.termux/files/usr/bin/bash

set -e

pkg update -y
pkg install python rust binutils git -y

pip install -r requirements.txt

mkdir -p data cache

chmod +x run.sh

echo
echo "Install complete."
echo "Run with:"
echo "./run.sh"
