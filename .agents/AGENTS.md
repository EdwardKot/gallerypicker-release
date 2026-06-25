# Web UI Developer Rules: iOS, Caching & Performance Optimizations

These rules represent lessons learned from debugging iOS viewport rendering, SQLite concurrency, and aggressive Safari caching. Apply them during all web UI modifications:

## 1. Caching & Safari Cache-Busting
* **Rule**: When executing client-side HTTP `GET` requests inside API wrappers to fetch dynamic metadata (lists, configurations, counts), always append a unique timestamp cache-buster parameter `_=${Date.now()}`.
* **Rationale**: iOS Safari aggressively caches raw JSON payloads. If a previous request returned empty results or stale details, Safari may serve it from cache indefinitely.
* **Exemptions**: Do not apply query parameter cache-busting to static assets, original images, or generated thumbnails (e.g., `/api/thumbnail/*`) as caching those is critical for scroll performance.

## 2. Viewports and Parent CSS Transforms
* **Rule**: Never apply CSS `transform` or `transition` properties (such as `translateY` or `scale`) to `body` or major wrapper elements containing `position: fixed` descendants (e.g., full-screen modal viewers).
* **Rationale**: CSS transforms create a new containing block context. Any nested `position: fixed` element will become relative to the transformed parent height/width instead of the screen viewport, breaking absolute positioning and pushing modals off-screen on scrolled layouts.
* **Fix**: Apply touch drag transforms exclusively to nested scroll content containers (e.g., `#gallery` or `#photo-grid`), leaving the outer layout and top header static.

## 3. Database Write Concurrency (SQLite)
* **Rule**: Do not auto-trigger backend rescans or write operations asynchronously during initial page load API queries (e.g., inside photo list endpoints).
* **Rationale**: Heavy concurrent initialization requests (listing photos, reading filters, counting metadata) will collide with the background scan's write transactions, throwing SQLite `Database Locked` (500 errors) on startup.
* **Best Practice**: Scan disk folders only when explicitly requested by user actions (like a pull-to-refresh drag or clicking the Rescan button).

## 4. UI State Preservation in Repopulated Dropdowns
* **Rule**: When dynamically clearing and rebuilding the options of dropdown elements (`<select>`), always read the current selected state variable and re-apply it to the newly generated `<option>` elements.
* **Rationale**: Rebuilding dropdown elements resets their selected index to 0, which clears user selections during background refetches.
