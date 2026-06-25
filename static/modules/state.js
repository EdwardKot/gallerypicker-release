export const state = {
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
    focalLength: null,      // active focal length filter (integer or null)
    portraitMode: null,     // active xiaomi portrait filter (integer or null)
    unauthorized: false,
    isTouch: (function () {
        if (typeof window === 'undefined') return false;
        const ua = window.navigator.userAgent;
        const isMobileUA = /iPad|iPhone|iPod|Android/.test(ua);
        const isMacIntel = window.navigator.platform === 'MacIntel';
        const hasTouchPoints = window.navigator.maxTouchPoints && window.navigator.maxTouchPoints > 1;
        return isMobileUA || (isMacIntel && !!hasTouchPoints);
    })(),
};

const PIN_KEY = 'gallery_pin';

export function getPin() {
    return localStorage.getItem(PIN_KEY) || '';
}

export function savePin(pin) {
    localStorage.setItem(PIN_KEY, pin);
    // Also set as cookie so <img src> requests (which bypass api()) carry the PIN automatically
    document.cookie = `gallery_pin=${pin}; path=/; SameSite=Strict`;
}

let pinSuccessCallback = null;
export function setPinSuccessCallback(cb) {
    pinSuccessCallback = cb;
}

export function showPinDialog(errorMsg) {
    const overlay = document.getElementById('pin-overlay');
    const input = document.getElementById('pin-input');
    const err = document.getElementById('pin-error');
    const btn = document.getElementById('pin-submit');

    err.textContent = errorMsg || '';
    overlay.style.display = 'flex';
    input.value = '';
    input.focus();

    function attempt() {
        const pin = input.value.trim();
        if (!pin) return;
        savePin(pin);
        state.unauthorized = false;
        overlay.style.display = 'none';
        // retry initialisation
        if (pinSuccessCallback) {
            pinSuccessCallback();
        }
    }

    btn.onclick = attempt;
    input.onkeydown = e => { if (e.key === 'Enter') attempt(); };
}

export function api(path, opts = {}) {
    if (state.unauthorized) {
        return Promise.reject(new Error('Unauthorized'));
    }
    const method = (opts.method || 'GET').toUpperCase();
    let finalPath = path;
    if (method === 'GET') {
        const separator = path.includes('?') ? '&' : '?';
        finalPath = `${path}${separator}_=${Date.now()}`;
    }
    opts.headers = Object.assign({}, opts.headers, {
        'X-Gallery-Pin': getPin(),
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    });
    return fetch(finalPath, opts).then(r => {
        if (r.status === 401) {
            state.unauthorized = true;
            showPinDialog('密钥错误，请重试');
            throw new Error('Unauthorized');
        }
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r;
    });
}

export function apiJson(path, opts) {
    return api(path, opts).then(r => r.json());
}

let toastTimer = null;
export function showToast(msg, duration = 2500) {
    const $toast = document.getElementById('toast');
    $toast.textContent = msg;
    $toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('visible'), duration);
}

export function setLoading(on) {
    const $loading = document.getElementById('loading');
    $loading.classList.toggle('visible', on);
}
