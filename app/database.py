import aiosqlite
import os
from pathlib import Path
from app.config import DATABASE_PATH

_db_connection = None

async def get_db() -> aiosqlite.Connection:
    global _db_connection
    if _db_connection is None:
        os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
        _db_connection = await aiosqlite.connect(DATABASE_PATH)
        _db_connection.row_factory = aiosqlite.Row
        await _db_connection.execute("PRAGMA journal_mode=WAL")
        await _db_connection.execute("PRAGMA synchronous=NORMAL")
        await _db_connection.execute("PRAGMA foreign_keys=ON")
        await init_db(_db_connection)
    return _db_connection

async def close_db():
    global _db_connection
    if _db_connection:
        await _db_connection.close()
        _db_connection = None

async def init_db(db: aiosqlite.Connection):
    # Check if we need to migrate from photo_meta table first
    cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_meta'")
    has_photo_meta = await cursor.fetchone() is not None

    # 1. Create the photos table with new columns if starting from scratch.
    # If the table already exists, this statement does nothing.
    await db.execute("""
        CREATE TABLE IF NOT EXISTS photos (
            photo_id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            absolute_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mtime REAL NOT NULL,
            width INTEGER,
            height INTEGER,
            liked INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT,
            created_at TEXT,
            indexed_at TEXT NOT NULL
        );
    """)

    # 2. Check if the columns exist in the existing photos table (required for upgrading old databases)
    cursor = await db.execute("PRAGMA table_info(photos)")
    columns = [row["name"] for row in await cursor.fetchall()]
    
    if "liked" not in columns:
        await db.execute("ALTER TABLE photos ADD COLUMN liked INTEGER NOT NULL DEFAULT 0")
    if "updated_at" not in columns:
        await db.execute("ALTER TABLE photos ADD COLUMN updated_at TEXT")

    # 3. Perform data migration if upgrading from the old two-table schema
    if has_photo_meta:
        # Copy liked state from photo_meta to photos
        await db.execute("""
            UPDATE photos 
            SET liked = (SELECT liked FROM photo_meta WHERE photo_meta.photo_id = photos.photo_id),
                updated_at = (SELECT updated_at FROM photo_meta WHERE photo_meta.photo_id = photos.photo_id)
            WHERE EXISTS (SELECT 1 FROM photo_meta WHERE photo_meta.photo_id = photos.photo_id)
        """)
        # Drop the now redundant table
        await db.execute("DROP TABLE photo_meta")
        
    # 4. Now that columns are guaranteed to exist, create indexes safely
    await db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_photos_mtime ON photos(mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_photos_mtime_id ON photos(mtime DESC, photo_id DESC);
        CREATE INDEX IF NOT EXISTS idx_photos_relative_path ON photos(relative_path);
        CREATE INDEX IF NOT EXISTS idx_photos_liked ON photos(liked);
    """)
        
    await db.commit()
