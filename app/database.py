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
        await _db_connection.execute("PRAGMA foreign_keys=ON")
        await init_db(_db_connection)
    return _db_connection

async def close_db():
    global _db_connection
    if _db_connection:
        await _db_connection.close()
        _db_connection = None

async def init_db(db: aiosqlite.Connection):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS photos (
            photo_id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            absolute_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mtime REAL NOT NULL,
            width INTEGER,
            height INTEGER,
            created_at TEXT,
            indexed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_photos_mtime ON photos(mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_photos_relative_path ON photos(relative_path);

        CREATE TABLE IF NOT EXISTS photo_meta (
            photo_id TEXT PRIMARY KEY,
            liked INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(photo_id) REFERENCES photos(photo_id)
        );
        CREATE INDEX IF NOT EXISTS idx_photo_meta_liked ON photo_meta(liked);
    """)
    await db.commit()
