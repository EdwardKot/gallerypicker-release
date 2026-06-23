# Termux Gallery Picker

A lightweight, browser-based photo culling tool that runs inside Android Termux.

Designed for professional smartphone sample photographers who want to review large numbers of Android phone photos from a Mac browser, quickly mark selected photos, and download selected originals.

> ⚠️ **Security Warning**: This application is intended for **trusted local network use only**. Do **NOT** expose this service directly to the public internet. There is no authentication or access control.

## Features

- 📸 Browse thousands of photos via responsive thumbnail grid
- ⌨️ Rapid keyboard-driven photo culling workflow
- ❤️ Like/unlike photos with instant persistence
- 📦 Download liked originals as ZIP (preserves original format)
- 🔄 Smart thumbnail caching (1024px long edge)
- 📱 Runs entirely inside Termux — no root, no Android Studio
- 🖥️ Optimized for Mac desktop browser usage

## Workflow

1. Start the server on your Android phone (in Termux)
2. Open `http://PHONE_IP:8787` from your Mac browser
3. Browse the thumbnail grid
4. Click a photo to enter Viewer Mode
5. Use keyboard shortcuts:
   - `←` / `→` — Navigate photos
   - `1` — Like photo (auto-advances to next)
   - `0` — Unlike photo (stays on current)
   - `Esc` — Return to gallery
6. Filter by Liked photos
7. Download liked originals as ZIP

## Install in Termux

```bash
# Update Termux packages
pkg update && pkg upgrade -y

# Install required packages
pkg install python python-pillow git zip -y

# Grant storage access
termux-setup-storage
```

## Setup Project

```bash
# Clone or create project directory
mkdir -p ~/termux-gallery-picker
cd ~/termux-gallery-picker

# Copy project files here (or git clone)

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

## Run

```bash
cd ~/termux-gallery-picker
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8787
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

## Stop

Press `Ctrl+C` in Termux.

## Restart Later

```bash
cd ~/termux-gallery-picker
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8787
```

## Configuration

Set environment variables before running:

| Variable | Default | Description |
|---|---|---|
| `PHOTO_ROOT` | `~/storage/shared/DCIM/Camera` | Photo source directory |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8787` | Server port |
| `THUMBNAIL_SIZE` | `1024` | Thumbnail long edge in pixels |
| `DATABASE_PATH` | `./data/gallery.db` | SQLite database path |
| `CACHE_DIR` | `./cache/thumbnails` | Thumbnail cache directory |

Example with custom photo root:

```bash
PHOTO_ROOT=~/storage/shared/Pictures uvicorn app.main:app --host 0.0.0.0 --port 8787
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
| `GET` | `/api/download-liked` | Download all liked as ZIP |

## Project Structure

```
termux-gallery-picker/
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
ls ~/storage/shared/DCIM/Camera
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
