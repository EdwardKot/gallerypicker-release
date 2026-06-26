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

def get_device_name() -> str:
    """Determine the device name or model."""
    import platform
    import subprocess
    import shutil
    import socket

    # Try getprop for Android/Termux first
    if shutil.which("getprop"):
        try:
            brand = subprocess.check_output(["getprop", "ro.product.brand"], stderr=subprocess.DEVNULL).decode("utf-8").strip().capitalize()
            model = subprocess.check_output(["getprop", "ro.product.model"], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            if brand or model:
                if brand.lower() in model.lower():
                    return model
                return f"{brand} {model}"
        except Exception:
            pass

    # Try hostname or environment variable or OS-specific model
    if platform.system() == "Darwin":
        try:
            model = subprocess.check_output(["sysctl", "-n", "hw.model"], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            return f"Mac ({model})"
        except Exception:
            return "MacBook"
    elif platform.system() == "Windows":
        return os.environ.get("COMPUTERNAME", "Windows PC")
    
    try:
        hostname = socket.gethostname()
        if hostname:
            return hostname
    except Exception:
        pass

    return "Gallery Server"

