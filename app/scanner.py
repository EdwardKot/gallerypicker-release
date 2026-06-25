import os
import time
import asyncio
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

            # Standard tag: 35mm equivalent focal length
            fl = exif.get(_TAG_FOCAL_LENGTH_35MM)
            if fl is not None:
                try:
                    result["focal_length_35mm"] = int(fl)
                except (TypeError, ValueError):
                    pass

            # Xiaomi private tags — only attempt for Xiaomi bodies
            make = (exif.get(_TAG_MAKE) or "").strip()
            if make.lower() == "xiaomi":
                try:
                    maker_ifd = exif.get_ifd(_TAG_MAKER_NOTE)
                    if maker_ifd:
                        portrait = maker_ifd.get(_TAG_XIAOMI_PORTRAIT)
                        scene    = maker_ifd.get(_TAG_XIAOMI_SCENE)
                        if portrait is not None:
                            result["xiaomi_portrait"] = int(portrait)
                        if scene is not None:
                            result["xiaomi_scene"] = int(scene)
                except Exception:
                    pass  # MakerNote parse failure is non-fatal

    except Exception:
        pass  # Unreadable EXIF is non-fatal
    return result


async def scan_photos(photo_root: str = None, db=None) -> dict:
    """Scan the photo root directory and update the SQLite index.
    Returns stats about the scan."""
    root = photo_root or PHOTO_ROOT
    root = os.path.expanduser(root)

    if not os.path.isdir(root):
        return {
            "error": f"Photo root not found: {root}",
            "scanned": 0,
            "new": 0,
            "updated": 0,
            "removed": 0
        }

    if db is None:
        db = await get_db()
    
    # One-time EXIF backfill for existing photos in the database
    try:
        cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='system_meta'")
        has_meta_table = await cursor.fetchone() is not None
        if not has_meta_table:
            await db.execute("CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT)")
            await db.commit()
        
        cursor = await db.execute("SELECT value FROM system_meta WHERE key = 'exif_backfill_done'")
        row = await cursor.fetchone()
        backfill_done = row and row[0] == '1'
        
        if not backfill_done:
            print("One-time EXIF backfill: scanning existing photos in database...")
            cursor = await db.execute("SELECT photo_id, absolute_path FROM photos")
            photos_to_backfill = await cursor.fetchall()
            
            def do_backfill():
                to_update = []
                for p in photos_to_backfill:
                    pid = p["photo_id"]
                    abs_path = p["absolute_path"]
                    if os.path.exists(abs_path):
                        exif = _extract_exif(abs_path)
                        to_update.append((
                            exif["focal_length_35mm"],
                            exif["xiaomi_portrait"],
                            exif["xiaomi_scene"],
                            pid
                        ))
                return to_update

            to_update = await asyncio.to_thread(do_backfill)
            
            if to_update:
                await db.executemany(
                    "UPDATE photos SET focal_length_35mm = ?, xiaomi_portrait = ?, xiaomi_scene = ? WHERE photo_id = ?",
                    to_update
                )
                await db.commit()
            
            await db.execute("INSERT OR REPLACE INTO system_meta (key, value) VALUES ('exif_backfill_done', '1')")
            await db.commit()
            print(f"One-time EXIF backfill completed for {len(to_update)} photos.")
    except Exception as e:
        print(f"WARNING: One-time EXIF backfill failed: {e}")

    now = datetime.now(timezone.utc).isoformat()
    
    # Fetch all existing records in a single query for O(1) database trip efficiency
    cursor = await db.execute("SELECT photo_id, relative_path, absolute_path, liked, updated_at FROM photos")
    rows = await cursor.fetchall()
    
    # In-memory lookups
    existing_paths = {row["photo_id"]: row["absolute_path"] for row in rows}
    existing_likes = {row["photo_id"]: row["liked"] for row in rows}
    existing_updated_at = {row["photo_id"]: row["updated_at"] for row in rows}
    relative_to_id = {row["relative_path"]: row["photo_id"] for row in rows}
    
    found_ids = set()
    new_count = 0
    updated_count = 0
    scanned_count = 0
    
    to_insert = []        # List of tuples: (photo_id, rel_path, abs_path, file_size, mtime, liked, updated_at, indexed_at)
    to_update_path = []   # List of tuples: (abs_path, photo_id)
    to_delete = []        # List of tuples: (photo_id,)
    
    for dirpath, dirnames, filenames in os.walk(root):
        # Exclude hidden folders (like .trashed, .thumbnails, etc.)
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        
        for filename in filenames:
            # Skip hidden files and Android trashed files (which start with a dot, e.g., .trashed-xxx)
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
                mtime = stat.st_mtime
            except OSError:
                continue
            
            photo_id = compute_photo_id(rel_path, file_size, mtime)
            found_ids.add(photo_id)
            scanned_count += 1
            
            if photo_id in existing_paths:
                # Photo is unchanged. Check if physical path needs update (e.g., symlinks or case changes)
                if existing_paths[photo_id] != abs_path:
                    to_update_path.append((abs_path, photo_id))
            else:
                # Photo is either brand new or modified on disk
                if rel_path in relative_to_id:
                    # Same relative path, but size/mtime changed.
                    # Delete the old record and insert the new one, carrying over the liked state
                    old_id = relative_to_id[rel_path]
                    liked_val = existing_likes.get(old_id, 0)
                    updated_at_val = existing_updated_at.get(old_id, None)
                    to_delete.append((old_id,))
                    updated_count += 1
                else:
                    # Completely new photo
                    new_count += 1
                    liked_val = 0
                    updated_at_val = None

                exif = _extract_exif(abs_path)
                to_insert.append((
                    photo_id, rel_path, abs_path, file_size, mtime,
                    liked_val, updated_at_val, now,
                    exif["focal_length_35mm"], exif["xiaomi_portrait"], exif["xiaomi_scene"],
                ))
                
    # Detect files that were removed from the disk
    removed_ids = set(existing_paths.keys()) - found_ids
    removed_count = len(removed_ids)
    for rid in removed_ids:
        to_delete.append((rid,))
        
    # Apply changes in batch transactions
    if to_delete:
        await db.executemany("DELETE FROM photos WHERE photo_id = ?", to_delete)
    if to_update_path:
        await db.executemany("UPDATE photos SET absolute_path = ? WHERE photo_id = ?", to_update_path)
    if to_insert:
        await db.executemany(
            """INSERT INTO photos
               (photo_id, relative_path, absolute_path, file_size, mtime,
                liked, updated_at, indexed_at,
                focal_length_35mm, xiaomi_portrait, xiaomi_scene)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            to_insert
        )
        
    await db.commit()
    
    return {
        "photo_root": root,
        "scanned": scanned_count,
        "new": new_count,
        "updated": updated_count,
        "removed": removed_count,
        "total_in_db": scanned_count
    }
