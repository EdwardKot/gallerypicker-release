import { state } from './state.js';
import { apiJson, buildFilteredPath, showToast } from './utils.js';
import { fetchCounts } from './grid.js';
import { attachViewerGestures } from './gesture.js';
import { setPhotoLiked } from './photoActions.js';

let downloadSingleCallback = null;

export function setViewerLikedUI(liked, animate = false) {
    const $viewerLiked = document.getElementById('viewer-liked');
    if ($viewerLiked) {
        $viewerLiked.textContent = liked ? '♥ Liked' : '♡ Like';
        $viewerLiked.className = 'viewer-liked-indicator ' + (liked ? 'is-liked' : '') + (animate && liked ? ' heart-pulse' : '');
    }

    const $floatingPill = document.getElementById('viewer-touch-pill');
    if ($floatingPill) {
        $floatingPill.classList.toggle('is-liked', liked);
        const $floatingHeart = $floatingPill.querySelector('.floating-heart-icon');
        if ($floatingHeart) {
            $floatingHeart.classList.toggle('is-liked', liked);
            if (animate && liked) {
                $floatingHeart.classList.remove('heart-pulse');
                void $floatingHeart.offsetWidth; // trigger reflow
                $floatingHeart.classList.add('heart-pulse');
            }
        }
    }
}

export function openViewer(photoId) {
    state.scrollPosition = window.scrollY;
    state.viewerActive = true;
    state.viewerPhotoId = photoId;
    state.viewerIsOriginal = false;

    // Immediately populate navigation from grid data (works even if API is slow)
    const $grid = document.getElementById('photo-grid');
    if ($grid) {
        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
        const idx = cards.findIndex(c => c.dataset.photoId === photoId);
        if (idx !== -1) {
            state.viewerIndex = idx;
            state.totalPhotos = cards.length;
            state.viewerPrevIds = idx > 0 ? cards.slice(Math.max(0, idx - 4), idx).map(c => c.dataset.photoId).reverse() : [];
            state.viewerNextIds = idx < cards.length - 1 ? cards.slice(idx + 1, Math.min(cards.length, idx + 5)).map(c => c.dataset.photoId) : [];
            const $viewerPosition = document.getElementById('viewer-position');
            if ($viewerPosition) $viewerPosition.textContent = `${idx + 1} / ${cards.length}`;
        }
    }

    // Immediately set liked state from known data
    setViewerLikedUI(state.likedSet.has(photoId));

    showViewerPhoto(photoId);
    const $viewer = document.getElementById('viewer');
    if ($viewer) $viewer.style.display = '';
    document.body.style.overflow = 'hidden';
    showViewerBars();
}

export function resetZoom() {
    const $viewerImgContainer = document.querySelector('#viewer .viewer-image-container');
    if ($viewerImgContainer) {
        $viewerImgContainer.classList.remove('is-zoomed');
    }
}

export function closeViewer() {
    resetZoom();
    state.viewerActive = false;
    state.viewerPhotoId = null;
    const $viewer = document.getElementById('viewer');
    const $viewerImg = document.getElementById('viewer-img');
    if ($viewer) $viewer.style.display = 'none';
    if ($viewerImg) $viewerImg.src = '';
    document.body.style.overflow = '';

    fetchCounts();
    window.scrollTo(0, state.scrollPosition);
}

export function showViewerPhoto(photoId) {
    resetZoom();
    state.viewerPhotoId = photoId;
    state.viewerIsOriginal = false;

    const $viewerLoadOriginal = document.getElementById('viewer-load-original');
    const $viewerImg = document.getElementById('viewer-img');

    if ($viewerLoadOriginal) {
        $viewerLoadOriginal.textContent = 'Load Original';
        $viewerLoadOriginal.disabled = false;
    }

    if ($viewerImg) {
        // Show loading state, then load at configured preview size
        $viewerImg.style.opacity = '0.4';
        const sizeParam = state.previewSize > 0 ? `?size=${state.previewSize}` : '';
        const thumbUrl = `/api/thumbnail/${photoId}${sizeParam}`;
        $viewerImg.onload = () => { $viewerImg.style.opacity = '1'; };
        $viewerImg.src = thumbUrl;
    }

    updateViewerInfo(photoId);
}

