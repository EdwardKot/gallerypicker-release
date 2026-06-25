import { state, showToast, apiJson } from './state.js';

let downloadAbort = null;
let downloadProgressTimer = null;
let updateBtnCallback = null;

export function isDownloading() {
    return !!downloadAbort;
}

export function cancelDownload() {
    if (downloadAbort) {
        downloadAbort.abort();
    }
}

export function downloadWithAnchor(id, filename) {
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
export function downloadSingleFile(id) {
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

export function getUniqueFilename(name, existingNames) {
    if (!existingNames.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.substring(0, dot) : name;
    const ext = dot > 0 ? name.substring(dot) : '';
    let i = 1;
    while (existingNames.has(`${base}_${i}${ext}`)) i++;
    return `${base}_${i}${ext}`;
}

export function showDownloadProgress(total) {
    if (downloadProgressTimer) clearTimeout(downloadProgressTimer);
    
    const $downloadCurrent = document.getElementById('download-current');
    const $downloadTotal = document.getElementById('download-total');
    const $downloadFilename = document.getElementById('download-filename');
    const $downloadProgressFill = document.getElementById('download-progress-fill');
    const $downloadTitleText = document.getElementById('download-title-text');
    const $downloadCancel = document.getElementById('download-cancel');
    const $downloadDismiss = document.getElementById('download-dismiss');
    const $downloadPanel = document.getElementById('download-panel');

    $downloadCurrent.textContent = '0';
    $downloadTotal.textContent = String(total);
    $downloadFilename.textContent = '';
    $downloadProgressFill.style.width = '0%';
    if ($downloadTitleText) $downloadTitleText.textContent = 'Downloading…';
    if ($downloadCancel) $downloadCancel.style.display = '';
    if ($downloadDismiss) $downloadDismiss.style.display = 'none';
    if ($downloadPanel) $downloadPanel.style.display = 'block';
}

export function updateDownloadProgress(current, total, filename) {
    const $downloadCurrent = document.getElementById('download-current');
    const $downloadFilename = document.getElementById('download-filename');
    const $downloadProgressFill = document.getElementById('download-progress-fill');

    $downloadCurrent.textContent = String(current);
    $downloadFilename.textContent = filename;
    $downloadProgressFill.style.width = `${((current) / total * 100).toFixed(1)}%`;
}

export function hideDownloadProgress() {
    if (downloadProgressTimer) clearTimeout(downloadProgressTimer);
    const $downloadPanel = document.getElementById('download-panel');
    if ($downloadPanel) $downloadPanel.style.display = 'none';
}

export function setDownloadFinishedState(status) {
    const $downloadCancel = document.getElementById('download-cancel');
    const $downloadDismiss = document.getElementById('download-dismiss');
    const $downloadTitleText = document.getElementById('download-title-text');

    if ($downloadCancel) $downloadCancel.style.display = 'none';
    if ($downloadDismiss) $downloadDismiss.style.display = 'block';
    
    if (status === 'Complete') {
        if ($downloadTitleText) $downloadTitleText.textContent = 'Download Complete';
        if (downloadProgressTimer) clearTimeout(downloadProgressTimer);
        downloadProgressTimer = setTimeout(() => {
            hideDownloadProgress();
        }, 3000);
    } else if (status === 'Cancelled') {
        if ($downloadTitleText) $downloadTitleText.textContent = 'Download Cancelled';
    } else {
        if ($downloadTitleText) $downloadTitleText.textContent = 'Download Failed';
    }
}

export async function downloadBulkWithFSAccess(dirHandle, ids) {
    const abort = new AbortController();
    downloadAbort = abort;
    if (updateBtnCallback) updateBtnCallback();

    showDownloadProgress(ids.length);

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

    downloadAbort = null;
    if (updateBtnCallback) updateBtnCallback();

    if (abort.signal.aborted) {
        showToast(`Download cancelled (${completed - failed}/${ids.length} saved)`);
        setDownloadFinishedState('Cancelled');
    } else if (failed > 0) {
        showToast(`Downloaded ${completed - failed}/${ids.length} (${failed} failed)`, 4000);
        setDownloadFinishedState('Failed');
    } else {
        showToast(`Downloaded ${ids.length} photos ✓`);
        setDownloadFinishedState('Complete');
    }
}

export async function downloadBulkSync(ids) {
    if (ids.length === 0) {
        showToast('No photos to download');
        return;
    }

    const abort = new AbortController();
    downloadAbort = abort;
    if (updateBtnCallback) updateBtnCallback();

    showDownloadProgress(ids.length);

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

    downloadAbort = null;
    if (updateBtnCallback) updateBtnCallback();

    if (abort.signal.aborted) {
        showToast(`Download cancelled (${completed - failed}/${ids.length} saved)`);
        setDownloadFinishedState('Cancelled');
    } else if (failed > 0) {
        showToast(`Downloaded ${completed - failed}/${ids.length} (${failed} failed)`, 4000);
        setDownloadFinishedState('Failed');
    } else {
        showToast(`Downloaded ${ids.length} photos ✓`);
        setDownloadFinishedState('Complete');
    }
}

export async function fetchLikedIds() {
    const data = await apiJson('/api/photos?filter=liked&page_size=10000');
    return (data.photos || []).map(p => p.photo_id);
}

// 预缓存 liked IDs，供同步下载使用
export async function refreshLikedIdsCache() {
    try {
        const data = await apiJson('/api/photos?filter=liked&page_size=10000');
        state.likedIdsCache = (data.photos || []).map(p => p.photo_id);
    } catch (e) {
        console.error('refreshLikedIdsCache', e);
    }
}

export function initDownloadPanel({ onDownload, clearSelection, updateDownloadButton }) {
    updateBtnCallback = updateDownloadButton;

    const $downloadCancel = document.getElementById('download-cancel');
    const $downloadDismiss = document.getElementById('download-dismiss');
    const $floatingDownloadBtn = document.getElementById('floating-download-btn');
    const $floatingCancelBtn = document.getElementById('floating-cancel-btn');

    if ($downloadCancel) {
        $downloadCancel.addEventListener('click', () => {
            cancelDownload();
        });
    }
    if ($downloadDismiss) {
        $downloadDismiss.addEventListener('click', () => {
            hideDownloadProgress();
        });
    }
    if ($floatingDownloadBtn) {
        $floatingDownloadBtn.addEventListener('click', () => {
            if (isDownloading()) return; // Prevent double trigger
            onDownload();
        });
    }
    if ($floatingCancelBtn) {
        $floatingCancelBtn.addEventListener('click', () => {
            clearSelection();
        });
    }
}
