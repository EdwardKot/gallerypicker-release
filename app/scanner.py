import asyncio
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from app.config import PHOTO_ROOT, SUPPORTED_EXTENSIONS
from app.utils import compute_photo_id
from app.database import get_db


# EXIF tag constants
_TAG_FOCAL_LENGTH_35MM = 0xA405
_TAG_MAKE              = 0x010F
_TAG_MAKER_NOTE        = 0x927C
_TAG_XIAOMI_PORTRAIT   = 0x889F
_TAG_XIAOMI_SCENE      = 0x8889

# Scanner rules version (increment when EXIF extraction rules change to force re-scanning of metadata)
CURRENT_SCANNER_VERSION = 2


def _extract_exif(abs_path: str) -> dict:
    """Extract EXIF fields we care about. Returns a dict with keys:
      focal_length_35mm, xiaomi_portrait, xiaomi_scene  (all may be None)
    Only attempts Xiaomi private tags when Make == 'Xiaomi'.
    Fast: reads only the EXIF header, never decodes image pixels."""
    result = {"focal_length_35mm": None, "xiaomi_portrait": None, "xiaomi_scene": None}
    try:
        from PIL import Image
        with Image.open(abs_path) as img:
            exif = img.getexif()
            if not exif:
                return result

            # 0x8769 is ExifOffset (EXIF SubIFD)
            exif_sub = exif.get_ifd(0x8769)

            # Standard tag: 35mm equivalent focal length
            fl = exif_sub.get(_TAG_FOCAL_LENGTH_35MM) if exif_sub else None
            if fl is None:
                # Fallback to root IFD0 just in case
                fl = exif.get(_TAG_FOCAL_LENGTH_35MM)

            if fl is not None:
                try:
                    result["focal_length_35mm"] = int(fl)
                except (TypeError, ValueError):
                    pass

            # Xiaomi private tags — only attempt for Xiaomi-family bodies
            make = (exif.get(_TAG_MAKE) or "").strip().lower()
            if exif_sub and ("xiaomi" in make or "redmi" in make or "poco" in make):
                try:
                    portrait = exif_sub.get(_TAG_XIAOMI_PORTRAIT)
                    scene    = exif_sub.get(_TAG_XIAOMI_SCENE)

                    if portrait is not None:
                        if isinstance(portrait, bytes) and len(portrait) > 0:
                            result["xiaomi_portrait"] = int(portrait[0])
                        elif isinstance(portrait, (int, float)):
                            result["xiaomi_portrait"] = int(portrait)

                    if scene is not None:
                        if isinstance(scene, bytes) and len(scene) > 0:
                            result["xiaomi_scene"] = int(scene[0])
                        elif isinstance(scene, (int, float)):
                            result["xiaomi_scene"] = int(scene)
                except Exception:
                    pass  # Non-fatal

    except Exception:
        pass  # Unreadable EXIF is non-fatal
    return result


def _on_walk_error(err: OSError) -> None:
    raise err


def _scan_filesystem_sync(root: str, existing_snapshot: dict) -> dict:
    """Pure synchronous filesystem walk.  No DB access; safe to run in a
    worker thread via asyncio.to_thread.

    existing_snapshot keys (all pre-fetched from DB by the caller):
        existing_paths    : {photo_id: abs_path}
        existing_likes    : {photo_id: liked}
        existing_updated_at: {photo_id: updated_at}
        existing_versions : {photo_id: scanner_version}
        relative_to_id    : {relative_path: photo_id}

    Returns a dict with:
        found_ids   : set of photo_id strings found on disk
        to_insert   : list of insert tuples
        to_update_path : list of (abs_path, photo_id)
        to_update_exif : list of (fl, portrait, scene, version, photo_id)
        scanned     : int
        new         : int
        updated     : int
    """
    existing_paths     = existing_snapshot["existing_paths"]
    existing_likes     = existing_snapshot["existing_likes"]
    existing_updated_at = existing_snapshot["existing_updated_at"]
    existing_versions  = existing_snapshot["existing_versions"]
    relative_to_id     = existing_snapshot["relative_to_id"]

    now = datetime.now(timezone.utc).isoformat()

    found_ids      = set()
    to_insert      = []
    to_update_path = []
    to_update_exif = []
    scanned_count  = 0
    new_count      = 0
    updated_count  = 0

    for dirpath, dirnames, filenames in os.walk(root, onerror=_on_walk_error):
        # Exclude hidden folders (e.g. .trashed, .thumbnails)
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]

        for filename in filenames:
            if filename.startswith('.'):
                continue

            ext = os.path.splitext(filename)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue

            abs_path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(abs_path, root)

            try:
                stat = os.stat(abs_path)
                file_size = stat.st_size
                mtime     = stat.st_mtime
            except OSError:
                continue

            photo_id = compute_photo_id(rel_path, file_size, mtime)
            found_ids.add(photo_id)
            scanned_count += 1

            if photo_id in existing_paths:
                # Known photo — check if physical path drifted
                if existing_paths[photo_id] != abs_path:
                    to_update_path.append((abs_path, photo_id))

                # Re-extract EXIF if scanner rules were updated
                if existing_versions.get(photo_id, 1) < CURRENT_SCANNER_VERSION:
                    exif = _extract_exif(abs_path)
                    to_update_exif.append((
                        exif["focal_length_35mm"],
                        exif["xiaomi_portrait"],
                        exif["xiaomi_scene"],
                        CURRENT_SCANNER_VERSION,
                        photo_id,
                    ))
            else:
                # New or replaced photo
                if rel_path in relative_to_id:
                    # Same path, different content — carry over liked state
                    old_id = relative_to_id[rel_path]
                    liked_val      = existing_likes.get(old_id, 0)
                    updated_at_val = existing_updated_at.get(old_id, None)
                    updated_count += 1
                else:
                    liked_val      = 0
                    updated_at_val = None
                    new_count     += 1

                exif = _extract_exif(abs_path)
                to_insert.append((
                    photo_id, rel_path, abs_path, file_size, mtime,
                    liked_val, updated_at_val, now,
                    exif["focal_length_35mm"], exif["xiaomi_portrait"], exif["xiaomi_scene"],
                    CURRENT_SCANNER_VERSION,
                ))

    return {
        "found_ids":      found_ids,
        "to_insert":      to_insert,
        "to_update_path": to_update_path,
        "to_update_exif": to_update_exif,
        "scanned":        scanned_count,
        "new":            new_count,
        "updated":        updated_count,
    }