export function loadOriginalForViewer() {
    if (!state.viewerPhotoId || state.viewerIsOriginal) return;

    const $viewerLoadOriginal = document.getElementById('viewer-load-original');
    const $viewerImg = document.getElementById('viewer-img');

    if ($viewerLoadOriginal) {
        $viewerLoadOriginal.textContent = 'Loading…';
        $viewerLoadOriginal.disabled = true;
    }

    const orig = new Image();
    const expectedId = state.viewerPhotoId;
    orig.onload = () => {
        if (state.viewerPhotoId === expectedId) {
            if ($viewerImg) $viewerImg.src = orig.src;
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

export function updateViewerInfo(photoId) {
    const expectedId = photoId;
    const url = buildFilteredPath(`/api/photo/${photoId}`);

    const $viewerFilenameBottom = document.getElementById('viewer-filename-bottom');
    const $viewerFilenameTop = document.getElementById('viewer-filename-top');
    const $viewerPosition = document.getElementById('viewer-position');

    apiJson(url)
        .then(photo => {
            if (state.viewerPhotoId !== expectedId) return;

            // Always update filename
            if ($viewerFilenameBottom) $viewerFilenameBottom.textContent = photo.filename || photoId;
            if ($viewerFilenameTop) $viewerFilenameTop.textContent = photo.filename || photoId;

            // Update position only if API returned valid index
            if (photo.index !== undefined && photo.index !== -1 && photo.total > 0) {
                state.viewerIndex = photo.index - 1;
                state.totalPhotos = photo.total;
                if ($viewerPosition) $viewerPosition.textContent = `${photo.index} / ${photo.total}`;
            }

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
                if ($viewerFilenameBottom) $viewerFilenameBottom.textContent = photoId;
                if ($viewerFilenameTop) $viewerFilenameTop.textContent = photoId;
            }
        });
}

export function preloadNearbyList(prevIds, nextIds) {
    const toPreload = [];
    if (nextIds && nextIds.length > 0) toPreload.push(nextIds[0]);
    if (nextIds && nextIds.length > 1) toPreload.push(nextIds[1]);
    if (nextIds && nextIds.length > 2) toPreload.push(nextIds[2]);
    if (prevIds && prevIds.length > 0) toPreload.push(prevIds[0]);
    if (prevIds && prevIds.length > 1) toPreload.push(prevIds[1]);
    if (prevIds && prevIds.length > 2) toPreload.push(prevIds[2]);
    toPreload.forEach(id => {
        if (id) { const img = new Image(); img.src = `/api/thumbnail/${id}`; }
    });
}

export function viewerPrev() {
    const $viewerPosition = document.getElementById('viewer-position');
    if (state.viewerPrevIds.length > 0) {
        const prevId = state.viewerPrevIds.shift();
        state.viewerNextIds.unshift(state.viewerPhotoId);
        state.viewerPhotoId = prevId;
        if (state.viewerIndex > 0) state.viewerIndex--;
        if ($viewerPosition) $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
        setViewerLikedUI(state.likedSet.has(prevId));
        extendViewerNavFromGrid();
        showViewerPhoto(prevId);
    } else {
        // Buffer empty – ask the API for the previous ID
        const currentId = state.viewerPhotoId;
        const url = buildFilteredPath(`/api/photo/${currentId}/prev`);
        apiJson(url)
            .then(data => {
                if (state.viewerPhotoId !== currentId) return;
                const prevId = data.photo_id;
                state.viewerNextIds.unshift(currentId);
                state.viewerPhotoId = prevId;
                if (state.viewerIndex > 0) state.viewerIndex--;
                if ($viewerPosition) $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
                setViewerLikedUI(state.likedSet.has(prevId));
                showViewerPhoto(prevId);
            })
            .catch(() => { /* already at first photo */ });
    }
}

export function viewerNext() {
    const $viewerPosition = document.getElementById('viewer-position');
    if (state.viewerNextIds.length > 0) {
        const nextId = state.viewerNextIds.shift();
        state.viewerPrevIds.unshift(state.viewerPhotoId);
        state.viewerPhotoId = nextId;
        if (state.viewerIndex < state.totalPhotos - 1) state.viewerIndex++;
        if ($viewerPosition) $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
        setViewerLikedUI(state.likedSet.has(nextId));
        extendViewerNavFromGrid();
        showViewerPhoto(nextId);
    } else {
        // Buffer empty – ask the API for the next ID
        const currentId = state.viewerPhotoId;
        const url = buildFilteredPath(`/api/photo/${currentId}/next`);
        apiJson(url)
            .then(data => {
                if (state.viewerPhotoId !== currentId) return;
                const nextId = data.photo_id;
                state.viewerPrevIds.unshift(currentId);
                state.viewerPhotoId = nextId;
                if (state.viewerIndex < state.totalPhotos - 1) state.viewerIndex++;
                if ($viewerPosition) $viewerPosition.textContent = `${state.viewerIndex + 1} / ${state.totalPhotos}`;
                setViewerLikedUI(state.likedSet.has(nextId));
                showViewerPhoto(nextId);
            })
            .catch(() => { /* already at last photo */ });
    }
}

export function extendViewerNavFromGrid() {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
    const cards = Array.from($grid.querySelectorAll('.thumb-card'));
    const idx = state.viewerIndex;
    if (idx < 0 || idx >= cards.length) return;
    if (state.viewerNextIds.length < 3) {
        const start = idx + 1 + state.viewerNextIds.length;
        const end = Math.min(cards.length, start + 4);
        for (let i = start; i < end; i++) {
            state.viewerNextIds.push(cards[i].dataset.photoId);
        }
    }
    if (state.viewerPrevIds.length < 3) {
        const end = idx - state.viewerPrevIds.length;
        const start = Math.max(0, end - 4);
        for (let i = end - 1; i >= start; i--) {
            state.viewerPrevIds.push(cards[i].dataset.photoId);
        }
    }
}

export async function viewerLike() {
    if (!state.viewerPhotoId) return;
    setPhotoLiked(state.viewerPhotoId, true, {
        animate: true,
        updateViewer: setViewerLikedUI,
    });
    fetchCounts();
}

export async function viewerUnlike() {
    if (!state.viewerPhotoId) return;
    setPhotoLiked(state.viewerPhotoId, false, {
        updateViewer: setViewerLikedUI,
    });
    fetchCounts();
}

export function showViewerBars() {
    const $viewer = document.getElementById('viewer');
    if (!$viewer) return;
    const $viewerTopBar = $viewer.querySelector('.viewer-top-bar');
    const $viewerBottomBar = $viewer.querySelector('.viewer-bottom-bar');
    const $viewerCloseBtn = $viewer.querySelector('.viewer-close-btn');

    if ($viewerTopBar) $viewerTopBar.classList.remove('hidden');
    if ($viewerBottomBar) $viewerBottomBar.classList.remove('hidden');
    if ($viewerCloseBtn) $viewerCloseBtn.classList.remove('hidden');
}

export function hideViewerBars() {
    // intentionally disabled – bars stay visible always
}

export function initViewer(callbacks) {
    downloadSingleCallback = callbacks.downloadSingle;

    const $viewer = document.getElementById('viewer');
    if (!$viewer) return;

    const $viewerImg = document.getElementById('viewer-img');
    const $viewerLiked = document.getElementById('viewer-liked');
    const $viewerTouchLikeBtn = document.getElementById('viewer-touch-like-btn');
    const $viewerBtnPrev = document.getElementById('viewer-btn-prev');
    const $viewerBtnNext = document.getElementById('viewer-btn-next');
    const $viewerClose = document.getElementById('viewer-close');
    const $viewerLoadOriginal = document.getElementById('viewer-load-original');
    const $viewerDownload = document.getElementById('viewer-download');
    const $viewerImgContainer = $viewer.querySelector('.viewer-image-container');

    if ($viewerClose) $viewerClose.addEventListener('click', closeViewer);
    if ($viewerBtnPrev) $viewerBtnPrev.addEventListener('click', viewerPrev);
    if ($viewerBtnNext) $viewerBtnNext.addEventListener('click', viewerNext);

    if ($viewerLiked) {
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
    }

    if ($viewerTouchLikeBtn) {
        $viewerTouchLikeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!state.viewerPhotoId) return;
            const photoId = state.viewerPhotoId;
            const liked = state.likedSet.has(photoId);
            if (liked) {
                viewerUnlike();
            } else {
                viewerLike();
            }
        });
    }

    if ($viewerLoadOriginal) {
        $viewerLoadOriginal.addEventListener('click', loadOriginalForViewer);
    }

    if ($viewerDownload) {
        $viewerDownload.addEventListener('click', () => {
            if (state.viewerPhotoId && downloadSingleCallback) {
                downloadSingleCallback(state.viewerPhotoId);
            }
        });
    }

    if ($viewerImgContainer) {
        $viewerImgContainer.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeViewer();
        });
    }

    $viewer.addEventListener('mousemove', showViewerBars);
    $viewer.addEventListener('touchstart', showViewerBars);
    document.addEventListener('keydown', (e) => {
        if (state.viewerActive && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Escape'].includes(e.code)) {
            showViewerBars();
        }
    });

    if ($viewerImgContainer && $viewerImg) {
        attachViewerGestures($viewerImgContainer, $viewerImg, $viewer, {
            isTouch: () => state.isTouch,
            onSwipeLeft: viewerNext,
            onSwipeRight: viewerPrev,
            onSwipeDown: closeViewer,
            onDoubleTap: () => {
                if (!state.viewerPhotoId) return;
                if (state.likedSet.has(state.viewerPhotoId)) {
                    viewerUnlike();
                } else {
                    viewerLike();
                }
            },
        });
    }
}
