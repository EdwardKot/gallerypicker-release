import os
import time
from datetime import datetime, timezone
from pathlib import Path
from app.config import PHOTO_ROOT, SUPPORTED_EXTENSIONS
from app.utils import compute_photo_id
from app.database import get_db


async def scan_photos(photo_root: str = None) -> dict:
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
    
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    
    # Collect all current files
    found_ids = set()
    new_count = 0
    updated_count = 0
    scanned_count = 0
    
    for dirpath, dirnames, filenames in os.walk(root):
        for filename in filenames:
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
            
            # Check if already exists
            cursor = await db.execute(
                "SELECT photo_id FROM photos WHERE photo_id = ?",
                (photo_id,)
            )
            existing = await cursor.fetchone()
            
            if existing:
                # Update absolute path in case it changed
                await db.execute(
                    "UPDATE photos SET absolute_path = ? WHERE photo_id = ?",
                    (abs_path, photo_id)
                )
            else:
                # Check if same relative_path exists with different id (file changed)
                cursor = await db.execute(
                    "SELECT photo_id FROM photos WHERE relative_path = ?",
                    (rel_path,)
                )
                old_record = await cursor.fetchone()
                if old_record:
                    old_id = old_record[0]
                    # Remove old record
                    await db.execute("DELETE FROM photo_meta WHERE photo_id = ?", (old_id,))
                    await db.execute("DELETE FROM photos WHERE photo_id = ?", (old_id,))
                    updated_count += 1
                else:
                    new_count += 1
                
                await db.execute(
                    """INSERT INTO photos (photo_id, relative_path, absolute_path, file_size, mtime, indexed_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (photo_id, rel_path, abs_path, file_size, mtime, now)
                )
    
    # Remove records for files that no longer exist
    cursor = await db.execute("SELECT photo_id FROM photos")
    all_db_ids = {row[0] async for row in cursor}
    removed_ids = all_db_ids - found_ids
    removed_count = len(removed_ids)
    
    for rid in removed_ids:
        await db.execute("DELETE FROM photo_meta WHERE photo_id = ?", (rid,))
        await db.execute("DELETE FROM photos WHERE photo_id = ?", (rid,))
    
    await db.commit()
    
    return {
        "photo_root": root,
        "scanned": scanned_count,
        "new": new_count,
        "updated": updated_count,
        "removed": removed_count,
        "total_in_db": scanned_count
    }
