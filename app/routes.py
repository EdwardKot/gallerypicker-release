import os
import io
import zipfile
import mimetypes
from datetime import datetime, timezone
from fastapi import APIRouter, Query, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from app.database import get_db
from app.scanner import scan_photos
from app.thumbnails import generate_thumbnail, get_cache_stats, clear_cache
from app.config import PHOTO_ROOT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter()


def _build_filter_sort_sql(filter_str: str, sort_str: str):
    conditions = []
    if filter_str == "liked":
        conditions.append("COALESCE(m.liked, 0) = 1")
    elif filter_str == "unliked":
        conditions.append("COALESCE(m.liked, 0) = 0")
    
    where_clause = ""
    if conditions:
        where_clause = " WHERE " + " AND ".join(conditions)
        
    sort_map = {
        "newest": "p.mtime DESC, p.photo_id DESC",
        "oldest": "p.mtime ASC, p.photo_id ASC",
        "name_asc": "p.relative_path ASC, p.photo_id ASC",
        "name_desc": "p.relative_path DESC, p.photo_id DESC"
    }
    order_clause = f" ORDER BY {sort_map.get(sort_str, 'p.mtime DESC, p.photo_id DESC')}"
    return where_clause, order_clause


@router.get("/api/photos")
async def list_photos(
    filter: str = Query("all", regex="^(all|liked|unliked)$"),
    sort: str = Query("newest", regex="^(newest|oldest|name_asc|name_desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE)
):
    db = await get_db()
    
    # Build query
    base = """SELECT p.photo_id, p.relative_path, p.file_size, p.mtime,
                     COALESCE(m.liked, 0) as liked
              FROM photos p
              LEFT JOIN photo_meta m ON p.photo_id = m.photo_id"""
    
    where, order = _build_filter_sort_sql(filter, sort)
    params = []
    
    # Count
    count_query = f"SELECT COUNT(*) FROM photos p LEFT JOIN photo_meta m ON p.photo_id = m.photo_id{where}"
    cursor = await db.execute(count_query, params)
    row = await cursor.fetchone()
    total = row[0]
    
    # Paginate
    offset = (page - 1) * page_size
    query = base + where + order + f" LIMIT ? OFFSET ?"
    cursor = await db.execute(query, params + [page_size, offset])
    rows = await cursor.fetchall()
    
    photos = []
    for row in rows:
        photos.append({
            "photo_id": row[0],
            "relative_path": row[1],
            "file_size": row[2],
            "mtime": row[3],
            "liked": bool(row[4]),
            "filename": os.path.basename(row[1])
        })
    
    return {
        "photos": photos,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
    }


@router.get("/api/photo/{photo_id}")
async def get_photo(
    photo_id: str,
    filter: str = Query(None, regex="^(all|liked|unliked)$"),
    sort: str = Query(None, regex="^(newest|oldest|name_asc|name_desc)$")
):
    db = await get_db()
    cursor = await db.execute(
        """SELECT p.photo_id, p.relative_path, p.absolute_path, p.file_size, p.mtime,
                  p.width, p.height, COALESCE(m.liked, 0) as liked
           FROM photos p
           LEFT JOIN photo_meta m ON p.photo_id = m.photo_id
           WHERE p.photo_id = ?""",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    res = {
        "photo_id": row[0],
        "relative_path": row[1],
        "absolute_path": row[2],
        "file_size": row[3],
        "mtime": row[4],
        "width": row[5],
        "height": row[6],
        "liked": bool(row[7]),
        "filename": os.path.basename(row[1])
    }
    
    if filter and sort:
        where_clause, order_clause = _build_filter_sort_sql(filter, sort)
        query = f"""
            WITH ordered AS (
                SELECT p.photo_id,
                       ROW_NUMBER() OVER ({order_clause}) as row_num
                FROM photos p
                LEFT JOIN photo_meta m ON p.photo_id = m.photo_id
                {where_clause}
            ),
            target AS (
                SELECT row_num, (SELECT COUNT(*) FROM ordered) as total
                FROM ordered
                WHERE photo_id = ?
            )
            SELECT o.photo_id, o.row_num, t.row_num as target_row_num, t.total
            FROM ordered o
            CROSS JOIN target t
            WHERE o.row_num BETWEEN t.row_num - 3 AND t.row_num + 3
        """
        try:
            cursor = await db.execute(query, (photo_id,))
            neighbor_rows = await cursor.fetchall()
            
            prev_ids = []
            next_ids = []
            target_row_num = None
            total = 0
            
            for r in neighbor_rows:
                p_id, r_num, t_r_num, tot = r[0], r[1], r[2], r[3]
                target_row_num = t_r_num
                total = tot
                
                if r_num < t_r_num:
                    prev_ids.append(p_id)
                elif r_num > t_r_num:
                    next_ids.append(p_id)
                    
            res.update({
                "index": target_row_num,
                "total": total,
                "prev_photo_id": prev_ids[-1] if prev_ids else None,
                "next_photo_id": next_ids[0] if next_ids else None,
                "prev_ids": prev_ids,
                "next_ids": next_ids
            })
        except Exception:
            res.update({
                "index": -1,
                "total": 0,
                "prev_photo_id": None,
                "next_photo_id": None,
                "prev_ids": [],
                "next_ids": []
            })
            
    return res


@router.get("/api/thumbnail/{photo_id}")
async def get_thumbnail(photo_id: str, size: int = Query(None)):
    db = await get_db()
    cursor = await db.execute(
        "SELECT absolute_path, file_size, mtime FROM photos WHERE photo_id = ?",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path, file_size, mtime = row[0], row[1], row[2]
    
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")
    
    try:
        thumb_path = generate_thumbnail(abs_path, photo_id, file_size, mtime, size)
        return FileResponse(
            thumb_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/original/{photo_id}")
async def get_original(photo_id: str):
    db = await get_db()
    cursor = await db.execute(
        "SELECT absolute_path, relative_path FROM photos WHERE photo_id = ?",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path = row[0]
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")
    
    media_type, _ = mimetypes.guess_type(abs_path)
    if not media_type:
        media_type = "application/octet-stream"
    
    return FileResponse(
        abs_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"}
    )


@router.post("/api/like/{photo_id}")
async def like_photo(photo_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT photo_id FROM photos WHERE photo_id = ?", (photo_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Photo not found")
    
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO photo_meta (photo_id, liked, updated_at) VALUES (?, 1, ?)
           ON CONFLICT(photo_id) DO UPDATE SET liked = 1, updated_at = ?""",
        (photo_id, now, now)
    )
    await db.commit()
    return {"photo_id": photo_id, "liked": True}


@router.post("/api/unlike/{photo_id}")
async def unlike_photo(photo_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT photo_id FROM photos WHERE photo_id = ?", (photo_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Photo not found")
    
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO photo_meta (photo_id, liked, updated_at) VALUES (?, 0, ?)
           ON CONFLICT(photo_id) DO UPDATE SET liked = 0, updated_at = ?""",
        (photo_id, now, now)
    )
    await db.commit()
    return {"photo_id": photo_id, "liked": False}


@router.get("/api/counts")
async def get_counts():
    db = await get_db()
    
    cursor = await db.execute("SELECT COUNT(*) FROM photos")
    total = (await cursor.fetchone())[0]
    
    cursor = await db.execute(
        "SELECT COUNT(*) FROM photos p INNER JOIN photo_meta m ON p.photo_id = m.photo_id WHERE m.liked = 1"
    )
    liked = (await cursor.fetchone())[0]
    
    return {
        "total": total,
        "liked": liked,
        "unliked": total - liked
    }


@router.post("/api/rescan")
async def rescan():
    result = await scan_photos()
    return result


@router.get("/api/cache/stats")
async def cache_stats():
    return get_cache_stats()


@router.post("/api/cache/clear")
async def cache_clear():
    return clear_cache()


@router.get("/api/download/{photo_id}")
async def download_photo(photo_id: str):
    db = await get_db()
    cursor = await db.execute(
        "SELECT absolute_path, relative_path FROM photos WHERE photo_id = ?",
        (photo_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    abs_path = row[0]
    filename = os.path.basename(row[1])
    
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Original file not found")
    
    media_type, _ = mimetypes.guess_type(abs_path)
    if not media_type:
        media_type = "application/octet-stream"
    
    return FileResponse(
        abs_path,
        media_type=media_type,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/api/download-liked")
async def download_liked():
    db = await get_db()
    cursor = await db.execute(
        """SELECT p.absolute_path, p.relative_path
           FROM photos p
           INNER JOIN photo_meta m ON p.photo_id = m.photo_id
           WHERE m.liked = 1
           ORDER BY p.mtime DESC"""
    )
    rows = await cursor.fetchall()
    
    if not rows:
        raise HTTPException(status_code=404, detail="No liked photos")
    
    def generate_zip():
        buffer = io.BytesIO()
        seen_names = {}
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as zf:
            for row in rows:
                abs_path = row[0]
                filename = os.path.basename(row[1])
                
                if not os.path.exists(abs_path):
                    continue
                
                # Handle duplicate filenames
                if filename in seen_names:
                    seen_names[filename] += 1
                    name, ext = os.path.splitext(filename)
                    filename = f"{name}_{seen_names[filename]}{ext}"
                else:
                    seen_names[filename] = 0
                
                zf.write(abs_path, filename)
        
        buffer.seek(0)
        return buffer
    
    zip_buffer = generate_zip()
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="liked_photos.zip"'}
    )


@router.get("/api/photo/{photo_id}/next")
async def get_next_photo_id(
    photo_id: str,
    filter: str = Query("all", regex="^(all|liked|unliked)$"),
    sort: str = Query("newest", regex="^(newest|oldest|name_asc|name_desc)$")
):
    db = await get_db()
    where_clause, order_clause = _build_filter_sort_sql(filter, sort)
    query = f"""
        WITH ordered AS (
            SELECT p.photo_id,
                   ROW_NUMBER() OVER ({order_clause}) as row_num
            FROM photos p
            LEFT JOIN photo_meta m ON p.photo_id = m.photo_id
            {where_clause}
        ),
        target AS (
            SELECT row_num FROM ordered WHERE photo_id = ?
        )
        SELECT o.photo_id
        FROM ordered o
        CROSS JOIN target t
        WHERE o.row_num = t.row_num + 1
    """
    cursor = await db.execute(query, (photo_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Next photo not found")
    return {"photo_id": row[0]}


@router.get("/api/photo/{photo_id}/prev")
async def get_prev_photo_id(
    photo_id: str,
    filter: str = Query("all", regex="^(all|liked|unliked)$"),
    sort: str = Query("newest", regex="^(newest|oldest|name_asc|name_desc)$")
):
    db = await get_db()
    where_clause, order_clause = _build_filter_sort_sql(filter, sort)
    query = f"""
        WITH ordered AS (
            SELECT p.photo_id,
                   ROW_NUMBER() OVER ({order_clause}) as row_num
            FROM photos p
            LEFT JOIN photo_meta m ON p.photo_id = m.photo_id
            {where_clause}
        ),
        target AS (
            SELECT row_num FROM ordered WHERE photo_id = ?
        )
        SELECT o.photo_id
        FROM ordered o
        CROSS JOIN target t
        WHERE o.row_num = t.row_num - 1
    """
    cursor = await db.execute(query, (photo_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Previous photo not found")
    return {"photo_id": row[0]}
