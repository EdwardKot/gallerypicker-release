import os
import hashlib
from pathlib import Path
from PIL import Image
from app.config import CACHE_DIR, THUMBNAIL_SIZE

# Try to enable HEIC support
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIC_SUPPORTED = True
except ImportError:
    HEIC_SUPPORTED = False

# Fallback for Pillow < 9.1.0 where Image.Resampling doesn't exist
try:
    RESAMPLE_FILTER = Image.Resampling.BICUBIC
except AttributeError:
    RESAMPLE_FILTER = Image.BICUBIC


def get_thumbnail_cache_key(photo_id: str, file_size: int, mtime: float, size: int) -> str:
    """Generate cache key for thumbnail."""
    raw = f"{photo_id}:{file_size}:{mtime}:{size}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def get_thumbnail_path(photo_id: str, file_size: int, mtime: float, size: int = None) -> str:
    """Get the path where the thumbnail should be cached."""
    size = size or THUMBNAIL_SIZE
    cache_key = get_thumbnail_cache_key(photo_id, file_size, mtime, size)
    return os.path.join(CACHE_DIR, f"{cache_key}.jpg")


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
    os.makedirs(CACHE_DIR, exist_ok=True)
    
    # Generate thumbnail
    try:
        with Image.open(source_path) as img:
            # Handle EXIF orientation
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            
            # Calculate new size preserving aspect ratio
            # Long edge = size
            w, h = img.size
            if w >= h:
                new_w = size
                new_h = int(h * size / w)
            else:
                new_h = size
                new_w = int(w * size / h)
            
            # Resize with bicubic filter (2-3x faster than Lanczos on mobile, visually identical)
            img = img.convert("RGB")
            img = img.resize((new_w, new_h), RESAMPLE_FILTER)
            
            # Save without optimize=True to avoid CPU-intensive multi-pass Huffman optimization
            img.save(thumb_path, "JPEG", quality=85)
            return thumb_path
    except Exception as e:
        # If thumbnail generation fails, raise
        raise RuntimeError(f"Failed to generate thumbnail for {source_path}: {e}")


def get_cache_stats() -> dict:
    """Get thumbnail cache statistics."""
    if not os.path.isdir(CACHE_DIR):
        return {"file_count": 0, "total_size": 0, "total_size_human": "0 B"}
    
    file_count = 0
    total_size = 0
    for f in os.listdir(CACHE_DIR):
        fp = os.path.join(CACHE_DIR, f)
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
    if os.path.isdir(CACHE_DIR):
        for f in os.listdir(CACHE_DIR):
            fp = os.path.join(CACHE_DIR, f)
            if os.path.isfile(fp):
                os.remove(fp)
    return {"cleared": stats["file_count"], "freed": stats["total_size_human"]}
