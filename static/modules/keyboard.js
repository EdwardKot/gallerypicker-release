import { state } from './state.js';

export function initKeyboard(callbacks) {
    document.addEventListener('keydown', (e) => {
        // Don't capture keys when focused on inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (state.viewerActive) {
            // ── Viewer mode ──
            switch (e.code) {
                case 'ArrowLeft':
                    e.preventDefault();
                    callbacks.viewerPrev();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    callbacks.viewerNext();
                    break;
                case 'Digit1':
                case 'Numpad1':
                    e.preventDefault();
                    callbacks.viewerLike();
                    break;
                case 'Digit0':
                case 'Numpad0':
                    e.preventDefault();
                    callbacks.viewerUnlike();
                    break;
                case 'KeyD':
                    e.preventDefault();
                    callbacks.downloadCurrent();
                    break;
                case 'Escape':
                case 'Space':
                    e.preventDefault();
                    callbacks.viewerClose();
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
                    callbacks.navigateGrid(e.code);
                    break;
                case 'Space':
                    e.preventDefault();
                    if (state.focusedPhotoId) callbacks.openViewer(state.focusedPhotoId);
                    break;
                case 'Digit1':
                case 'Numpad1':
                    e.preventDefault();
                    if (state.focusedPhotoId) callbacks.gridLike(state.focusedPhotoId);
                    break;
                case 'Digit0':
                case 'Numpad0':
                    e.preventDefault();
                    if (state.focusedPhotoId) callbacks.gridUnlike(state.focusedPhotoId);
                    break;
            }
        }
    });
}
