# Gallery Picker

A lightweight, browser-based photo culling tool that runs inside Android Termux.

Designed for professional smartphone sample photographers who want to review large numbers of Android phone photos from a Mac browser, quickly mark selected photos, and download selected originals.

> ⚠️ **Security Warning**: This application is intended for **trusted local network use only**. Do **NOT** expose this service directly to the public internet. There is no authentication or access control.

## Features

- 📸 Browse thousands of photos via responsive thumbnail grid
- ⌨️ Rapid keyboard-driven photo culling workflow
- ❤️ Like/unlike photos with instant persistence
- ✅ Click to select photos, Shift+Click for range selection
- 📅 Date-grouped thumbnails with per-date select-all checkbox
- 📦 Download selected or liked originals
- 🔄 Smart thumbnail caching (1024px long edge)
- 📱 Runs entirely inside Termux — no root, no Android Studio
- 🖥️ Optimized for Mac desktop browser usage

## Workflow

1. Start the server on your Android phone (in Termux)
2. Open `http://PHONE_IP:8787` from your Mac browser
3. Browse the thumbnail grid — scroll infinitely through all photos
4. **Click** to focus a photo, **Double-click** to open viewer
5. Use keyboard shortcuts:
   - `←` `→` `↑` `↓` — Navigate grid
   - `Space` — Open/close viewer
   - `1` — Like photo
   - `0` — Unlike photo
   - `D` — Download current photo (viewer)
   - `2` / `O` — Load original resolution (viewer)
   - `Esc` / `Space` — Close viewer
6. Filter by All / Liked / Unliked photos
7. Select photos with click (or Shift+Click for range), then download selected

## Termux Quick Start

### 1. Install Termux dependencies

```bash
pkg update -y
pkg install python git rust binutils unzip zip -y
termux-setup-storage
```

When Android asks for storage permission, allow it.

> ⚠️ **Do not** run `pip install --upgrade pip`. Termux manages its own Python/pip packages, and upgrading pip manually may break the Termux Python environment.

### 2. Clone the project

```bash
cd ~
git clone https://github.com/EdwardKot/gallerypicker-release.git gallerypicker
cd ~/gallerypicker
```

> Do not use a manually unzipped ZIP folder if you want to update with `git pull`.

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

If this fails on `pydantic-core`, install Rust support first:

```bash
pkg install rust binutils -y
pip install -r requirements.txt
```

### 4. Run the server

```bash
cd ~/gallerypicker
mkdir -p data cache
export PHOTO_ROOT=/storage/emulated/0/DCIM/Camera
export DATABASE_PATH=$PWD/data/gallery.db
export CACHE_DIR=$PWD/cache
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
```

When it works, you should see:

```
Application startup complete.
Uvicorn running on http://0.0.0.0:8787
```

### 5. Open in browser

On the phone:

```
http://127.0.0.1:8787
```

From a Mac or another device on the same Wi-Fi, first check the phone IP:

```bash
ip addr show wlan0
```

Then open:

```
http://PHONE_IP:8787
```

Example:

```
http://192.168.1.157:8787
```

### 6. Stop the server

Press:

```
Ctrl + C
```

### 7. Restart later

```bash
cd ~/gallerypicker
export PHOTO_ROOT=/storage/emulated/0/DCIM/Camera
export DATABASE_PATH=$PWD/data/gallery.db
export CACHE_DIR=$PWD/cache
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
```

### 8. Update later

```bash
cd ~/gallerypicker
git pull
pip install -r requirements.txt
```

Then start again with the run command above.

## Recommended: create run.sh

Create `run.sh` in the project root:

```bash
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
mkdir -p data cache
export PHOTO_ROOT=/storage/emulated/0/DCIM/Camera
export DATABASE_PATH="$PWD/data/gallery.db"
export CACHE_DIR="$PWD/cache"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
```

Make it executable:

```bash
chmod +x run.sh
```

Then start the app with:

```bash
cd ~/gallerypicker
./run.sh
```

## Recommended: create update.sh

Create `update.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
git pull
pip install -r requirements.txt
mkdir -p data cache
echo "Update complete."
echo "Run with: ./run.sh"
```

Make it executable:

```bash
chmod +x update.sh
```

Then update with:

```bash
cd ~/gallerypicker
./update.sh
```

## Find Your Phone's IP

```bash
ip addr show wlan0
```

Look for the `inet` address (e.g., `192.168.1.42`).

Then open from your Mac browser:

```
http://192.168.1.42:8787
```

## Configuration

Set environment variables before running:

| Variable | Default | Description |
|---|---|---|
| `PHOTO_ROOT` | `/storage/emulated/0/DCIM/Camera` | Photo source directory |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8787` | Server port |
| `THUMBNAIL_SIZE` | `1024` | Thumbnail long edge in pixels |
| `DATABASE_PATH` | `./data/gallery.db` | SQLite database path |
| `CACHE_DIR` | `./cache/thumbnails` | Thumbnail cache directory |

Example with custom photo root:

```bash
PHOTO_ROOT=/storage/emulated/0/Pictures python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Web UI |
| `GET` | `/api/photos` | List photos (paginated, filterable) |
| `GET` | `/api/photo/{id}` | Get photo details |
| `GET` | `/api/thumbnail/{id}` | Get thumbnail image |
| `GET` | `/api/original/{id}` | Get original image |
| `POST` | `/api/like/{id}` | Mark photo as liked |
| `POST` | `/api/unlike/{id}` | Remove like from photo |
| `GET` | `/api/counts` | Get photo counts |
| `POST` | `/api/rescan` | Rescan photo library |
| `GET` | `/api/cache/stats` | Thumbnail cache statistics |
| `POST` | `/api/cache/clear` | Clear thumbnail cache |
| `GET` | `/api/download/{id}` | Download original photo |

## Project Structure

```
gallerypicker/
  app/
    __init__.py
    main.py          # FastAPI app entry point
    config.py        # Configuration
    database.py      # SQLite setup
    scanner.py       # Photo directory scanner
    thumbnails.py    # Thumbnail generation
    routes.py        # API routes
    utils.py         # Utility functions
  templates/
    index.html       # Web UI template
  static/
    app.js           # Frontend JavaScript
    style.css        # Styles
  data/
    gallery.db       # SQLite database (auto-created)
  cache/
    thumbnails/      # Thumbnail cache (auto-created)
  run.sh             # One-click start script
  update.sh          # One-click update script
  requirements.txt
  README.md
```

## Notes

- Original photos are **never modified** — the app is read-only toward your photo library
- Thumbnails are cached to disk for fast subsequent loads
- Photo identity uses SHA1 of (relative_path + file_size + mtime) for stability
- Default sort is newest-first by file modification time
- HEIC support requires `pillow-heif` package (included in requirements)
- Designed for libraries of 10,000–50,000+ photos

## Troubleshooting

### "Photo root not found"
Run `termux-setup-storage` and verify the path exists:
```bash
ls /storage/emulated/0/DCIM/Camera
```

### Slow first load
The first scan indexes all photos and generates thumbnails on demand. Subsequent loads use the cached index and thumbnails.

### Can't connect from Mac
- Ensure both devices are on the same Wi-Fi network
- Check the phone IP with `ip addr show wlan0`
- Verify the port is 8787 (or whatever you configured)
- Some networks isolate devices — try a mobile hotspot if needed

## License

MIT
