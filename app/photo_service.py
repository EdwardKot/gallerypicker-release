import os
from datetime import datetime, timezone
from typing import Optional

from app.config import MAX_PAGE_SIZE, ENABLE_SYSTEM_FAVORITES
from app.queries import PhotoFilters, build_filter_sort_sql


class PhotoNotFound(Exception):
    pass


class AdjacentPhotoNotFound(Exception):
    pass


def build_photo_filters(
    filter_str: str = "all",
    sort_str: str = "newest",
    focal_length: Optional[int] = None,
    vendor_tag: Optional[str] = None,
) -> PhotoFilters:
    return PhotoFilters(
        filter_str=filter_str,
        sort_str=sort_str,
        focal_length=focal_length,
        vendor_tag=vendor_tag,
    )


def _serialize_photo_row(row) -> dict:
    return {
        "photo_id": row[0],
        "relative_path": row[1],
        "file_size": row[2],
        "mtime": row[3],
        "liked": bool(row[4]),
        "filename": os.path.basename(row[1]),
    }


def _serialize_photo_detail(row) -> dict:
    return {
        "photo_id": row[0],
        "relative_path": row[1],
        "absolute_path": row[2],
        "file_size": row[3],
        "mtime": row[4],
        "width": row[5],
        "height": row[6],
        "liked": bool(row[7]),
        "filename": os.path.basename(row[1]),
    }


def _cap_page_size(filter_str: str, page_size: int) -> int:
    if filter_str == "liked":
        return min(page_size, 100000)
    return min(page_size, MAX_PAGE_SIZE)


