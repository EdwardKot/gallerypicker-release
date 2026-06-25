import os
import random
import socket
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import app.config as config
from app.config import BASE_DIR, PHOTO_ROOT, HOST, PORT
from app.database import get_db, close_db
from app.scanner import scan_photos
from app.routes import router


def _get_local_ip() -> str:
    """Best-effort LAN IP detection."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "YOUR_PHONE_IP"


class PinAuthMiddleware(BaseHTTPMiddleware):
    """Allow requests that carry a valid X-Gallery-Pin header.
    The web UI stores the PIN in localStorage and sends it with every request.
    Static assets (/static/*) and the root page itself are exempt so the
    PIN dialog can always load.
    """

    EXEMPT_PREFIXES = ("/static/",)
    EXEMPT_EXACT = ("/",)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Always allow exempt paths
        if path in self.EXEMPT_EXACT:
            return await call_next(request)
        for prefix in self.EXEMPT_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # Check PIN — header (API calls) or cookie (img src / direct browser loads)
        pin = request.headers.get("X-Gallery-Pin", "") or request.cookies.get("gallery_pin", "")
        if pin == config.ACCESS_PIN:
            return await call_next(request)

        return JSONResponse({"error": "Unauthorized"}, status_code=401)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Generate or load PIN
    config.ACCESS_PIN = os.environ.get("ACCESS_PIN") or f"{random.randint(0, 9999):04d}"
    local_ip = _get_local_ip()

    # Startup
    print()
    print(f"{'='*60}")
    print(f"  Gallery Picker")
    print(f"{'='*60}")
    print(f"  Photo root : {os.path.expanduser(PHOTO_ROOT)}")
    print(f"  Access URL : http://{local_ip}:{PORT}")
    print(f"  访问密钥   : {config.ACCESS_PIN}")
    print(f"{'='*60}")
    print()
    print("  Stop        Ctrl+C")
    print("  Restart     ./run.sh")
    print("  Update      ./update.sh")
    print()
    
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


app = FastAPI(title="Gallery Picker", lifespan=lifespan)

# PIN auth middleware
app.add_middleware(PinAuthMiddleware)

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
