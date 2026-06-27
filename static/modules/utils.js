import { state } from './state.js';
import { getPin, showPinDialog } from './auth.js';

export function buildPath(path, params = {}) {
    const [base, queryString = ''] = path.split('?');
    const query = new URLSearchParams(queryString);

    Object.entries(params).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return;
        query.set(key, String(value));
    });

    const serialized = query.toString();
    return serialized ? `${base}?${serialized}` : base;
}

export function buildFilteredPath(path, params = {}) {
    return buildPath(path, {
        filter: state.currentFilter,
        sort: state.currentSort,
        focal_length: state.focalLength,
        vendor_tag: state.vendorTag,
        ...params,
    });
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
