import {
    state, getPin, savePin, showToast, setLoading,
    setPinSuccessCallback, apiJson, showPinDialog
} from './modules/state.js';

import {
    initGrid, fetchCounts, fetchFilters, fetchPhotos,
    applyThumbSize, navigateGrid, gridLike, gridUnlike, setOnFocusChange
} from './modules/grid.js';

import {
    initViewer, openViewer, closeViewer, viewerPrev,
    viewerNext, viewerLike, viewerUnlike
} from './modules/viewer.js';

import {
    initSelection, clearSelection, updateDownloadButton
} from './modules/selection.js';

import {
    initDownloadPanel, downloadSingleFile, refreshLikedIdsCache,
    downloadBulkWithFSAccess, downloadBulkSync
} from './modules/download.js';

import { initUI } from './modules/ui.js';
import { initKeyboard } from './modules/keyboard.js';

async function initApp() {
    if (state.isTouch) document.body.classList.add('is-touch');
    applyThumbSize();

    const $settingsPreviewSize = document.getElementById('settings-preview-size');
    if ($settingsPreviewSize) {
        $settingsPreviewSize.value = state.previewSize === 0 ? '0' : String(state.previewSize);
    }

    if (!getPin()) {
        showPinDialog();
        return;
    }
    savePin(getPin());

    setLoading(true);
    try {
        await fetchCounts();
        await fetchFilters();
        await fetchPhotos();
        await refreshLikedIdsCache();
    } catch (e) {
        if (e.message !== 'Unauthorized') {
            console.error('initApp', e);
            showToast('Failed to initialize');
        }
    }
}

async function downloadDispatch() {
    let ids;
    if (state.selectedSet.size > 0) {
        ids = Array.from(state.selectedSet);
    } else if (state.focusedPhotoId) {
        ids = [state.focusedPhotoId];
    } else {
        if (state.likedIdsCache && state.likedIdsCache.length > 0) {
            ids = state.likedIdsCache;
        } else {
            showToast('No photos selected or liked');
            return;
        }
    }
    if (window.showDirectoryPicker) {
        let dirHandle;
        try {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('showDirectoryPicker', e);
        }
        if (dirHandle) {
            clearSelection();
            await downloadBulkWithFSAccess(dirHandle, ids);
            return;
        }
    }
    clearSelection();
    downloadBulkSync(ids);
}

// Set callback before any potential showPinDialog invocation
setPinSuccessCallback(initApp);

// Initialize all modules
initGrid();
setOnFocusChange(updateDownloadButton);

initViewer({ downloadSingle: downloadSingleFile });

initSelection({ openViewer });

initDownloadPanel({
    onDownload: downloadDispatch,
    clearSelection,
    updateDownloadButton,
});

initKeyboard({
    viewerPrev,
    viewerNext,
    viewerLike,
    viewerUnlike,
    viewerClose: closeViewer,
    downloadCurrent: () => {
        if (state.viewerPhotoId) downloadSingleFile(state.viewerPhotoId);
    },
    gridLike,
    gridUnlike,
    openViewer,
    navigateGrid,
});

initUI({
    onRescan: async () => {
        const $btnRescan = document.getElementById('btn-rescan');
        if ($btnRescan) $btnRescan.disabled = true;
        showToast('Rescanning…');
        try {
            const data = await apiJson('/api/rescan', { method: 'POST' });
            const count = data.scanned ?? data.total_in_db ?? '?';
            showToast(`Rescan complete: ${count} photos`);
            await fetchCounts();
            await fetchFilters();
            await fetchPhotos();
        } catch (e) {
            showToast('Rescan failed');
            console.error('rescan', e);
        } finally {
            if ($btnRescan) $btnRescan.disabled = false;
        }
    },
    onRefresh: async () => {
        await apiJson('/api/rescan', { method: 'POST' });
        await fetchCounts();
        await fetchFilters();
        await fetchPhotos();
        showToast('扫描完成，图库已更新 ✓');
    },
});

// Run app initialization
initApp();

// Bind the header download button
const $btnDownload = document.getElementById('btn-download-liked');
if ($btnDownload) {
    $btnDownload.addEventListener('click', downloadDispatch);
}
