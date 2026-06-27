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
    vendorTag: null,        // active vendor tag filter (string or null)
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
