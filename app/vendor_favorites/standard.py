import shutil
import subprocess

from .base import BaseFavoritesAdapter


class StandardAdapter(BaseFavoritesAdapter):
    """Fallback adapter using the standard Android MediaStore content CLI.

    Reads is_favorite via `content query --uri content://media/external/file`.
    This works on AOSP and most brands for the read path.

    Write support is NOT implemented here because OEM behavior diverges:
    - Some brands (e.g. Samsung) maintain a parallel private favorites DB
      that doesn't update when MediaStore is_favorite changes.
    - Add a brand-specific adapter (e.g. SamsungAdapter) when write support
      is needed for that brand, and register it above StandardAdapter in
      the registry so it takes priority.
    """

    def supports(self, brand: str) -> bool:
        # Catch-all fallback — always True.
        # Brand-specific adapters registered before this one take priority.
        return True

    def read_favorites(self) -> set:
        content_cmd = shutil.which("content")
        if not content_cmd:
            return set()

        try:
            args = [
                content_cmd, "query",
                "--uri", "content://media/external/file",
                "--projection", "_data",
                "--where", "is_favorite=1",
            ]
            res = subprocess.run(args, capture_output=True, text=True, timeout=10)
            if res.returncode != 0 or not res.stdout:
                return set()

            favorites = set()
            for line in res.stdout.splitlines():
                line = line.strip()
                if not line.startswith("Row:"):
                    continue
                idx = line.find("_data=")
                if idx == -1:
                    continue
                path_val = line[idx + 6:].strip().rstrip(",")
                if path_val:
                    favorites.add(path_val)
            return favorites

        except Exception as e:
            print(f"[StandardAdapter.read_favorites] failed: {e}")
            return set()
