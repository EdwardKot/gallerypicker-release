import { state } from './state.js';
import { setFocusedCard, syncDateCheckboxes } from './grid.js';
import { isDownloading } from './download.js';

let longPressTimer = 0;
let isTouchSelecting = false;
let dragSelectionStartIndex = null;
let touchStartIndex = null;
let touchStartPos = { x: 0, y: 0 };
let longPressedActive = false;
let openViewerCallback = null;

export function handleSelectionClick(card, photoId, isShift, isCmd) {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
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

export function updateDownloadButton() {
    const downloading = isDownloading();
    const $btnDownload = document.getElementById('btn-download-liked');
    const $floatingDownloadBtn = document.getElementById('floating-download-btn');
    const $floatingSelectBar = document.getElementById('floating-select-bar');
    const $selectCountBadge = document.getElementById('select-count-badge');
    const $btnClearSelection = document.getElementById('btn-clear-selection');

    if ($btnDownload) {
        $btnDownload.disabled = downloading;
    }
    if ($floatingDownloadBtn) {
        $floatingDownloadBtn.disabled = downloading;
    }

    if (state.selectedSet.size > 0) {
        if ($btnDownload) $btnDownload.style.display = 'none';
        if ($btnClearSelection) $btnClearSelection.style.display = 'none';

        if ($floatingSelectBar) $floatingSelectBar.style.display = 'flex';
        if ($selectCountBadge) $selectCountBadge.textContent = state.selectedSet.size;
    } else {
        if ($floatingSelectBar) $floatingSelectBar.style.display = 'none';
        if ($btnDownload) $btnDownload.style.display = '';
        if ($btnClearSelection) $btnClearSelection.style.display = 'none';

        if (state.focusedPhotoId) {
            if ($btnDownload) {
                $btnDownload.textContent = '⬇ Download This';
                $btnDownload.title = 'Download focused photo';
            }
        } else {
            if ($btnDownload) {
                $btnDownload.textContent = '⬇ Download Liked';
                $btnDownload.title = 'Download all liked photos';
            }
        }
    }
}

export function clearSelection() {
    state.selectedSet.clear();
    state.lastClickedId = null;
    state.selectionAnchorId = null;
    const $grid = document.getElementById('photo-grid');
    if ($grid) {
        $grid.querySelectorAll('.thumb-card.is-selected').forEach(c => c.classList.remove('is-selected'));
    }
    syncDateCheckboxes();
    updateDownloadButton();
}

function getCardIndex(card) {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return -1;
    const cards = Array.from($grid.querySelectorAll('.thumb-card'));
    return cards.indexOf(card);
}

function triggerLongPressSelection(card, index) {
    const photoId = card.dataset.photoId;
    if (!photoId) return;

    if (state.selectedSet.has(photoId)) {
        state.selectedSet.delete(photoId);
        card.classList.remove('is-selected');
    } else {
        state.selectedSet.add(photoId);
        card.classList.add('is-selected');
    }
    state.selectionAnchorId = photoId;

    isTouchSelecting = true;
    dragSelectionStartIndex = index;

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
    }

    syncDateCheckboxes();
    updateDownloadButton();
}

export function initSelection(callbacks) {
    openViewerCallback = callbacks.openViewer;

    const $grid = document.getElementById('photo-grid');
    const $btnClearSelection = document.getElementById('btn-clear-selection');
    if (!$grid) return;

    // Grid Click Handlers
    $grid.addEventListener('click', (e) => {
        const dateCheckbox = e.target.closest('.date-checkbox');
        if (dateCheckbox) {
            e.stopPropagation();
            const date = dateCheckbox.dataset.date;
            const cardsOfDate = $grid.querySelectorAll(`.thumb-card[data-date="${date}"]`);
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
            return; // Clicked on date text / gap (not the checkbox): do nothing
        }

        const card = e.target.closest('.thumb-card');
        if (!card) return;
        const photoId = card.dataset.photoId;
        if (!photoId) return;

        if (state.isTouch) {
            if (state.selectedSet.size > 0) {
                handleSelectionClick(card, photoId, false, false);
            } else if (openViewerCallback) {
                openViewerCallback(photoId);
            }
            return;
        }

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
        if (state.isTouch) return; // Prevent double tap issues on mobile
        const card = e.target.closest('.thumb-card');
        if (!card) return;
        const photoId = card.dataset.photoId;
        if (!photoId) return;
        if (openViewerCallback) openViewerCallback(photoId);
    });

    // Touch selection gestures (iPadOS / Touch screen)
    $grid.addEventListener('touchstart', (e) => {
        if (!state.isTouch) return;
        const card = e.target.closest('.thumb-card');
        if (!card) return;

        const index = getCardIndex(card);
        if (index === -1) return;

        touchStartIndex = index;
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        longPressedActive = false;

        if (longPressTimer) clearTimeout(longPressTimer);

        longPressTimer = window.setTimeout(() => {
            longPressedActive = true;
            triggerLongPressSelection(card, index);
        }, 380);
    }, { passive: true });

    $grid.addEventListener('touchmove', (e) => {
        if (!state.isTouch) return;
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];

        if (!isTouchSelecting && touchStartIndex !== null) {
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > 15) {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = 0;
                }
                touchStartIndex = null;
            }
            return;
        }

        if (isTouchSelecting && dragSelectionStartIndex !== null) {
            if (e.cancelable) e.preventDefault();

            const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
            if (targetEl) {
                const card = targetEl.closest('.thumb-card');
                if (card) {
                    const index = getCardIndex(card);
                    if (index !== -1 && index !== touchStartIndex) {
                        const cards = Array.from($grid.querySelectorAll('.thumb-card'));
                        const start = Math.min(dragSelectionStartIndex, index);
                        const end = Math.max(dragSelectionStartIndex, index);

                        for (let i = start; i <= end; i++) {
                            const c = cards[i];
                            const id = c.dataset.photoId;
                            state.selectedSet.add(id);
                            c.classList.add('is-selected');
                        }
                        syncDateCheckboxes();
                        updateDownloadButton();
                    }
                }
            }
        }
    }, { passive: false });

    $grid.addEventListener('touchend', (e) => {
        if (!state.isTouch) return;

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = 0;
        }

        if (longPressedActive || isTouchSelecting) {
            if (e.cancelable) e.preventDefault();
        }

        isTouchSelecting = false;
        dragSelectionStartIndex = null;
        touchStartIndex = null;
        longPressedActive = false;
    }, { passive: false });

    if ($btnClearSelection) {
        $btnClearSelection.addEventListener('click', () => {
            clearSelection();
        });
    }
}
