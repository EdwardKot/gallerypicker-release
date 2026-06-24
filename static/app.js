(function () {
    'use strict';

    // ── State ────────────────────────────────────────────────
    const state = {
        photos: [],
        currentFilter: 'all',
        currentSort: 'newest',
        currentPage: 1,
        pageSize: 100,
        totalPhotos: 0,
        totalPages: 0,
        counts: { total: 0, liked: 0, unliked: 0 },
        viewerActive: false,
        viewerPhotoId: null,
        viewerIndex: -1,
        viewerNextIds: [],
        viewerPrevIds: [],
        previewSize: parseInt(localStorage.getItem('viewerPreviewSize') || '1024', 10),
        scrollPosition: 0,
        thumbSize: 200,
        likedSet: new Set(),
        selectedSet: new Set(),
        lastClickedId: null,
        selectionAnchorId: null,
        lastRenderedDate: null,
        viewerIsOriginal: false,
        focusedPhotoId: null,
        isLoadingMore: false,
        hasMorePages: true,
        likedIdsCache: null,    // 预缓存的 liked 照片 ID 列表
    };

    // ── DOM refs ─────────────────────────────────────────────
    const $grid = document.getElementById('photo-grid');
    const $loading = document.getElementById('loading');
    const $empty = document.getElementById('empty-state');
    const $viewer = document.getElementById('viewer');
    const $viewerImg = document.getElementById('viewer-img');
    const $viewerPosition = document.getElementById('viewer-position');
    const $viewerLiked = document.getElementById('viewer-liked');
    const $viewerFilenameBottom = document.getElementById('viewer-filename-bottom');
    const $viewerBtnPrev = document.getElementById('viewer-btn-prev');
    const $viewerBtnNext = document.getElementById('viewer-btn-next');
    const $viewerClose = document.getElementById('viewer-close');
    const $toast = document.getElementById('toast');
    const $thumbSlider = document.getElementById('thumb-size-slider');
    const $btnRescan = document.getElementById('btn-rescan');
    const $btnDownload = document.getElementById('btn-download-liked');
    const $btnClearSelection = document.getElementById('btn-clear-selection');
    const $viewerLoadOriginal = document.getElementById('viewer-load-original');
    const $viewerDownload = document.getElementById('viewer-download');
    const $btnSettings = document.getElementById('btn-settings');
    const $settingsOverlay = document.getElementById('settings-overlay');
    const $settingsClose = document.getElementById('settings-close');
    const $settingsCacheCount = document.getElementById('settings-cache-count');
    const $settingsCacheSize = document.getElementById('settings-cache-size');
    const $settingsClearCache = document.getElementById('settings-clear-cache');
    const $settingsPreviewSize = document.getElementById('settings-preview-size');
    const $countAll = document.getElementById('count-all');
    const $countLiked = document.getElementById('count-liked');
    const $downloadOverlay = document.getElementById('download-overlay');
    const $downloadCancel = document.getElementById('download-cancel');
    const $downloadCurrent = document.getElementById('download-current');
    const $downloadTotal = document.getElementById('download-total');
    const $downloadFilename = document.getElementById('download-filename');
    const $downloadProgressFill = document.getElementById('download-progress-fill');

    // ── Helpers ──────────────────────────────────────────────

    function api(path, opts) {
        return fetch(path, opts).then(r => {
            if (!r.ok) throw new Error(`API ${r.status}`);
            return r;
        });
    }

    function apiJson(path, opts) {
        return api(path, opts).then(r => r.json());
    }

    let toastTimer = null;
    function showToast(msg, duration = 2500) {
        $toast.textContent = msg;
        $toast.classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => $toast.classList.remove('visible'), duration);
    }

    function setLoading(on) {
        $loading.classList.toggle('visible', on);
    }

    // ── Counts ───────────────────────────────────────────────

    async function fetchCounts() {
        try {
            const data = await apiJson('/api/counts');
            state.counts = data;
            $countAll.textContent = data.total ?? 0;
            $countLiked.textContent = data.liked ?? 0;
        } catch (e) {
            console.error('fetchCounts', e);
        }
    }

    // ── Photos loading (infinite scroll) ─────────────────────

    async function fetchPhotos(append) {
        if (state.isLoadingMore) return;

        if (!append) {
            state.currentPage = 1;
            state.hasMorePages = true;
            $grid.innerHTML = '';
            state.photos = [];
            state.likedSet.clear();
            state.lastRenderedDate = null;
            $empty.style.display = 'none';
        }

        setLoading(true);
        state.isLoadingMore = true;

        try {
            const data = await apiJson(
                `/api/photos?filter=${state.currentFilter}&sort=${state.currentSort}&page=${state.currentPage}&page_size=${state.pageSize}`
            );
            const newPhotos = data.photos ?? [];

            state.totalPhotos = data.total ?? 0;
            state.totalPages = data.total_pages ?? Math.ceil(state.totalPhotos / state.pageSize);
            state.hasMorePages = state.currentPage < state.totalPages;

            newPhotos.forEach(p => {
                if (p.liked) state.likedSet.add(p.photo_id);
            });

            if (append) {
                state.photos = state.photos.concat(newPhotos);
            } else {
                state.photos = newPhotos;
            }

            if (state.photos.length === 0) {
                $empty.style.display = '';
            } else {
                renderGrid(newPhotos);
                observeNewThumbnails();
            }
        } catch (e) {
            console.error('fetchPhotos', e);
            showToast('Failed to load photos');
        } finally {
            setLoading(false);
            state.isLoadingMore = false;
        }
    }

    function loadMoreIfNeeded() {
        if (state.isLoadingMore || !state.hasMorePages || state.viewerActive) return;
        const scrollBottom = window.innerHeight + window.scrollY;
        const docHeight = document.documentElement.scrollHeight;
        if (docHeight - scrollBottom < 600) {
            state.currentPage++;
            fetchPhotos(true);
        }
    }

    // ── Grid rendering ───────────────────────────────────────

    function formatDate(mtime) {
        const d = new Date(mtime * 1000);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function syncDateCheckboxes() {
        const dateHeaders = $grid.querySelectorAll('.date-header');
        dateHeaders.forEach(header => {
            const checkbox = header.querySelector('.date-checkbox');
            if (!checkbox) return;
            const date = checkbox.dataset.date;
            const cardsOfDate = Array.from($grid.querySelectorAll(`.thumb-card[data-date="${date}"]`));
            if (cardsOfDate.length === 0) {
                checkbox.checked = false;
                return;
            }
            const allSelected = cardsOfDate.every(card => state.selectedSet.has(card.dataset.photoId));
            checkbox.checked = allSelected;
        });
    }

    function renderGrid(photosToRender) {
        const frag = document.createDocumentFragment();
        photosToRender.forEach(photo => {
            const dateStr = formatDate(photo.mtime);
            if (dateStr !== state.lastRenderedDate) {
                state.lastRenderedDate = dateStr;
                const header = document.createElement('div');
                header.className = 'date-header';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'date-checkbox';
                checkbox.dataset.date = dateStr;
                checkbox.title = `Select/deselect all photos on ${dateStr}`;
                header.appendChild(checkbox);
                
                const dateText = document.createTextNode(dateStr);
                header.appendChild(dateText);
                
                frag.appendChild(header);
            }

            const isSelected = state.selectedSet.has(photo.photo_id);
            const isFocused = state.focusedPhotoId === photo.photo_id;
            const card = document.createElement('div');
            card.className = 'thumb-card' +
                (photo.liked ? ' is-liked' : '') +
                (isSelected ? ' is-selected' : '') +
                (isFocused ? ' is-focused' : '');
            card.dataset.photoId = photo.photo_id;
            card.dataset.date = dateStr;

            const placeholder = document.createElement('div');
            placeholder.className = 'thumb-placeholder';
            placeholder.textContent = '·';
            card.appendChild(placeholder);

            const img = document.createElement('img');
            img.dataset.src = `/api/thumbnail/${photo.photo_id}?size=200`;
            img.alt = photo.filename || '';
            img.style.display = 'none';
            card.appendChild(img);

            const heart = document.createElement('span');
            heart.className = 'thumb-liked';
            heart.textContent = '♥';
            card.appendChild(heart);

            const selIndicator = document.createElement('span');
            selIndicator.className = 'thumb-selected-indicator';
            selIndicator.textContent = '✓';
            card.appendChild(selIndicator);

            const fname = document.createElement('span');
            fname.className = 'thumb-filename';
            fname.textContent = photo.filename || photo.photo_id;
            card.appendChild(fname);

            frag.appendChild(card);
        });
        $grid.appendChild(frag);
        syncDateCheckboxes();
    }

    // ── Lazy loading with IntersectionObserver ───────────────

    let observer = null;

    function observeNewThumbnails() {
        if (!observer) {
            observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach(entry => {
                        if (!entry.isIntersecting) return;
                        const card = entry.target;
                        const img = card.querySelector('img');
                        if (img && img.dataset.src) {
                            const targetSrc = img.dataset.src;
                            delete img.dataset.src;
                            img.onload = () => {
                                img.style.display = '';
                                const ph = card.querySelector('.thumb-placeholder');
                                if (ph) ph.remove();
                            };
                            img.onerror = () => {
                                const ph = card.querySelector('.thumb-placeholder');
                                if (ph) ph.textContent = '⚠';
                                console.error('Thumbnail load failed:', targetSrc);
                            };
                            img.src = targetSrc;
                        }
                        observer.unobserve(card);
                    });
                },
                { rootMargin: '200px' }
            );
        }
        // Only observe cards that still have data-src
        $grid.querySelectorAll('.thumb-card').forEach(c => {
            const img = c.querySelector('img');
            if (img && img.dataset.src) {
                observer.observe(c);
            }
        });
    }

    // ── Thumb size ───────────────────────────────────────────

    function applyThumbSize() {
        document.documentElement.style.setProperty('--thumb-size', state.thumbSize + 'px');
    }

    // ── Filters ──────────────────────────────────────────────

    function setFilter(filter) {
        if (filter === state.currentFilter) return;
        state.currentFilter = filter;
        state.focusedPhotoId = null;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        fetchPhotos();
    }

    // ── Focus (grid navigation) ──────────────────────────────

    function setFocusedCard(photoId) {
        const oldFocused = $grid.querySelector('.thumb-card.is-focused');
        if (oldFocused) oldFocused.classList.remove('is-focused');

        state.focusedPhotoId = photoId;

        if (photoId) {
            const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
            if (card) {
                card.classList.add('is-focused');
                card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                state.selectionAnchorId = photoId;
            }
        }
        updateDownloadButton();
    }

    function navigateGrid(direction) {
        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
        if (cards.length === 0) return;

        let currentIndex = state.focusedPhotoId
            ? cards.findIndex(c => c.dataset.photoId === state.focusedPhotoId)
            : -1;

        // If no focus yet, focus first card
        if (currentIndex === -1) {
            setFocusedCard(cards[0].dataset.photoId);
            return;
        }

        let newIndex = currentIndex;

        if (direction === 'ArrowRight') {
            newIndex = Math.min(currentIndex + 1, cards.length - 1);
        } else if (direction === 'ArrowLeft') {
            newIndex = Math.max(currentIndex - 1, 0);
        } else if (direction === 'ArrowDown' || direction === 'ArrowUp') {
            const currentCard = cards[currentIndex];
            const currentLeft = currentCard.offsetLeft;
            const currentTop = currentCard.offsetTop;

            // Group cards by offsetTop to find rows
            const rowTops = [];
            cards.forEach(c => {
                if (rowTops.length === 0 || rowTops[rowTops.length - 1] !== c.offsetTop) {
                    rowTops.push(c.offsetTop);
                }
            });

            const currentRow = rowTops.indexOf(currentTop);
            const targetRow = direction === 'ArrowDown' ? currentRow + 1 : currentRow - 1;

            if (targetRow >= 0 && targetRow < rowTops.length) {
                const targetTop = rowTops[targetRow];
                // Find card in target row with closest offsetLeft
                const rowCards = cards.filter(c => c.offsetTop === targetTop);
                let bestCard = rowCards[0];
                let bestDist = Math.abs(rowCards[0].offsetLeft - currentLeft);
                for (let i = 1; i < rowCards.length; i++) {
                    const dist = Math.abs(rowCards[i].offsetLeft - currentLeft);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCard = rowCards[i];
                    }
                }
                newIndex = cards.indexOf(bestCard);
            }
        }

        if (newIndex !== currentIndex) {
            setFocusedCard(cards[newIndex].dataset.photoId);
            // Trigger infinite scroll when nearing end
            if (newIndex > cards.length - 20 && state.hasMorePages) {
                loadMoreIfNeeded();
            }
        }
    }

    function gridLike(photoId) {
        if (!photoId) return;
        state.likedSet.add(photoId);
        if (state.likedIdsCache !== null) state.likedIdsCache.push(photoId);
        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.add('is-liked');
        api(`/api/like/${photoId}`, { method: 'POST' }).catch(e => console.error('like failed', e));
        fetchCounts();
        showToast('♥ Liked');
    }

    function gridUnlike(photoId) {
        if (!photoId) return;
        state.likedSet.delete(photoId);
        if (state.likedIdsCache !== null) {
            const idx = state.likedIdsCache.indexOf(photoId);
            if (idx >= 0) state.likedIdsCache.splice(idx, 1);
        }
        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.remove('is-liked');
        api(`/api/unlike/${photoId}`, { method: 'POST' }).catch(e => console.error('unlike failed', e));
        fetchCounts();
        showToast('♡ Unliked');
    }

    // ── Viewer ───────────────────────────────────────────────

    function setViewerLikedUI(liked) {
        $viewerLiked.textContent = liked ? '♥ Liked' : '♡ Like';
        $viewerLiked.className = 'viewer-liked-indicator ' + (liked ? 'is-liked' : '');
    }

    function openViewer(photoId) {
        state.scrollPosition = window.scrollY;
        state.viewerActive = true;
        state.viewerPhotoId = photoId;
        state.viewerIsOriginal = false;

        // Immediately populate navigation from grid data (works even if API is slow)
        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
        const idx = cards.findIndex(c => c.dataset.photoId === photoId);
        if (idx !== -1) {
            state.viewerIndex = idx;
            state.totalPhotos = cards.length;
            state.viewerPrevIds = idx > 0 ? cards.slice(Math.max(0, idx - 3), idx).map(c => c.dataset.photoId).reverse() : [];
            state.viewerNextIds = idx < cards.length - 1 ? cards.slice(idx + 1, Math.min(cards.length, idx + 4)).map(c => c.dataset.photoId) : [];
            $viewerPosition.textContent = `${idx + 1} / ${cards.length}`;
        }

        // Immediately set liked state from known data
        setViewerLikedUI(state.likedSet.has(photoId));

        showViewerPhoto(photoId);
        $viewer.style.display = '';
        document.body.style.overflow = 'hidden';
        showViewerBars();
    }

    const $viewerImgContainer = $viewer.querySelector('.viewer-image-container');

    function resetZoom() {
        if ($viewerImgContainer) {
            $viewerImgContainer.classList.remove('is-zoomed');
        }
    }

    function closeViewer() {
        resetZoom();
        state.viewerActive = false;
        state.viewerPhotoId = null;
        $viewer.style.display = 'none';
        $viewerImg.src = '';
        document.body.style.overflow = '';

        fetchCounts();
        window.scrollTo(0, state.scrollPosition);
    }

    function showViewerPhoto(photoId) {
        resetZoom();
        state.viewerPhotoId = photoId;
        state.viewerIsOriginal = false;

        if ($viewerLoadOriginal) {
            $viewerLoadOriginal.textContent = 'Load Original';
            $viewerLoadOriginal.disabled = false;
        }

        // Show loading state, then load at configured preview size
        $viewerImg.style.opacity = '0.4';
        const sizeParam = state.previewSize > 0 ? `?size=${state.previewSize}` : '';
        const thumbUrl = `/api/thumbnail/${photoId}${sizeParam}`;
        $viewerImg.onload = () => { $viewerImg.style.opacity = '1'; };
        $viewerImg.src = thumbUrl;

        updateViewerInfo(photoId);
    }

    function loadOriginalForViewer() {
        if (!state.viewerPhotoId || state.viewerIsOriginal) return;

        if ($viewerLoadOriginal) {
            $viewerLoadOriginal.textContent = 'Loading…';
            $viewerLoadOriginal.disabled = true;
        }

        const orig = new Image();
        const expectedId = state.viewerPhotoId;
        orig.onload = () => {
            if (state.viewerPhotoId === expectedId) {
                $viewerImg.src = orig.src;
                state.viewerIsOriginal = true;
                if ($viewerLoadOriginal) {
                    $viewerLoadOriginal.textContent = 'Original ✓';
                    $viewerLoadOriginal.disabled = true;
                }
                showToast('Original loaded');
            }
        };
        orig.onerror = () => {
            if (state.viewerPhotoId === expectedId) {
                if ($viewerLoadOriginal) {
                    $viewerLoadOriginal.textContent = 'Load Original';
                    $viewerLoadOriginal.disabled = false;
                }
                showToast('Failed to load original');
            }
        };
        orig.src = `/api/original/${state.viewerPhotoId}`;
    }

    function updateViewerInfo(photoId) {
        const expectedId = photoId;
        const url = `/api/photo/${photoId}?filter=${state.currentFilter}&sort=${state.currentSort}`;

        apiJson(url)
            .then(photo => {
                if (state.viewerPhotoId !== expectedId) return;

                // Always update filename
                $viewerFilenameBottom.textContent = photo.filename || photoId;

                // Update position only if API returned valid index
                if (photo.index !== undefined && photo.index !== -1 && photo.total > 0) {
                    state.viewerIndex = photo.index - 1;
                    state.totalPhotos = photo.total;
                    $viewerPosition.textContent = `${photo.index} / ${photo.total}`;
                }
                // else: keep the grid-populated position from openViewer()

                // Update liked state
                const liked = !!photo.liked;
                if (liked) {
                    state.likedSet.add(photoId);
                } else {
                    state.likedSet.delete(photoId);
                }
                setViewerLikedUI(liked);

                // Only overwrite nav IDs if API returned valid non-empty arrays
                if (photo.next_ids && photo.next_ids.length > 0) {
                    state.viewerNextIds = photo.next_ids;
                }
                if (photo.prev_ids && photo.prev_ids.length > 0) {
                    state.viewerPrevIds = photo.prev_ids;
                }
                preloadNearbyList(state.viewerPrevIds, state.viewerNextIds);
            })
            .catch(err => {
                console.error('updateViewerInfo failed', err);
                if (state.viewerPhotoId === expectedId) {
                    $viewerFilenameBottom.textContent = photoId;
                    // Keep grid-populated position and liked state (don't clear them)
                }
            });
    }

    function preloadNearbyList(prevIds, nextIds) {
        const toPreload = [];
        if (nextIds && nextIds.length > 0) toPreload.push(nextIds[0]);
        if (nextIds && nextIds.length > 1) toPreload.push(nextIds[1]);
        if (prevIds && prevIds.length > 0) toPreload.push(prevIds[0]);
        toPreload.forEach(id => {
            if (id) { const img = new Image(); img.src = `/api/thumbnail/${id}`; }
        });
    }

    function viewerPrev() {
        if (state.viewerPrevIds.length > 0) {
            const prevId = state.viewerPrevIds.shift();
            state.viewerNextIds.unshift(state.viewerPhotoId);
            state.viewerPhotoId = prevId;
            if (state.viewerIndex > 0) state.viewerIndex--;
            $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
            setViewerLikedUI(state.likedSet.has(prevId));
            extendViewerNavFromGrid();
            showViewerPhoto(prevId);
        } else {
            // Buffer empty – ask the API for the previous ID
            const currentId = state.viewerPhotoId;
            apiJson(`/api/photo/${currentId}/prev?filter=${state.currentFilter}&sort=${state.currentSort}`)
                .then(data => {
                    if (state.viewerPhotoId !== currentId) return;
                    const prevId = data.photo_id;
                    state.viewerNextIds.unshift(currentId);
                    state.viewerPhotoId = prevId;
                    if (state.viewerIndex > 0) state.viewerIndex--;
                    $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
                    setViewerLikedUI(state.likedSet.has(prevId));
                    showViewerPhoto(prevId);
                })
                .catch(() => { /* already at first photo */ });
        }
    }

    function viewerNext() {
        if (state.viewerNextIds.length > 0) {
            const nextId = state.viewerNextIds.shift();
            state.viewerPrevIds.unshift(state.viewerPhotoId);
            state.viewerPhotoId = nextId;
            if (state.viewerIndex < state.totalPhotos - 1) state.viewerIndex++;
            $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
            setViewerLikedUI(state.likedSet.has(nextId));
            extendViewerNavFromGrid();
            showViewerPhoto(nextId);
        } else {
            // Buffer empty – ask the API for the next ID
            const currentId = state.viewerPhotoId;
            apiJson(`/api/photo/${currentId}/next?filter=${state.currentFilter}&sort=${state.currentSort}`)
                .then(data => {
                    if (state.viewerPhotoId !== currentId) return;
                    const nextId = data.photo_id;
                    state.viewerPrevIds.unshift(currentId);
                    state.viewerPhotoId = nextId;
                    if (state.viewerIndex < state.totalPhotos - 1) state.viewerIndex++;
                    $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
                    setViewerLikedUI(state.likedSet.has(nextId));
                    showViewerPhoto(nextId);
                })
                .catch(() => { /* already at last photo */ });
        }
    }

    function extendViewerNavFromGrid() {
        // Replenish prev/next IDs from grid data when running low
        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
        const idx = state.viewerIndex;
        if (idx < 0 || idx >= cards.length) return;
        if (state.viewerNextIds.length < 2) {
            const start = idx + 1 + state.viewerNextIds.length;
            const end = Math.min(cards.length, start + 3);
            for (let i = start; i < end; i++) {
                state.viewerNextIds.push(cards[i].dataset.photoId);
            }
        }
        if (state.viewerPrevIds.length < 2) {
            const end = idx - state.viewerPrevIds.length;
            const start = Math.max(0, end - 3);
            for (let i = end - 1; i >= start; i--) {
                state.viewerPrevIds.push(cards[i].dataset.photoId);
            }
        }
    }

    async function viewerLike() {
        if (!state.viewerPhotoId) return;
        const photoId = state.viewerPhotoId;

        state.likedSet.add(photoId);
        if (state.likedIdsCache !== null) state.likedIdsCache.push(photoId);
        setViewerLikedUI(true);

        // Sync grid card state
        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.add('is-liked');

        api(`/api/like/${photoId}`, { method: 'POST' }).catch(e =>
            console.error('like failed', e)
        );
        // NO auto-advance
    }

    async function viewerUnlike() {
        if (!state.viewerPhotoId) return;
        const photoId = state.viewerPhotoId;

        state.likedSet.delete(photoId);
        if (state.likedIdsCache !== null) {
            const idx = state.likedIdsCache.indexOf(photoId);
            if (idx >= 0) state.likedIdsCache.splice(idx, 1);
        }
        setViewerLikedUI(false);

        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.remove('is-liked');

        api(`/api/unlike/${photoId}`, { method: 'POST' }).catch(e =>
            console.error('unlike failed', e)
        );
    }

    $viewerLiked.addEventListener('click', () => {
        if (!state.viewerPhotoId) return;
        const photoId = state.viewerPhotoId;
        const liked = state.likedSet.has(photoId);
        if (liked) {
            viewerUnlike();
        } else {
            viewerLike();
        }
    });

    $viewerBtnPrev.addEventListener('click', viewerPrev);
    $viewerBtnNext.addEventListener('click', viewerNext);

    // ── Keyboard handling ────────────────────────────────────

    document.addEventListener('keydown', (e) => {
        // Don't capture keys when focused on inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (state.viewerActive) {
            // ── Viewer mode ──
            switch (e.code) {
                case 'ArrowLeft':
                    e.preventDefault();
                    viewerPrev();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    viewerNext();
                    break;
                case 'Digit1':
                case 'Numpad1':
                    e.preventDefault();
                    viewerLike();
                    break;
                case 'Digit0':
                case 'Numpad0':
                    e.preventDefault();
                    viewerUnlike();
                    break;
                case 'Digit2':
                case 'Numpad2':
                case 'KeyO':
                    e.preventDefault();
                    loadOriginalForViewer();
                    break;
                case 'KeyD':
                    e.preventDefault();
                    if (state.viewerPhotoId) {
                        downloadSingleFile(state.viewerPhotoId);
                    }
                    break;
                case 'Escape':
                case 'Space':
                    e.preventDefault();
                    closeViewer();
                    break;
            }
        } else {
            // ── Grid mode ──
            switch (e.code) {
                case 'ArrowLeft':
                case 'ArrowRight':
                case 'ArrowUp':
                case 'ArrowDown':
                    e.preventDefault();
                    navigateGrid(e.code);
                    break;
                case 'Space':
                    e.preventDefault();
                    if (state.focusedPhotoId) openViewer(state.focusedPhotoId);
                    break;
                case 'Digit1':
                case 'Numpad1':
                    e.preventDefault();
                    if (state.focusedPhotoId) gridLike(state.focusedPhotoId);
                    break;
                case 'Digit0':
                case 'Numpad0':
                    e.preventDefault();
                    if (state.focusedPhotoId) gridUnlike(state.focusedPhotoId);
                    break;
            }
        }
    });

    // ── Selection helpers ────────────────────────────────────

    function handleSelectionClick(card, photoId, isShift, isCmd) {
        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
        const clickedIndex = cards.indexOf(card);

        if (isShift) {
            const anchorId = state.selectionAnchorId || state.focusedPhotoId || photoId;
            const anchorCard = $grid.querySelector(`.thumb-card[data-photo-id="${anchorId}"]`);
            if (anchorCard) {
                const anchorIndex = cards.indexOf(anchorCard);
                const start = Math.min(anchorIndex, clickedIndex);
                const end = Math.max(anchorIndex, clickedIndex);
                for (let i = start; i <= end; i++) {
                    const c = cards[i];
                    const id = c.dataset.photoId;
                    state.selectedSet.add(id);
                    c.classList.add('is-selected');
                }
            }
        } else {
            if (state.selectedSet.has(photoId)) {
                state.selectedSet.delete(photoId);
                card.classList.remove('is-selected');
            } else {
                state.selectedSet.add(photoId);
                card.classList.add('is-selected');
            }
            state.selectionAnchorId = photoId;
        }

        state.lastClickedId = photoId;
        syncDateCheckboxes();
        updateDownloadButton();
    }

    function updateDownloadButton() {
        if (state.selectedSet.size > 0) {
            $btnDownload.textContent = `⬇ Download Selected (${state.selectedSet.size})`;
            $btnDownload.title = `Download selected photos (${state.selectedSet.size})`;
            if ($btnClearSelection) $btnClearSelection.style.display = '';
        } else if (state.focusedPhotoId) {
            $btnDownload.textContent = '⬇ Download This';
            $btnDownload.title = 'Download focused photo';
            if ($btnClearSelection) $btnClearSelection.style.display = 'none';
        } else {
            $btnDownload.textContent = '⬇ Download Liked';
            $btnDownload.title = 'Download all liked photos';
            if ($btnClearSelection) $btnClearSelection.style.display = 'none';
        }
    }

    // ── Click handlers ───────────────────────────────────────

    // Grid: single click = focus, double click = open viewer, shift/cmd click = select
    $grid.addEventListener('click', (e) => {
        const dateCheckbox = e.target.closest('.date-checkbox');
        if (dateCheckbox) {
            e.stopPropagation();
            const date = dateCheckbox.dataset.date;
            const cardsOfDate = $grid.querySelectorAll(`.thumb-card[data-date="${date}"]`);
            // After browser toggles the checkbox, read the new state
            const checked = dateCheckbox.checked;
            cardsOfDate.forEach(card => {
                const photoId = card.dataset.photoId;
                if (checked) {
                    state.selectedSet.add(photoId);
                    card.classList.add('is-selected');
                } else {
                    state.selectedSet.delete(photoId);
                    card.classList.remove('is-selected');
                }
            });
            updateDownloadButton();
            syncDateCheckboxes();
            return;
        }

        const header = e.target.closest('.date-header');
        if (header) {
            // Clicked on date text / gap (not the checkbox): do nothing
            return;
        }

        const card = e.target.closest('.thumb-card');
        if (!card) return;
        const photoId = card.dataset.photoId;
        if (!photoId) return;

        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            handleSelectionClick(card, photoId, e.shiftKey, e.ctrlKey || e.metaKey);
        } else {
            setFocusedCard(photoId);
            state.selectionAnchorId = photoId;
        }
    });

    // Double click on a thumbnail opens the viewer
    $grid.addEventListener('dblclick', (e) => {
        const card = e.target.closest('.thumb-card');
        if (!card) return;
        const photoId = card.dataset.photoId;
        if (!photoId) return;
        openViewer(photoId);
    });

    $viewerClose.addEventListener('click', closeViewer);

    // Viewer top/bottom bar: always visible, no auto-hide
    const $viewerTopBar = $viewer.querySelector('.viewer-top-bar');
    const $viewerBottomBar = $viewer.querySelector('.viewer-bottom-bar');
    const $viewerCloseBtn = $viewer.querySelector('.viewer-close-btn');

    function showViewerBars() {
        // bars are always visible; kept for compatibility with event listeners
        $viewerTopBar.classList.remove('hidden');
        $viewerBottomBar.classList.remove('hidden');
        $viewerCloseBtn.classList.remove('hidden');
    }

    function hideViewerBars() {
        // intentionally disabled – bars stay visible always
    }

    $viewer.addEventListener('mousemove', showViewerBars);
    $viewer.addEventListener('touchstart', showViewerBars);
    document.addEventListener('keydown', (e) => {
        if (state.viewerActive && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Escape'].includes(e.code)) {
            showViewerBars();
        }
    });

    if ($viewerLoadOriginal) {
        $viewerLoadOriginal.addEventListener('click', loadOriginalForViewer);
    }

    if ($viewerDownload) {
        $viewerDownload.addEventListener('click', () => {
            if (state.viewerPhotoId) {
                downloadSingleFile(state.viewerPhotoId);
            }
        });
    }

    if ($btnClearSelection) {
        $btnClearSelection.addEventListener('click', () => {
            state.selectedSet.clear();
            state.lastClickedId = null;
            state.selectionAnchorId = null;
            $grid.querySelectorAll('.thumb-card.is-selected').forEach(c => {
                c.classList.remove('is-selected');
            });
            syncDateCheckboxes();
            updateDownloadButton();
        });
    }

    // Close viewer on clicking background
    $viewerImgContainer.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeViewer();
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    // Thumb size slider
    $thumbSlider.addEventListener('input', (e) => {
        state.thumbSize = parseInt(e.target.value, 10);
        applyThumbSize();
    });

    // Infinite scroll
    window.addEventListener('scroll', loadMoreIfNeeded, { passive: true });

    // Rescan
    $btnRescan.addEventListener('click', async () => {
        $btnRescan.disabled = true;
        showToast('Rescanning…');
        try {
            const data = await apiJson('/api/rescan', { method: 'POST' });
            const count = data.total ?? data.count ?? '?';
            showToast(`Rescan complete: ${count} photos`);
            await fetchCounts();
            await fetchPhotos();
        } catch (e) {
            showToast('Rescan failed');
            console.error('rescan', e);
        } finally {
            $btnRescan.disabled = false;
        }
    });

    function downloadWithAnchor(id, filename) {
        const a = document.createElement('a');
        a.href = `/api/download/${id}`;
        a.download = filename || '';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
    }

    // Single-file download: fetch as blob then create object URL.
    // This works on Android Chrome (no popup blocker issues) and ensures
    // the file saves rather than opening inline.
    function downloadSingleFile(id) {
        showToast('Downloading…');
        fetch(`/api/download/${id}`)
            .then(resp => {
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const disp = resp.headers.get('Content-Disposition') || '';
                const match = disp.match(/filename[^;=\n]*=["']?([^"';\n]+)["']?/i);
                const xfn = resp.headers.get('X-Filename');
                const filename = match ? match[1].trim() : (xfn || `photo_${id}`);
                return resp.blob().then(blob => ({ blob, filename }));
            })
            .then(({ blob, filename }) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
                showToast(`Downloaded: ${filename}`);
            })
            .catch(e => {
                console.error('downloadSingleFile', e);
                showToast('Download failed');
            });
    }

    function getUniqueFilename(name, existingNames) {
        if (!existingNames.has(name)) return name;
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.substring(0, dot) : name;
        const ext = dot > 0 ? name.substring(dot) : '';
        let i = 1;
        while (existingNames.has(`${base}_${i}${ext}`)) i++;
        return `${base}_${i}${ext}`;
    }

    let downloadAbort = null;

    function showDownloadProgress(total) {
        $downloadCurrent.textContent = '0';
        $downloadTotal.textContent = String(total);
        $downloadFilename.textContent = '';
        $downloadProgressFill.style.width = '0%';
        $downloadOverlay.style.display = '';
    }

    function updateDownloadProgress(current, total, filename) {
        $downloadCurrent.textContent = String(current);
        $downloadFilename.textContent = filename;
        $downloadProgressFill.style.width = `${((current) / total * 100).toFixed(1)}%`;
    }

    function hideDownloadProgress() {
        $downloadOverlay.style.display = 'none';
    }

    // Bulk download with File System Access API (works on localhost/HTTPS)
    async function downloadBulkWithFSAccess(dirHandle, ids) {
        const abort = new AbortController();
        downloadAbort = abort;

        showDownloadProgress(ids.length);
        $btnDownload.disabled = true;

        const existingNames = new Set();
        try {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file') existingNames.add(entry.name);
            }
        } catch (_) { /* ignore */ }

        let completed = 0;
        let failed = 0;

        for (const id of ids) {
            if (abort.signal.aborted) break;
            try {
                const resp = await fetch(`/api/download/${id}`, { signal: abort.signal });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const disposition = resp.headers.get('Content-Disposition') || '';
                const match = disposition.match(/filename="?([^";\n]+)"?/);
                let filename = match ? match[1] : `photo_${id}`;
                filename = getUniqueFilename(filename, existingNames);
                existingNames.add(filename);

                const blob = await resp.blob();
                const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();

                completed++;
                updateDownloadProgress(completed, ids.length, filename);
            } catch (e) {
                if (e.name === 'AbortError') break;
                console.error(`download photo ${id}`, e);
                failed++;
                completed++;
                updateDownloadProgress(completed, ids.length, '(skipped)');
            }
        }

        hideDownloadProgress();
        $btnDownload.disabled = false;
        downloadAbort = null;

        if (abort.signal.aborted) {
            showToast(`Download cancelled (${completed - failed}/${ids.length} saved)`);
        } else if (failed > 0) {
            showToast(`Downloaded ${completed - failed}/${ids.length} (${failed} failed)`, 4000);
        } else {
            showToast(`Downloaded ${ids.length} photos ✓`);
        }
    }

    // Bulk download for Android/HTTP fallback: fetch each file as blob and
    // trigger download via object URL. Sequential to avoid popup blocking.
    async function downloadBulkSync(ids) {
        if (ids.length === 0) {
            showToast('No photos to download');
            return;
        }

        const abort = new AbortController();
        downloadAbort = abort;

        showDownloadProgress(ids.length);
        $btnDownload.disabled = true;

        let completed = 0;
        let failed = 0;

        for (const id of ids) {
            if (abort.signal.aborted) break;
            try {
                const resp = await fetch(`/api/download/${id}`, { signal: abort.signal });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const disp = resp.headers.get('Content-Disposition') || '';
                const match = disp.match(/filename[^;=\n]*=["']?([^"';\n]+)["']?/i);
                const xfn = resp.headers.get('X-Filename');
                const filename = match ? match[1].trim() : (xfn || `photo_${id}`);
                const blob = await resp.blob();

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

                completed++;
                updateDownloadProgress(completed, ids.length, filename);
                // Short pause so browser can process each download
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                if (e.name === 'AbortError') break;
                console.error(`download photo ${id}`, e);
                failed++;
                completed++;
                updateDownloadProgress(completed, ids.length, '(skipped)');
            }
        }

        hideDownloadProgress();
        $btnDownload.disabled = false;
        downloadAbort = null;

        if (abort.signal.aborted) {
            showToast(`Download cancelled (${completed - failed}/${ids.length} saved)`);
        } else if (failed > 0) {
            showToast(`Downloaded ${completed - failed}/${ids.length} (${failed} failed)`, 4000);
        } else {
            showToast(`Downloaded ${ids.length} photos ✓`);
        }
    }

    if ($downloadCancel) {
        $downloadCancel.addEventListener('click', () => {
            if (downloadAbort) downloadAbort.abort();
        });
    }

    async function fetchLikedIds() {
        const data = await apiJson('/api/photos?filter=liked&page_size=10000');
        return (data.photos || []).map(p => p.photo_id);
    }

    // 预缓存 liked IDs，供同步下载使用
    async function refreshLikedIdsCache() {
        try {
            const data = await apiJson('/api/photos?filter=liked&page_size=10000');
            state.likedIdsCache = (data.photos || []).map(p => p.photo_id);
        } catch (e) {
            console.error('refreshLikedIdsCache', e);
        }
    }

    $btnDownload.addEventListener('click', async () => {
        let ids;
        if (state.selectedSet.size > 0) {
            // Selected photos (ctrl/shift-click): download exactly those
            ids = Array.from(state.selectedSet);
        } else if (state.focusedPhotoId) {
            // Single focused photo (plain click): treat as ad-hoc download
            ids = [state.focusedPhotoId];
        } else {
            // No selection and no focus → fall back to all liked photos
            if (state.likedIdsCache && state.likedIdsCache.length > 0) {
                ids = state.likedIdsCache;
            } else {
                showToast('No photos selected or liked');
                return;
            }
        }

        // 优先尝试 File System Access API（localhost / HTTPS 下可用，支持选目录）
        if (window.showDirectoryPicker) {
            let dirHandle;
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.error('showDirectoryPicker', e);
                // 失败则走同步回退
            }
            if (dirHandle) {
                await downloadBulkWithFSAccess(dirHandle, ids);
                return;
            }
        }

        // HTTP 回退：同步锚点下载（保留用户手势，不经过 fetch）
        downloadBulkSync(ids);
    });

    // ── Init ─────────────────────────────────────────────────

    async function init() {
        applyThumbSize();
        // Restore preview size setting
        if ($settingsPreviewSize) {
            const saved = String(state.previewSize);
            $settingsPreviewSize.value = saved === '0' ? '0' : state.previewSize.toString();
        }
        setLoading(true);
        try {
            await fetchCounts();
            await fetchPhotos();
            await refreshLikedIdsCache();
        } catch (e) {
            console.error('init', e);
            showToast('Failed to initialize');
        }
    }

    init();

    // ── Settings panel ──────────────────────────────────────

    function openSettings() {
        $settingsOverlay.style.display = '';
        refreshCacheStats();
    }

    function closeSettings() {
        $settingsOverlay.style.display = 'none';
    }

    async function refreshCacheStats() {
        try {
            const stats = await apiJson('/api/cache/stats');
            $settingsCacheCount.textContent = stats.file_count ?? '—';
            $settingsCacheSize.textContent = stats.total_size_human ?? '—';
        } catch (e) {
            $settingsCacheCount.textContent = 'Error';
            $settingsCacheSize.textContent = 'Error';
        }
    }

    $btnSettings.addEventListener('click', openSettings);
    $settingsClose.addEventListener('click', closeSettings);
    $settingsOverlay.addEventListener('click', (e) => {
        if (e.target === $settingsOverlay) closeSettings();
    });

    $settingsClearCache.addEventListener('click', async () => {
        $settingsClearCache.disabled = true;
        $settingsClearCache.textContent = 'Clearing…';
        try {
            const result = await apiJson('/api/cache/clear', { method: 'POST' });
            showToast(`Cache cleared: ${result.freed || ''} freed`);
            refreshCacheStats();
        } catch (e) {
            showToast('Failed to clear cache');
        } finally {
            $settingsClearCache.disabled = false;
            $settingsClearCache.textContent = 'Clear Cache';
        }
    });

    $settingsPreviewSize.addEventListener('change', () => {
        const val = parseInt($settingsPreviewSize.value, 10);
        state.previewSize = val;
        localStorage.setItem('viewerPreviewSize', val.toString());
        showToast('Preview size saved');
    });
})();
