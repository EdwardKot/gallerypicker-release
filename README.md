# Gallery Picker

**[简体中文](README_CN.md) | English**

A lightweight, browser-based photo culling tool that runs inside Android Termux.

Designed for professional smartphone sample photographers who want to review large numbers of Android phone photos from a Mac browser, quickly mark selected photos, and download selected originals.

## Features

- 📸 Browse thousands of photos via responsive thumbnail grid
- ⌨️ Rapid keyboard-driven photo culling workflow
- ❤️ Like/unlike photos with instant persistence
- ✅ Click to select photos, Shift+Click for range selection
- 📅 Date-grouped thumbnails with per-date select-all checkbox
- 📦 Download selected or liked originals
- 🔄 Smart thumbnail caching (1024px long edge)
- 🔒 4-digit PIN access control — browser remembers it via localStorage
- 📱 Runs entirely inside Termux — no root, no Android Studio
- 🖥️ Optimized for Mac desktop browser usage

## Installation (one command)

Open Termux and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/EdwardKot/gallerypicker-release/main/bootstrap.sh | bash
```

This will:
1. Install all system and Python dependencies
2. Request Android storage permission (tap **Allow** when prompted)
3. Clone the project
4. Register a `gallery` shortcut command in your shell

> ⚠️ **Do not** run `pip install --upgrade pip`. Termux manages its own Python environment and upgrading pip manually may break it.

## Daily Usage

After installation, just type in Termux:

```bash
gallery
```

A menu appears:

```
  ╔══════════════════════════════╗
  ║       Gallery Picker         ║
  ╚══════════════════════════════╝

    1) 启动服务
    2) 更新到最新版本
    3) 退出
```

Choose **1** to start the server. The terminal will show:

```
============================================================
  Gallery Picker
============================================================
  Photo root : /storage/emulated/0/DCIM/Camera
  Access URL : http://192.168.1.157:8787
  访问密钥   : 3847
============================================================
```

Open the **Access URL** on any device on the same Wi-Fi. The browser will show a PIN dialog — enter the 4-digit code shown in the terminal. The browser remembers it via localStorage, so you only need to enter it once per device.

Stop the server with `Ctrl+C`, then press any key to return to the menu.

## Workflow

1. Start the server (`gallery` → 1)
2. Open the Access URL from your Mac browser, enter the PIN once
3. Browse the thumbnail grid
4. **Click** to focus a photo, **Double-click** to open viewer
5. Keyboard shortcuts:
   - `←` `→` `↑` `↓` — Navigate grid
   - `Space` — Open/close viewer
   - `1` — Like photo
   - `0` — Unlike photo
   - `D` — Download current photo (viewer)
   - `Esc` / `Space` — Close viewer
6. Filter by All / Liked photos
7. Select photos with click (Shift+Click for range), then download

## Security

- A random 4-digit PIN is generated each time the server starts
- The PIN is shown in the Termux terminal and must be entered once per browser
- Once entered correctly, the browser stores it in localStorage — no need to re-enter
- To use a fixed PIN across restarts, set the `ACCESS_PIN` environment variable in `run.sh`
- Intended for **trusted local network use only** — do not expose to the public internet

## Manual Usage (without menu)

```bash
cd ~/gallerypicker
./run.sh        # Start
./update.sh     # Update to latest version
Ctrl+C          # Stop
```

## Configuration

Set environment variables in `run.sh` or export them before running:

| Variable | Default | Description |
|---|---|---|
| `PHOTO_ROOT` | `/storage/emulated/0/DCIM/Camera` | Photo source directory |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8787` | Server port |
| `THUMBNAIL_SIZE` | `1024` | Thumbnail long edge in pixels |
| `DATABASE_PATH` | `./data/gallery.db` | SQLite database path |
| `CACHE_DIR` | `./cache/thumbnails` | Thumbnail cache directory |
| `ACCESS_PIN` | *(random 4-digit)* | Fixed PIN to use across restarts |

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
    main.py          # FastAPI app, PIN auth middleware, startup banner
    config.py        # Configuration + ACCESS_PIN
    database.py      # SQLite setup
    scanner.py       # Photo directory scanner
    thumbnails.py    # Thumbnail generation
    routes.py        # API routes
    utils.py         # Utility functions
  templates/
    index.html       # Web UI (includes PIN dialog)
  static/
    app.js           # Frontend JS (PIN auth, API wrapper)
    style.css        # Styles
  data/
    gallery.db       # SQLite database (auto-created)
  cache/
    thumbnails/      # Thumbnail cache (auto-created)
  bootstrap.sh       # One-command installer
  menu.sh            # TUI launcher menu
  run.sh             # Direct start script
  update.sh          # Update script
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
- The Access URL is printed in the terminal when the server starts
- Some networks isolate devices — try a mobile hotspot if needed

### PIN not working
The PIN changes every time the server restarts. Check the current PIN in the Termux terminal. To use a fixed PIN, set `ACCESS_PIN=1234` in `run.sh`.

## License

MIT
