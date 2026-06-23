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
        viewerIsOriginal: false,
    };

    // ── DOM refs ─────────────────────────────────────────────
    const $grid = document.getElementById('photo-grid');
    const $pagination = document.getElementById('pagination');
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



    // ── Photos page ──────────────────────────────────────────

    async function fetchPhotos() {
        setLoading(true);
        $grid.innerHTML = '';
        $empty.style.display = 'none';
        try {
            const data = await apiJson(
                `/api/photos?filter=${state.currentFilter}&sort=${state.currentSort}&page=${state.currentPage}&page_size=${state.pageSize}`
            );
            state.photos = data.photos ?? [];
            state.totalPhotos = data.total ?? 0;
            state.totalPages = data.total_pages ?? Math.ceil(state.totalPhotos / state.pageSize);

            // Build liked set for quick lookup
            state.likedSet.clear();
            state.photos.forEach(p => {
                if (p.liked) state.likedSet.add(p.photo_id);
            });

            if (state.photos.length === 0) {
                $empty.style.display = '';
            } else {
                renderGrid();
                observeThumbnails();
            }
            renderPagination();
        } catch (e) {
            console.error('fetchPhotos', e);
            showToast('Failed to load photos');
        } finally {
            setLoading(false);
        }
    }

    // ── Grid rendering ───────────────────────────────────────

    function renderGrid() {
        const frag = document.createDocumentFragment();
        state.photos.forEach(photo => {
            const isSelected = state.selectedSet.has(photo.photo_id);
            const card = document.createElement('div');
            card.className = 'thumb-card' + 
                (photo.liked ? ' is-liked' : '') + 
                (isSelected ? ' is-selected' : '');
            card.dataset.photoId = photo.photo_id;

            const placeholder = document.createElement('div');
            placeholder.className = 'thumb-placeholder';
            placeholder.textContent = '·';
            card.appendChild(placeholder);

            const img = document.createElement('img');
            img.dataset.src = `/api/thumbnail/${photo.photo_id}?size=200`;
            img.alt = photo.filename || '';
            img.loading = 'lazy';
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
    }

    // ── Lazy loading with IntersectionObserver ───────────────

    let observer = null;

    function observeThumbnails() {
        if (observer) observer.disconnect();
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
                        img.src = targetSrc;
                    }
                    observer.unobserve(card);
                });
            },
            { rootMargin: '200px' }
        );
        $grid.querySelectorAll('.thumb-card').forEach(c => observer.observe(c));
    }

    // ── Pagination ───────────────────────────────────────────

    function renderPagination() {
        if (state.totalPages <= 1) {
            $pagination.innerHTML = '';
            return;
        }
        $pagination.innerHTML = '';

        const prev = document.createElement('button');
        prev.textContent = '← Previous';
        prev.disabled = state.currentPage <= 1;
        prev.addEventListener('click', () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                loadCurrentPage();
            }
        });

        const info = document.createElement('span');
        info.className = 'page-info';
        info.textContent = `Page ${state.currentPage} of ${state.totalPages}`;

        const next = document.createElement('button');
        next.textContent = 'Next →';
        next.disabled = state.currentPage >= state.totalPages;
        next.addEventListener('click', () => {
            if (state.currentPage < state.totalPages) {
                state.currentPage++;
                loadCurrentPage();
            }
        });

        $pagination.append(prev, info, next);
    }

    function loadCurrentPage() {
        window.scrollTo(0, 0);
        fetchPhotos();
    }

    // ── Thumb size ───────────────────────────────────────────

    function applyThumbSize() {
        document.documentElement.style.setProperty('--thumb-size', state.thumbSize + 'px');
    }

    // ── Filters ──────────────────────────────────────────────

    function setFilter(filter) {
        if (filter === state.currentFilter) return;
        state.currentFilter = filter;
        state.currentPage = 1;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        fetchPhotos();
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

        // Refresh the grid to reflect any like changes
        fetchCounts();
        fetchPhotos().then(() => {
            window.scrollTo(0, state.scrollPosition);
        });
    }

    function showViewerPhoto(photoId) {
        resetZoom();
        state.viewerPhotoId = photoId;
        state.viewerIsOriginal = false;

        if ($viewerLoadOriginal) {
            $viewerLoadOriginal.textContent = 'Load Original';
            $viewerLoadOriginal.disabled = false;
        }

        // Show thumbnail (1024px) for speed
        $viewerImg.src = `/api/thumbnail/${photoId}`;

        updateViewerInfo(photoId);
    }

    function loadOriginalForViewer() {
        if (!state.viewerPhotoId || state.viewerIsOriginal) return;

        if ($viewerLoadOriginal) {
            $viewerLoadOriginal.textContent = 'Loading...';
            $viewerLoadOriginal.disabled = true;
        }

        const orig = new Image();
        const expectedId = state.viewerPhotoId;
        orig.onload = () => {
            if (state.viewerPhotoId === expectedId) {
                $viewerImg.src = orig.src;
                state.viewerIsOriginal = true;
                if ($viewerLoadOriginal) {
                    $viewerLoadOriginal.textContent = 'Original Loaded';
                    $viewerLoadOriginal.disabled = true;
                }
                showToast('Original image loaded');
            }
        };
        orig.onerror = () => {
            if (state.viewerPhotoId === expectedId) {
                if ($viewerLoadOriginal) {
                    $viewerLoadOriginal.textContent = 'Load Original';
                    $viewerLoadOriginal.disabled = false;
                }
                showToast('Failed to load original image');
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

                // Update neighbor lists
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
            if (id) {
                const img = new Image();
                img.src = `/api/thumbnail/${id}`;
            }
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

        // Optimistic UI update
        state.likedSet.add(photoId);
        $viewerLiked.textContent = '♥ Liked';
        $viewerLiked.className = 'viewer-liked-indicator is-liked';

        // Fire and forget
        api(`/api/like/${photoId}`, { method: 'POST' }).catch(e =>
            console.error('like failed', e)
        );

        // Auto-advance to next
        viewerNext();
    }

    async function viewerUnlike() {
        if (!state.viewerPhotoId) return;
        const photoId = state.viewerPhotoId;

        // Optimistic UI update
        state.likedSet.delete(photoId);
        $viewerLiked.textContent = '♡ Unliked';
        $viewerLiked.className = 'viewer-liked-indicator is-unliked';

        // Fire and forget
        api(`/api/unlike/${photoId}`, { method: 'POST' }).catch(e =>
            console.error('unlike failed', e)
        );
    }

    // ── Keyboard handling ────────────────────────────────────

    document.addEventListener('keydown', (e) => {
        if (!state.viewerActive) return;

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
            case 'Escape':
                e.preventDefault();
                closeViewer();
                break;
        }
    });

    // ── Click handlers ───────────────────────────────────────

    function handleSelectionClick(card, photoId, isShift, isCmd) {
        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
        const clickedIndex = cards.indexOf(card);

        if (isShift && state.lastClickedId) {
            const lastCard = $grid.querySelector(`.thumb-card[data-photo-id="${state.lastClickedId}"]`);
            if (lastCard) {
                const lastIndex = cards.indexOf(lastCard);
                const start = Math.min(lastIndex, clickedIndex);
                const end = Math.max(lastIndex, clickedIndex);

                const shouldSelect = state.selectedSet.has(state.lastClickedId);

                for (let i = start; i <= end; i++) {
                    const c = cards[i];
                    const id = c.dataset.photoId;
                    if (shouldSelect) {
                        state.selectedSet.add(id);
                        c.classList.add('is-selected');
                    } else {
                        state.selectedSet.delete(id);
                        c.classList.remove('is-selected');
                    }
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
        }

        state.lastClickedId = photoId;
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

    // Event delegation on grid
    $grid.addEventListener('click', (e) => {
        const card = e.target.closest('.thumb-card');
        if (!card) return;
        const photoId = card.dataset.photoId;
        if (!photoId) return;

        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            handleSelectionClick(card, photoId, e.shiftKey, e.ctrlKey || e.metaKey);
        } else {
            openViewer(photoId);
        }
    });

    $viewerClose.addEventListener('click', closeViewer);

    if ($viewerLoadOriginal) {
        $viewerLoadOriginal.addEventListener('click', loadOriginalForViewer);
    }

    if ($btnClearSelection) {
        $btnClearSelection.addEventListener('click', () => {
            state.selectedSet.clear();
            state.lastClickedId = null;
            $grid.querySelectorAll('.thumb-card.is-selected').forEach(c => {
                c.classList.remove('is-selected');
            });
            updateDownloadButton();
        });
    }

    // Double click to zoom
    $viewerImgContainer.addEventListener('dblclick', () => {
        $viewerImgContainer.classList.toggle('is-zoomed');
    });

    // Close viewer on clicking background (not the image)
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

    // Rescan
    $btnRescan.addEventListener('click', async () => {
        $btnRescan.disabled = true;
        showToast('Rescanning…');
        try {
            const data = await apiJson('/api/rescan', { method: 'POST' });
            const count = data.total ?? data.count ?? '?';
            showToast(`Rescan complete: ${count} photos`);
            await fetchCounts();
            state.currentPage = 1;
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

    // Download selected or liked
    $btnDownload.addEventListener('click', async () => {
        if (state.selectedSet.size > 0) {
            $btnDownload.disabled = true;
            const selectedList = Array.from(state.selectedSet);
            showToast(`Downloading ${selectedList.length} selected photos...`);
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

            showToast(`Downloading ${likedList.length} photos...`);
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
