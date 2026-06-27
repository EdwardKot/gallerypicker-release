import { state } from './state.js';
import { apiJson, showToast } from './utils.js';
import { fetchCounts, fetchFilters, fetchPhotos } from './grid.js';

let ptrStartY = 0;
let ptrPulling = false;
const PTR_THRESHOLD = 70;
let onRefreshCallback = null;
let currentResponsiveLayout = null;

export function openSettings() {
    const $drawerOverlay = document.getElementById('mobile-drawer-overlay');
    const $settingsOverlay = document.getElementById('settings-overlay');
    if ($drawerOverlay) $drawerOverlay.style.display = 'none';
    if ($settingsOverlay) $settingsOverlay.style.display = '';
    refreshCacheStats();
}

export function closeSettings() {
    const $settingsOverlay = document.getElementById('settings-overlay');
    if ($settingsOverlay) $settingsOverlay.style.display = 'none';
}

export async function refreshCacheStats() {
    const $settingsCacheCount = document.getElementById('settings-cache-count');
    const $settingsCacheSize = document.getElementById('settings-cache-size');
    try {
        const stats = await apiJson('/api/cache/stats');
        if ($settingsCacheCount) $settingsCacheCount.textContent = stats.file_count ?? '—';
        if ($settingsCacheSize) $settingsCacheSize.textContent = stats.total_size_human ?? '—';
    } catch (e) {
        if ($settingsCacheCount) $settingsCacheCount.textContent = 'Error';
        if ($settingsCacheSize) $settingsCacheSize.textContent = 'Error';
    }
}

export function relocateDOM(force = false) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const nextLayout = isMobile ? 'mobile' : 'desktop';
    if (!force && currentResponsiveLayout === nextLayout) return;
    currentResponsiveLayout = nextLayout;

    const $drawerExif = document.getElementById('drawer-exif-container');
    const $drawerSize = document.getElementById('drawer-size-container');
    const $drawerActions = document.getElementById('drawer-actions-container');

    if (isMobile) {
        if ($drawerExif) {
            const focalLength = document.getElementById('filter-focal-length');
            const portrait = document.getElementById('filter-portrait');
            if (focalLength) $drawerExif.appendChild(focalLength);
            if (portrait) $drawerExif.appendChild(portrait);
        }
        if ($drawerSize) {
            const sizeControl = document.querySelector('.thumb-size-control');
            if (sizeControl) $drawerSize.appendChild(sizeControl);
        }
        if ($drawerActions) {
            const settings = document.getElementById('btn-settings');
            const rescan = document.getElementById('btn-rescan');
            if (settings) $drawerActions.appendChild(settings);
            if (rescan) $drawerActions.appendChild(rescan);
        }
    } else {
        const headerCenter = document.querySelector('.exif-filters');
        if (headerCenter) {
            const focalLength = document.getElementById('filter-focal-length');
            const portrait = document.getElementById('filter-portrait');
            if (focalLength) headerCenter.appendChild(focalLength);
            if (portrait) headerCenter.appendChild(portrait);
        }
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            const settings = document.getElementById('btn-settings');
            const rescan = document.getElementById('btn-rescan');
            const clearBtn = document.getElementById('btn-clear-selection');
            const sizeControl = document.querySelector('.thumb-size-control');

            if (settings) headerRight.insertBefore(settings, clearBtn);
            if (rescan) headerRight.insertBefore(rescan, clearBtn);
            if (sizeControl) headerRight.appendChild(sizeControl);
        }
    }
}

function handleTouchStart(e) {
    if (!state.isTouch || window.scrollY > 0 || state.viewerActive) return;
    ptrStartY = e.touches[0].pageY;
    ptrPulling = true;
}

function handleTouchMove(e) {
    if (!ptrPulling) return;
    const currentY = e.touches[0].pageY;
    const diffY = currentY - ptrStartY;

    const $gallery = document.getElementById('gallery');
    const $ptr = document.getElementById('pull-to-refresh');

    if (diffY > 0) {
        // Apply rubber-band effect
        const y = Math.pow(diffY, 0.82);
        if (y > 0) {
            // Prevent default scrolling so Safari bounce doesn't compete
            if (e.cancelable) e.preventDefault();
            
            if ($gallery) {
                $gallery.style.transition = 'none';
                $gallery.style.transform = `translateY(${y}px)`;
            }

            if ($ptr) {
                $ptr.style.opacity = '1';
                $ptr.classList.add('ptr-pulling');
                if (y >= PTR_THRESHOLD) {
                    $ptr.classList.add('ptr-release');
                    $ptr.querySelector('.ptr-text').textContent = '释放以刷新';
                } else {
                    $ptr.classList.remove('ptr-release');
                    $ptr.querySelector('.ptr-text').textContent = '下拉刷新';
                }
            }
        }
    } else {
        // If dragging upwards, cancel pulling
        ptrPulling = false;
        if ($gallery) {
            $gallery.style.transition = 'transform 0.2s ease';
            $gallery.style.transform = 'translateY(0)';
        }
        if ($ptr) {
            $ptr.classList.remove('ptr-pulling');
            $ptr.style.opacity = '0';
        }
    }
}

