import hashlib
import os

def compute_photo_id(relative_path: str, file_size: int, mtime: float) -> str:
    """Generate a stable photo ID based on file properties."""
    raw = f"{relative_path}:{file_size}:{mtime}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()

def human_size(size_bytes: int) -> str:
    """Convert bytes to human-readable size."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"