async def list_photos(db, filters: PhotoFilters, page: int, page_size: int) -> dict:
    page_size = _cap_page_size(filters.filter_str, page_size)
    where, order, params = build_filter_sort_sql(filters)

    cursor = await db.execute(f"SELECT COUNT(*) FROM photos{where}", params)
    row = await cursor.fetchone()
    total = row[0]

    offset = (page - 1) * page_size
    query = (
        "SELECT photo_id, relative_path, file_size, mtime, liked FROM photos"
        + where
        + order
        + " LIMIT :limit OFFSET :offset"
    )
    full_params = dict(params)
    full_params.update({"limit": page_size, "offset": offset})
    cursor = await db.execute(query, full_params)
    rows = await cursor.fetchall()

    return {
        "photos": [_serialize_photo_row(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
    }


async def get_available_filters(db) -> dict:
    cursor = await db.execute(
        "SELECT DISTINCT focal_length_35mm FROM photos "
        "WHERE focal_length_35mm IS NOT NULL ORDER BY focal_length_35mm ASC"
    )
    focal_lengths = [row[0] for row in await cursor.fetchall()]

    cursor = await db.execute(
        "SELECT tag, COUNT(*) as cnt FROM photo_vendor_tags GROUP BY tag"
    )
    rows = await cursor.fetchall()

    from app.vendor_metadata.tag_registry import tag_registry

    vendor_brands_map = {}
    vendor_tags = []

    for row in rows:
        tag = row["tag"]
        count = row["cnt"]
        tag_def = tag_registry.get(tag)

        if tag.startswith("brand:"):
            brand_id = tag_def.brand
            if brand_id not in vendor_brands_map:
                vendor_brands_map[brand_id] = {
                    "brand": brand_id,
                    "label": tag_def.label,
                    "count": 0
                }
            vendor_brands_map[brand_id]["count"] += count
        else:
            vendor_tags.append({
                "tag": tag_def.tag,
                "label": tag_def.label,
                "group": tag_def.group,
                "brand": tag_def.brand,
                "count": count,
                "display_order": tag_def.display_order
            })

    vendor_brands = sorted(vendor_brands_map.values(), key=lambda x: x["brand"])
    vendor_tags = sorted(vendor_tags, key=lambda x: (x["display_order"], x["tag"]))

    return {
        "focal_lengths": focal_lengths,
        "vendor_brands": vendor_brands,
        "vendor_tags": vendor_tags,
    }


async def get_neighbor_context(db, photo_id: str, filters: PhotoFilters) -> dict:
    where_clause, order_clause, params = build_filter_sort_sql(filters)
    query = f"""
        WITH ordered AS (
            SELECT photo_id,
                   ROW_NUMBER() OVER ({order_clause}) as row_num
            FROM photos
            {where_clause}
        ),
        target AS (
            SELECT row_num, (SELECT COUNT(*) FROM ordered) as total
            FROM ordered
            WHERE photo_id = :target_photo_id
        )
        SELECT o.photo_id, o.row_num, t.row_num as target_row_num, t.total
        FROM ordered o
        CROSS JOIN target t
        WHERE o.row_num BETWEEN t.row_num - 3 AND t.row_num + 3
    """
    full_params = dict(params)
    full_params["target_photo_id"] = photo_id
    cursor = await db.execute(query, full_params)
    neighbor_rows = await cursor.fetchall()

    prev_ids = []
    next_ids = []
    target_row_num = None
    total = 0

    for row in neighbor_rows:
        p_id, row_num, target_num, row_total = row[0], row[1], row[2], row[3]
        target_row_num = target_num
        total = row_total

        if row_num < target_num:
            prev_ids.append(p_id)
        elif row_num > target_num:
            next_ids.append(p_id)

    return {
        "index": target_row_num,
        "total": total,
        "prev_photo_id": prev_ids[-1] if prev_ids else None,
        "next_photo_id": next_ids[0] if next_ids else None,
        "prev_ids": prev_ids,
        "next_ids": next_ids,
    }


async def get_photo_detail(db, photo_id: str, filters: Optional[PhotoFilters] = None) -> dict:
    cursor = await db.execute(
        """SELECT photo_id, relative_path, absolute_path, file_size, mtime,
                  width, height, liked
           FROM photos
           WHERE photo_id = ?""",
        (photo_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise PhotoNotFound()

    photo = _serialize_photo_detail(row)

    if filters is not None:
        try:
            photo.update(await get_neighbor_context(db, photo_id, filters))
        except Exception as exc:
            print(f"[get_photo] neighbor query failed for {photo_id}: {exc}")
            photo.update({
                "index": -1,
                "total": 0,
                "prev_photo_id": None,
                "next_photo_id": None,
                "prev_ids": [],
                "next_ids": [],
            })

    return photo


async def get_photo_file(db, photo_id: str) -> dict:
    cursor = await db.execute(
        "SELECT absolute_path, relative_path, file_size, mtime FROM photos WHERE photo_id = ?",
        (photo_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise PhotoNotFound()

    return {
        "absolute_path": row[0],
        "relative_path": row[1],
        "file_size": row[2],
        "mtime": row[3],
        "filename": os.path.basename(row[1]),
    }


async def set_photo_liked(db, photo_id: str, liked: bool) -> dict:
    cursor = await db.execute("SELECT photo_id FROM photos WHERE photo_id = ?", (photo_id,))
    if not await cursor.fetchone():
        raise PhotoNotFound()

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE photos SET liked = ?, updated_at = ? WHERE photo_id = ?",
        (1 if liked else 0, now, photo_id),
    )
    await db.commit()
    return {"photo_id": photo_id, "liked": liked}


async def get_photo_counts(db) -> dict:
    cursor = await db.execute("""
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN liked = 1 THEN 1 ELSE 0 END), 0) AS liked,
            COALESCE(SUM(CASE WHEN system_favorite = 1 THEN 1 ELSE 0 END), 0) AS system_favorite
        FROM photos
    """)
    total, liked, system_favorite = await cursor.fetchone()
    return {
        "total": total,
        "liked": liked,
        "unliked": total - liked,
        "system_favorite": system_favorite,
        "has_system_favorites": ENABLE_SYSTEM_FAVORITES,
    }


async def get_adjacent_photo_id(
    db,
    photo_id: str,
    filters: PhotoFilters,
    direction: str,
) -> str:
    offset = 1 if direction == "next" else -1
    where_clause, order_clause, params = build_filter_sort_sql(filters)
    query = f"""
        WITH ordered AS (
            SELECT photo_id,
                   ROW_NUMBER() OVER ({order_clause}) as row_num
            FROM photos
            {where_clause}
        ),
        target AS (
            SELECT row_num FROM ordered WHERE photo_id = :target_photo_id
        )
        SELECT o.photo_id
        FROM ordered o
        CROSS JOIN target t
        WHERE o.row_num = t.row_num + :offset
    """
    full_params = dict(params)
    full_params["target_photo_id"] = photo_id
    full_params["offset"] = offset
    cursor = await db.execute(query, full_params)
    row = await cursor.fetchone()
    if not row:
        raise AdjacentPhotoNotFound()
    return row[0]
