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
    DB_SCHEMA_VERSION = 3

    # Check user_version
    cursor = await db.execute("PRAGMA user_version")
    row = await cursor.fetchone()
    current_version = row[0] if row else 0

    if current_version != DB_SCHEMA_VERSION:
        # Drop existing tables for destructive migration
        await db.execute("DROP TABLE IF EXISTS photo_vendor_tags")
        await db.execute("DROP TABLE IF EXISTS photos")
        await db.commit()

    # 1. Create the photos table with new schema
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
            system_favorite INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT,
            created_at TEXT,
            indexed_at TEXT NOT NULL,
            scanner_version INTEGER NOT NULL DEFAULT 1,
            focal_length_35mm INTEGER,
            vendor_tags TEXT DEFAULT '[]'
        );
    """)

    # 2. Create the photo_vendor_tags table
    await db.execute("""
        CREATE TABLE IF NOT EXISTS photo_vendor_tags (
            photo_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'exif',
            PRIMARY KEY (photo_id, tag, source),
            FOREIGN KEY (photo_id) REFERENCES photos(photo_id) ON DELETE CASCADE
        );
    """)

    # 3. Create indexes safely
    await db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_photos_mtime ON photos(mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_photos_mtime_id ON photos(mtime DESC, photo_id DESC);
        CREATE INDEX IF NOT EXISTS idx_photos_relative_path ON photos(relative_path);
        CREATE INDEX IF NOT EXISTS idx_photos_liked ON photos(liked);
        CREATE INDEX IF NOT EXISTS idx_photos_system_favorite ON photos(system_favorite);
        CREATE INDEX IF NOT EXISTS idx_photos_focal_length ON photos(focal_length_35mm);
        
        CREATE INDEX IF NOT EXISTS idx_photo_vendor_tags_tag ON photo_vendor_tags(tag);
        CREATE INDEX IF NOT EXISTS idx_photo_vendor_tags_photo_id ON photo_vendor_tags(photo_id);
    """)

    # Set user_version
    if current_version != DB_SCHEMA_VERSION:
        await db.execute(f"PRAGMA user_version = {DB_SCHEMA_VERSION}")
        
    await db.commit()
