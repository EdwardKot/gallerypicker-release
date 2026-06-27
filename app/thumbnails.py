import os
import hashlib
import shutil
import logging
import traceback
from pathlib import Path
from PIL import Image
from app.config import CACHE_DIR, THUMBNAIL_SIZE

logger = logging.getLogger("uvicorn.error")
THUMBNAIL_CACHE_VERSION = 2

# Ensure isolated thumbnail subdirectory to protect sibling cache directories.
normalized_cache_dir = os.path.normpath(CACHE_DIR)
if os.path.basename(normalized_cache_dir) == "thumbnails":
    THUMBNAIL_CACHE_DIR = normalized_cache_dir
else:
    THUMBNAIL_CACHE_DIR = os.path.join(normalized_cache_dir, "thumbnails")

def init_thumbnail_cache():
    """Validate cache version and clear/reinitialize if needed.
    Ensures that unexpected errors do not block application startup.
    """
    version_file = os.path.join(THUMBNAIL_CACHE_DIR, ".version")
    
    # 1. Ensure THUMBNAIL_CACHE_DIR exists
    try:
        os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)
    except OSError as e:
        logger.warning(f"Failed to create cache directory {THUMBNAIL_CACHE_DIR}: {e}")
        return

    # 2. Check existing version
    current_version = None
    if os.path.exists(version_file):
        try:
            with open(version_file, "r") as f:
                current_version = int(f.read().strip())
        except OSError:
            # Expected recovery if file is unreadable/corrupt
            pass
        except Exception:
            logger.exception("Unexpected error while reading .version file")

    # 3. If missing or mismatched, clear thumbnails folder (only contents of THUMBNAIL_CACHE_DIR)
    if current_version != THUMBNAIL_CACHE_VERSION:
        print(f"Thumbnail cache version mismatch ({current_version} vs {THUMBNAIL_CACHE_VERSION}). Clearing thumbnails...")
        try:
            for item in os.listdir(THUMBNAIL_CACHE_DIR):
                if item == ".version":
                    continue
                item_path = os.path.join(THUMBNAIL_CACHE_DIR, item)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except OSError as e:
                    logger.warning(f"Failed to delete {item_path}: {e}")
        except OSError as e:
            logger.warning(f"Failed to list or clear cache directory {THUMBNAIL_CACHE_DIR}: {e}")
        except Exception:
            logger.exception("Unexpected error while clearing cache directory")

        # 4. Write new version file
        try:
            with open(version_file, "w") as f:
                f.write(str(THUMBNAIL_CACHE_VERSION))
        except OSError as e:
            logger.warning(f"Failed to write .version file to {version_file}: {e}")
        except Exception:
            logger.exception("Unexpected error while writing .version file")


# Try to enable HEIC support
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIC_SUPPORTED = True
except ImportError:
    HEIC_SUPPORTED = False

# Fallback for Pillow < 9.1.0 where Image.Resampling doesn't exist
try:
    _LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    _LANCZOS = Image.LANCZOS


def get_thumbnail_cache_key(photo_id: str, file_size: int, mtime: float, size: int) -> str:
    """Generate cache key for thumbnail."""
    raw = f"{photo_id}:{file_size}:{mtime}:{size}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def get_thumbnail_path(photo_id: str, file_size: int, mtime: float, size: int = None) -> str:
    """Get the path where the thumbnail should be cached."""
    size = size or THUMBNAIL_SIZE
    cache_key = get_thumbnail_cache_key(photo_id, file_size, mtime, size)
    return os.path.join(THUMBNAIL_CACHE_DIR, f"{cache_key}.jpg")


def generate_thumbnail(source_path: str, photo_id: str, file_size: int, mtime: float, size: int = None) -> str:
    """Generate a thumbnail and return the cached file path.
    Returns the path to the cached thumbnail.
    Skips generation if cache already exists."""
    size = size or THUMBNAIL_SIZE
    thumb_path = get_thumbnail_path(photo_id, file_size, mtime, size)
    
    # Return cached version if exists
    if os.path.exists(thumb_path):
        return thumb_path
    
    # Ensure cache dir exists
    os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)
    
    # Generate thumbnail
    try:
        with Image.open(source_path) as img:
            # Hint libjpeg to decode at reduced resolution (powers of 2 only).
            # For JPEG this happens inside the DCT stage — less I/O work, less memory.
            # We ask for 2× the target so the subsequent LANCZOS pass has enough detail.
            # draft() is a hint; libjpeg picks the nearest supported scale (1/2, 1/4, 1/8).
            # Only effective for JPEG; silently ignored for HEIC/PNG/etc.
            img.draft("RGB", (size * 2, size * 2))

            # Extract ICC profile before any transformations (like exif_transpose or convert)
            icc_profile = img.info.get("icc_profile")

            # Handle EXIF orientation
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass

            # thumbnail() is strictly aspect-ratio preserving, long-edge ≤ size, no crop.
            img = img.convert("RGB")
            img.thumbnail((size, size), _LANCZOS)

            save_kwargs = {
                "quality": 85,
                "subsampling": 2,
                "optimize": True,
            }
            if icc_profile:
                save_kwargs["icc_profile"] = icc_profile

            img.save(thumb_path, "JPEG", **save_kwargs)
            return thumb_path
    except Exception as e:
        # If thumbnail generation fails, raise
        raise RuntimeError(f"Failed to generate thumbnail for {source_path}: {e}")


def get_cache_stats() -> dict:
    """Get thumbnail cache statistics."""
    if not os.path.isdir(THUMBNAIL_CACHE_DIR):
        return {"file_count": 0, "total_size": 0, "total_size_human": "0 B"}
    
    file_count = 0
    total_size = 0
    for f in os.listdir(THUMBNAIL_CACHE_DIR):
        fp = os.path.join(THUMBNAIL_CACHE_DIR, f)
        if os.path.isfile(fp):
            file_count += 1
            total_size += os.path.getsize(fp)
    
    from app.utils import human_size
    return {
        "file_count": file_count,
        "total_size": total_size,
        "total_size_human": human_size(total_size)
    }


def clear_cache() -> dict:
    """Clear all cached thumbnails."""
    stats = get_cache_stats()
    if os.path.isdir(THUMBNAIL_CACHE_DIR):
        for f in os.listdir(THUMBNAIL_CACHE_DIR):
            fp = os.path.join(THUMBNAIL_CACHE_DIR, f)
            if os.path.isfile(fp):
                os.remove(fp)
    return {"cleared": stats["file_count"], "freed": stats["total_size_human"]}
