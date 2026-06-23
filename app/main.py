import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from app.config import BASE_DIR, PHOTO_ROOT, HOST, PORT
from app.database import get_db, close_db
from app.scanner import scan_photos
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"\n{'='*60}")
    print(f"  Termux Gallery Picker")
    print(f"  Photo root: {os.path.expanduser(PHOTO_ROOT)}")
    print(f"  Server: http://{HOST}:{PORT}")
    print(f"{'='*60}\n")
    
    # Initialize database
    await get_db()
    
    # Do initial scan
    print("Scanning photo library...")
    result = await scan_photos()
    print(f"Scan complete: {result.get('scanned', 0)} photos found, "
          f"{result.get('new', 0)} new, {result.get('removed', 0)} removed")
    if result.get('error'):
        print(f"WARNING: {result['error']}")
    print()
    
    yield
    
    # Shutdown
    await close_db()


app = FastAPI(title="Termux Gallery Picker", lifespan=lifespan)

# Static files
static_dir = os.path.join(BASE_DIR, "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Templates
templates_dir = os.path.join(BASE_DIR, "templates")
templates = Jinja2Templates(directory=templates_dir)

# Include API routes
app.include_router(router)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
