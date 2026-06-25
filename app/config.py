import os
from pathlib import Path

# Base directory of the project
BASE_DIR = Path(__file__).resolve().parent.parent

# Photo source root - default to Termux camera path
PHOTO_ROOT = os.environ.get("PHOTO_ROOT", os.path.expanduser("~/storage/shared/DCIM/Camera"))

# Server settings
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8787"))

# Thumbnail settings
THUMBNAIL_SIZE = int(os.environ.get("THUMBNAIL_SIZE", "1024"))

# Database
DATABASE_PATH = os.environ.get("DATABASE_PATH", str(BASE_DIR / "data" / "gallery.db"))

# Cache
CACHE_DIR = os.environ.get("CACHE_DIR", str(BASE_DIR / "cache" / "thumbnails"))

# Supported image extensions
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".dng"}

# Pagination
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500

# Access PIN (4-digit numeric, auto-generated at startup if not set via env)
# Set ACCESS_PIN env var to use a fixed PIN across restarts
ACCESS_PIN: str = ""  # populated by main.py at startup