async def scan_photos(photo_root: str = None, db=None) -> dict:
    """Scan the photo root directory and update the SQLite index.

    Filesystem work (os.walk, os.stat, EXIF parsing) runs in a worker thread
    so the asyncio event loop stays free to serve thumbnails and API requests
    during the scan.  Database reads and writes remain on the event loop using
    the shared async connection.

    Returns stats about the scan (same structure as before).
    """
    root = photo_root or PHOTO_ROOT
    root = os.path.expanduser(root)

    if not os.path.isdir(root):
        return {
            "error": f"Photo root not found: {root}",
            "scanned": 0,
            "new": 0,
            "updated": 0,
            "removed": 0,
        }

    if db is None:
        db = await get_db()

    # ------------------------------------------------------------------
    # 1. Read existing DB state on the event loop (async, fast)
    # ------------------------------------------------------------------
    cursor = await db.execute(
        "SELECT photo_id, relative_path, absolute_path, liked, updated_at, scanner_version FROM photos"
    )
    rows = await cursor.fetchall()

    existing_snapshot = {
        "existing_paths":      {row["photo_id"]: row["absolute_path"] for row in rows},
        "existing_likes":      {row["photo_id"]: row["liked"]         for row in rows},
        "existing_updated_at": {row["photo_id"]: row["updated_at"]    for row in rows},
        "existing_versions":   {row["photo_id"]: (row["scanner_version"] or 1) for row in rows},
        "relative_to_id":      {row["relative_path"]: row["photo_id"] for row in rows},
    }

    # ------------------------------------------------------------------
    # 2. Walk the filesystem in a worker thread (blocking I/O + CPU)
    # ------------------------------------------------------------------
    try:
        fs_result = await asyncio.to_thread(_scan_filesystem_sync, root, existing_snapshot)
    except Exception as e:
        return {
            "error": f"Scan failed due to filesystem error: {e}",
            "scanned": 0,
            "new": 0,
            "updated": 0,
            "removed": 0,
        }

    # ------------------------------------------------------------------
    # 3. Apply DB changes on the event loop (async, fast)
    # ------------------------------------------------------------------
    found_ids      = fs_result["found_ids"]
    to_insert      = fs_result["to_insert"]
    to_update_path = fs_result["to_update_path"]
    to_update_exif = fs_result["to_update_exif"]

    # Safety gate: check if scan found 0 photos but DB has existing records
    existing_count = len(existing_snapshot["existing_paths"])
    if existing_count > 0 and len(found_ids) == 0:
        return {
            "error": "Safety gate: scan found 0 photos but DB has existing records — aborting to prevent data wipe",
            "scanned": 0,
            "new": 0,
            "updated": 0,
            "removed": 0,
        }

    # Records replaced by updated content (same path, new photo_id) must be
    # deleted before the new row is inserted to avoid a PRIMARY KEY conflict.
    replaced_old_ids = set()
    for record in to_insert:
        rel_path = record[1]
        if rel_path in existing_snapshot["relative_to_id"]:
            old_id = existing_snapshot["relative_to_id"][rel_path]
            replaced_old_ids.add(old_id)

    truly_removed_ids = set(existing_snapshot["existing_paths"].keys()) - found_ids - replaced_old_ids
    removed_count = len(truly_removed_ids)
    removed_ids = truly_removed_ids | replaced_old_ids

    to_delete = [(rid,) for rid in removed_ids]

    if to_delete:
        await db.executemany("DELETE FROM photos WHERE photo_id = ?", to_delete)
    if to_update_path:
        await db.executemany(
            "UPDATE photos SET absolute_path = ? WHERE photo_id = ?",
            to_update_path,
        )
    if to_update_exif:
        await db.executemany(
            """UPDATE photos
               SET focal_length_35mm = ?, xiaomi_portrait = ?, xiaomi_scene = ?,
                   scanner_version = ?
               WHERE photo_id = ?""",
            to_update_exif,
        )
    if to_insert:
        await db.executemany(
            """INSERT INTO photos
               (photo_id, relative_path, absolute_path, file_size, mtime,
                liked, updated_at, indexed_at,
                focal_length_35mm, xiaomi_portrait, xiaomi_scene, scanner_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            to_insert,
        )

    await db.commit()

    res = {
        "photo_root":  root,
        "scanned":     fs_result["scanned"],
        "new":         fs_result["new"],
        "updated":     fs_result["updated"],
        "removed":     removed_count,
        "total_in_db": fs_result["scanned"],
    }
    from app.events import announcer
    announcer.announce("library_updated")
    return res
