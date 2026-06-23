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
    };

    // ── DOM refs ─────────────────────────────────────────────
    const $grid = document.getElementById('photo-grid');
    const $loading = document.getElementById('loading');
    const $empty = document.getElementById('empty-state');
    const $viewer = document.getElementById('viewer');
    const $viewerImg = document.getElementById('viewer-img');
    const $viewerFilename = document.getElementById('viewer-filename');
    const $viewerPosition = document.getElementById('viewer-position');
    const $viewerLiked = document.getElementById('viewer-liked');
    const $viewerClose = document.getElementById('viewer-close');
    const $toast = document.getElementById('toast');
    const $thumbSlider = document.getElementById('thumb-size-slider');
    const $btnRescan = document.getElementById('btn-rescan');
    const $btnDownload = document.getElementById('btn-download-liked');
    const $btnClearSelection = document.getElementById('btn-clear-selection');
    const $viewerLoadOriginal = document.getElementById('viewer-load-original');
    const $viewerDownload = document.getElementById('viewer-download');
    const $countAll = document.getElementById('count-all');
    const $countLiked = document.getElementById('count-liked');
    const $countUnliked = document.getElementById('count-unliked');

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
            $countUnliked.textContent = data.unliked ?? 0;
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
            // Calculate columns per row from CSS grid
            const gridStyle = getComputedStyle($grid);
            const cols = gridStyle.gridTemplateColumns.split(' ').length;
            if (direction === 'ArrowDown') {
                newIndex = Math.min(currentIndex + cols, cards.length - 1);
            } else {
                newIndex = Math.max(currentIndex - cols, 0);
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
        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.add('is-liked');
        api(`/api/like/${photoId}`, { method: 'POST' }).catch(e => console.error('like failed', e));
        fetchCounts();
        showToast('♥ Liked');
    }

    function gridUnlike(photoId) {
        if (!photoId) return;
        state.likedSet.delete(photoId);
        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.remove('is-liked');
        api(`/api/unlike/${photoId}`, { method: 'POST' }).catch(e => console.error('unlike failed', e));
        fetchCounts();
        showToast('♡ Unliked');
    }

    // ── Viewer ───────────────────────────────────────────────

    function openViewer(photoId) {
        state.scrollPosition = window.scrollY;
        state.viewerActive = true;
        state.viewerPhotoId = photoId;
        state.viewerIndex = -1;
        state.viewerNextIds = [];
        state.viewerPrevIds = [];

        showViewerPhoto(photoId);
        $viewer.style.display = '';
        document.body.style.overflow = 'hidden';
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

        // Show loading state, then load 1024px thumbnail
        $viewerImg.style.opacity = '0.4';
        const thumbUrl = `/api/thumbnail/${photoId}`;
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

                $viewerFilename.textContent = photo.filename || photoId;

                if (photo.index !== undefined && photo.index !== -1) {
                    state.viewerIndex = photo.index - 1;
                    state.totalPhotos = photo.total;
                    $viewerPosition.textContent = `${photo.index} / ${photo.total}`;
                } else {
                    $viewerPosition.textContent = '';
                }

                const liked = !!photo.liked;
                if (liked) {
                    state.likedSet.add(photoId);
                } else {
                    state.likedSet.delete(photoId);
                }
                $viewerLiked.textContent = liked ? '♥ Liked' : '♡ Unliked';
                $viewerLiked.className = 'viewer-liked-indicator ' + (liked ? 'is-liked' : 'is-unliked');

                state.viewerNextIds = photo.next_ids || [];
                state.viewerPrevIds = photo.prev_ids || [];
                preloadNearbyList(state.viewerPrevIds, state.viewerNextIds);
            })
            .catch(err => {
                console.error('updateViewerInfo failed', err);
                if (state.viewerPhotoId === expectedId) {
                    $viewerFilename.textContent = photoId;
                    $viewerPosition.textContent = '';
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
            showViewerPhoto(prevId);
        }
    }

    function viewerNext() {
        if (state.viewerNextIds.length > 0) {
            const nextId = state.viewerNextIds.shift();
            state.viewerPrevIds.unshift(state.viewerPhotoId);
            state.viewerPhotoId = nextId;
            showViewerPhoto(nextId);
        }
    }

    async function viewerLike() {
        if (!state.viewerPhotoId) return;
        const photoId = state.viewerPhotoId;

        state.likedSet.add(photoId);
        $viewerLiked.textContent = '♥ Liked';
        $viewerLiked.className = 'viewer-liked-indicator is-liked';

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
        $viewerLiked.textContent = '♡ Unliked';
        $viewerLiked.className = 'viewer-liked-indicator is-unliked';

        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) card.classList.remove('is-liked');

        api(`/api/unlike/${photoId}`, { method: 'POST' }).catch(e =>
            console.error('unlike failed', e)
        );
    }

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
                        triggerDownload(state.viewerPhotoId);
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
        } else {
            $btnDownload.textContent = '⬇ Download Liked';
            $btnDownload.title = 'Download liked photos as ZIP';
            if ($btnClearSelection) $btnClearSelection.style.display = 'none';
        }
    }

    // ── Click handlers ───────────────────────────────────────

    // Grid: single click = focus, shift/cmd click = select
    $grid.addEventListener('click', (e) => {
        const dateCheckbox = e.target.closest('.date-checkbox');
        if (dateCheckbox) {
            e.stopPropagation();
            const checked = dateCheckbox.checked;
            const date = dateCheckbox.dataset.date;
            const cardsOfDate = $grid.querySelectorAll(`.thumb-card[data-date="${date}"]`);
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

    $viewerClose.addEventListener('click', closeViewer);

    if ($viewerLoadOriginal) {
        $viewerLoadOriginal.addEventListener('click', loadOriginalForViewer);
    }

    if ($viewerDownload) {
        $viewerDownload.addEventListener('click', () => {
            if (state.viewerPhotoId) {
                triggerDownload(state.viewerPhotoId);
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

    function triggerDownload(photoId) {
        const a = document.createElement('a');
        a.href = `/api/download/${photoId}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Download: selected first, then liked fallback
    $btnDownload.addEventListener('click', async () => {
        if (state.selectedSet.size > 0) {
            $btnDownload.disabled = true;
            const selectedList = Array.from(state.selectedSet);
            showToast(`Downloading ${selectedList.length} selected photos…`);
            try {
                for (let i = 0; i < selectedList.length; i++) {
                    triggerDownload(selectedList[i]);
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            } catch (e) {
                console.error('Download selected failed', e);
                showToast('Download failed');
            } finally {
                $btnDownload.disabled = false;
            }
            return;
        }

        if (state.counts.liked === 0) {
            showToast('No liked photos to download');
            return;
        }
        $btnDownload.disabled = true;
        showToast('Requesting liked list…');
        try {
            const data = await apiJson('/api/photos?filter=liked&page_size=10000');
            const likedList = data.photos || [];
            if (likedList.length === 0) {
                showToast('No liked photos found');
                $btnDownload.disabled = false;
                return;
            }
            showToast(`Downloading ${likedList.length} photos…`);
            for (let i = 0; i < likedList.length; i++) {
                triggerDownload(likedList[i].photo_id);
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        } catch (e) {
            console.error('Download liked failed', e);
            showToast('Download failed');
        } finally {
            $btnDownload.disabled = false;
        }
    });

    // ── Init ─────────────────────────────────────────────────

    async function init() {
        applyThumbSize();
        setLoading(true);
        try {
            await fetchCounts();
            await fetchPhotos();
        } catch (e) {
            console.error('init', e);
            showToast('Failed to initialize');
        }
    }

    init();
})();