async function handleTouchEnd() {
    if (!ptrPulling) return;
    ptrPulling = false;

    const $gallery = document.getElementById('gallery');
    const $ptr = document.getElementById('pull-to-refresh');
    if (!$gallery) return;

    // Retrieve current transform value
    const transform = $gallery.style.transform;
    const match = transform.match(/translateY\((\d+\.?\d*)px\)/);
    const y = match ? parseFloat(match[1]) : 0;

    $gallery.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

    if (y >= PTR_THRESHOLD) {
        $gallery.style.transform = `translateY(${PTR_THRESHOLD}px)`;
        if ($ptr) {
            $ptr.classList.remove('ptr-release');
            $ptr.classList.add('ptr-refreshing');
            $ptr.querySelector('.ptr-text').textContent = '正在刷新...';
        }

        try {
            if (onRefreshCallback) {
                await onRefreshCallback();
            }
        } catch (e) {
            console.error('Pull to refresh rescan failed', e);
            showToast('刷新失败，请重试');
        } finally {
            $gallery.style.transform = 'translateY(0)';
            if ($ptr) {
                $ptr.classList.remove('ptr-refreshing');
                $ptr.classList.remove('ptr-pulling');
                setTimeout(() => {
                    $ptr.style.opacity = '0';
                }, 300);
            }
        }
    } else {
        $gallery.style.transform = 'translateY(0)';
        if ($ptr) {
            $ptr.classList.remove('ptr-pulling');
            $ptr.style.opacity = '0';
        }
    }
}

export function initUI({ onRescan, onRefresh }) {
    onRefreshCallback = onRefresh;

    const $btnSettings = document.getElementById('btn-settings');
    const $settingsClose = document.getElementById('settings-close');
    const $settingsOverlay = document.getElementById('settings-overlay');
    const $settingsClearCache = document.getElementById('settings-clear-cache');
    const $settingsPreviewSize = document.getElementById('settings-preview-size');
    const $btnMore = document.getElementById('btn-more');
    const $drawerOverlay = document.getElementById('mobile-drawer-overlay');
    const $drawerClose = document.getElementById('mobile-drawer-close');
    const $btnRescan = document.getElementById('btn-rescan');

    if ($btnSettings) $btnSettings.addEventListener('click', openSettings);
    if ($settingsClose) $settingsClose.addEventListener('click', closeSettings);
    if ($settingsOverlay) {
        $settingsOverlay.addEventListener('click', (e) => {
            if (e.target === $settingsOverlay) closeSettings();
        });
    }

    if ($settingsClearCache) {
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
    }

    if ($settingsPreviewSize) {
        $settingsPreviewSize.addEventListener('change', () => {
            const val = parseInt($settingsPreviewSize.value, 10);
            state.previewSize = val;
            localStorage.setItem('viewerPreviewSize', val.toString());
            showToast('Preview size saved');
        });
    }

    if ($btnMore) {
        $btnMore.addEventListener('click', () => {
            if ($drawerOverlay) $drawerOverlay.style.display = 'flex';
        });
    }

    if ($drawerClose) {
        $drawerClose.addEventListener('click', () => {
            if ($drawerOverlay) $drawerOverlay.style.display = 'none';
        });
    }

    if ($drawerOverlay) {
        $drawerOverlay.addEventListener('click', (e) => {
            if (e.target === $drawerOverlay) $drawerOverlay.style.display = 'none';
        });
    }

    if ($btnRescan) {
        $btnRescan.addEventListener('click', onRescan);
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    relocateDOM(true);
    const layoutQuery = window.matchMedia('(max-width: 768px)');
    const handleLayoutChange = () => relocateDOM(true);
    if (layoutQuery.addEventListener) {
        layoutQuery.addEventListener('change', handleLayoutChange);
    } else {
        layoutQuery.addListener(handleLayoutChange);
    }
}
