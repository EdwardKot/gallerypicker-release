import { state } from './state.js';
import { apiJson, buildFilteredPath, showToast, setLoading } from './utils.js';
import { setPhotoLiked } from './photoActions.js';
let onFocusChangeCallback = null;

export function setOnFocusChange(cb) {
    onFocusChangeCallback = cb;
}

export async function fetchCounts() {
    try {
        const data = await apiJson('/api/counts');
        state.counts = data;
        const $countAll = document.getElementById('count-all');
        const $countLiked = document.getElementById('count-liked');
        const $countSystemFavorite = document.getElementById('count-system-favorite');
        const $btnSystemFavorite = document.getElementById('btn-filter-system-favorite');
        
        if ($countAll) $countAll.textContent = data.total ?? 0;
        if ($countLiked) $countLiked.textContent = data.liked ?? 0;
        
        if ($btnSystemFavorite) {
            $btnSystemFavorite.style.display = data.has_system_favorites ? '' : 'none';
        }
        if ($countSystemFavorite) {
            $countSystemFavorite.textContent = data.system_favorite ?? 0;
        }
    } catch (e) {
        console.error('fetchCounts', e);
    }
}

export async function fetchPhotos(append) {
    if (state.isLoadingMore) return;

    const $grid = document.getElementById('photo-grid');
    const $empty = document.getElementById('empty-state');

    if (!append) {
        state.currentPage = 1;
        state.hasMorePages = true;
        if ($grid) $grid.innerHTML = '';
        state.photos = [];
        state.likedSet.clear();
        state.lastRenderedDate = null;
        if ($empty) $empty.style.display = 'none';
    }

    setLoading(true);
    state.isLoadingMore = true;

    try {
        const data = await apiJson(buildFilteredPath('/api/photos', {
            page: state.currentPage,
            page_size: state.pageSize,
        }));
        const newPhotos = data.photos ?? [];

        state.totalPhotos = data.total ?? 0;
        state.totalPages = data.total_pages ?? Math.ceil(state.totalPhotos / state.pageSize);
        state.hasMorePages = state.currentPage < state.totalPages;

        newPhotos.forEach(p => {
            if (p.liked) state.likedSet.add(p.photo_id);
        });

        if (append) {
            state.photos = state.photos.concat(newPhotos);
        } else {
            state.photos = newPhotos;
        }

        if (state.photos.length === 0) {
            if ($empty) $empty.style.display = '';
        } else {
            renderGrid(newPhotos);
            observeNewThumbnails();
        }
    } catch (e) {
        console.error('fetchPhotos', e);
        showToast('Failed to load photos');
    } finally {
        setLoading(false);
        state.isLoadingMore = false;
    }
}

export function loadMoreIfNeeded() {
    if (state.isLoadingMore || !state.hasMorePages || state.viewerActive) return;
    const scrollBottom = window.innerHeight + window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    if (docHeight - scrollBottom < 600) {
        state.currentPage++;
        fetchPhotos(true);
    }
}

function formatDate(mtime) {
    const d = new Date(mtime * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function syncDateCheckboxes() {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
    const dateHeaders = $grid.querySelectorAll('.date-header');
    dateHeaders.forEach(header => {
        const checkbox = header.querySelector('.date-checkbox');
        if (!checkbox) return;
        const date = checkbox.dataset.date;
        const cardsOfDate = Array.from($grid.querySelectorAll(`.thumb-card[data-date="${date}"]`));
        if (cardsOfDate.length === 0) {
            checkbox.checked = false;
            return;
        }
        const allSelected = cardsOfDate.every(card => state.selectedSet.has(card.dataset.photoId));
        checkbox.checked = allSelected;
    });
}

export function renderGrid(photosToRender) {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
    const frag = document.createDocumentFragment();
    photosToRender.forEach(photo => {
        const dateStr = formatDate(photo.mtime);
        if (dateStr !== state.lastRenderedDate) {
            state.lastRenderedDate = dateStr;
            const header = document.createElement('div');
            header.className = 'date-header';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'date-checkbox';
            checkbox.dataset.date = dateStr;
            checkbox.title = `Select/deselect all photos on ${dateStr}`;
            header.appendChild(checkbox);
            
            const dateText = document.createTextNode(dateStr);
            header.appendChild(dateText);
            
            frag.appendChild(header);
        }

        const isSelected = state.selectedSet.has(photo.photo_id);
        const isFocused = state.focusedPhotoId === photo.photo_id;
        const card = document.createElement('div');
        card.className = 'thumb-card' +
            (photo.liked ? ' is-liked' : '') +
            (isSelected ? ' is-selected' : '') +
            (isFocused ? ' is-focused' : '');
        card.dataset.photoId = photo.photo_id;
        card.dataset.date = dateStr;

        const placeholder = document.createElement('div');
        placeholder.className = 'thumb-placeholder';
        placeholder.textContent = '·';
        card.appendChild(placeholder);

        const img = document.createElement('img');
        img.dataset.src = `/api/thumbnail/${photo.photo_id}?size=200`;
        img.alt = photo.filename || '';
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
    syncDateCheckboxes();
}

const THUMB_CONCURRENCY = 4;
let thumbActive = 0;            // currently in-flight requests
const thumbQueue = [];          // pending { img, src } items

export function flushThumbQueue() {
    while (thumbActive < THUMB_CONCURRENCY && thumbQueue.length > 0) {
        const { img, card, src } = thumbQueue.shift();
        if (!img || !card.isConnected) {
            flushThumbQueue();
            return;
        }
        thumbActive++;
        img.onload = () => {
            img.style.display = '';
            const ph = card.querySelector('.thumb-placeholder');
            if (ph) ph.remove();
            thumbActive--;
            flushThumbQueue();
        };
        img.onerror = () => {
            const ph = card.querySelector('.thumb-placeholder');
            if (ph) ph.textContent = '⚠';
            console.error('Thumbnail load failed:', src);
            thumbActive--;
            flushThumbQueue();
        };
        img.src = src;
    }
}

let observer = null;

export function observeNewThumbnails() {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
    if (!observer) {
        observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const card = entry.target;
                    const img = card.querySelector('img');
                    if (img && img.dataset.src) {
                        const src = img.dataset.src;
                        delete img.dataset.src;
                        thumbQueue.push({ img, card, src });
                    }
                    observer.unobserve(card);
                });
                flushThumbQueue();
            },
            { rootMargin: '100px' }
        );
    }
    $grid.querySelectorAll('.thumb-card').forEach(c => {
        const img = c.querySelector('img');
        if (img && img.dataset.src) {
            observer.observe(c);
        }
    });
}

export function applyThumbSize() {
    document.documentElement.style.setProperty('--thumb-size', state.thumbSize + 'px');
}

export function setFilter(filter) {
    if (filter === state.currentFilter) return;
    state.currentFilter = filter;
    state.focusedPhotoId = null;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    fetchPhotos();
}

export function setSort(sort) {
    if (sort === state.currentSort) return;
    state.currentSort = sort;
    state.focusedPhotoId = null;
    fetchPhotos();
}

export function setFocusedCard(photoId) {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
    const oldFocused = $grid.querySelector('.thumb-card.is-focused');
    if (oldFocused) oldFocused.classList.remove('is-focused');

    state.focusedPhotoId = photoId;

    if (photoId) {
        const card = $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`);
        if (card) {
            card.classList.add('is-focused');
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            state.selectionAnchorId = photoId;
        }
    }
    if (onFocusChangeCallback) {
        onFocusChangeCallback();
    }
}

export function navigateGrid(direction) {
    const $grid = document.getElementById('photo-grid');
    if (!$grid) return;
    const cards = Array.from($grid.querySelectorAll('.thumb-card'));
    if (cards.length === 0) return;

    let currentIndex = state.focusedPhotoId
        ? cards.findIndex(c => c.dataset.photoId === state.focusedPhotoId)
        : -1;

    // If no focus yet, focus first card
    if (currentIndex === -1) {
        setFocusedCard(cards[0].dataset.photoId);
        return;
    }

    let newIndex = currentIndex;

    if (direction === 'ArrowRight') {
        newIndex = Math.min(currentIndex + 1, cards.length - 1);
    } else if (direction === 'ArrowLeft') {
        newIndex = Math.max(currentIndex - 1, 0);
    } else if (direction === 'ArrowDown' || direction === 'ArrowUp') {
        const currentCard = cards[currentIndex];
        const currentLeft = currentCard.offsetLeft;
        const currentTop = currentCard.offsetTop;

        // Group cards by offsetTop to find rows
        const rowTops = [];
        cards.forEach(c => {
            if (rowTops.length === 0 || rowTops[rowTops.length - 1] !== c.offsetTop) {
                rowTops.push(c.offsetTop);
            }
        });

        const currentRow = rowTops.indexOf(currentTop);
        const targetRow = direction === 'ArrowDown' ? currentRow + 1 : currentRow - 1;

        if (targetRow >= 0 && targetRow < rowTops.length) {
            const targetTop = rowTops[targetRow];
            // Find card in target row with closest offsetLeft
            const rowCards = cards.filter(c => c.offsetTop === targetTop);
            let bestCard = rowCards[0];
            let bestDist = Math.abs(rowCards[0].offsetLeft - currentLeft);
            for (let i = 1; i < rowCards.length; i++) {
                const dist = Math.abs(rowCards[i].offsetLeft - currentLeft);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestCard = rowCards[i];
                }
            }
            newIndex = cards.indexOf(bestCard);
        }
    }

    if (newIndex !== currentIndex) {
        setFocusedCard(cards[newIndex].dataset.photoId);
        // Trigger infinite scroll when nearing end
        if (newIndex > cards.length - 20 && state.hasMorePages) {
            loadMoreIfNeeded();
        }
    }
}

export function gridLike(photoId) {
    if (!photoId) return;
    setPhotoLiked(photoId, true, { toast: '♥ Liked' });
    fetchCounts();
}

export function gridUnlike(photoId) {
    if (!photoId) return;
    setPhotoLiked(photoId, false, { toast: '♡ Unliked' });
    fetchCounts();
}

export async function fetchFilters() {
    try {
        const data = await apiJson('/api/filters');
        const $filterFocalLength = document.getElementById('filter-focal-length');
        const $filterVendorTag = document.getElementById('filter-vendor-tag');

        if ($filterFocalLength) {
            $filterFocalLength.innerHTML = '<option value="">All focal lengths</option>';
            (data.focal_lengths || []).forEach(fl => {
                const opt = document.createElement('option');
                opt.value = fl;
                opt.textContent = `${fl}mm`;
                if (state.focalLength === fl) {
                    opt.selected = true;
                }
                $filterFocalLength.appendChild(opt);
            });
        }

        if ($filterVendorTag) {
            $filterVendorTag.innerHTML = '<option value="">All tags</option>';
            const tags = data.vendor_tags || [];
            if (tags.length > 0) {
                $filterVendorTag.style.display = '';
                
                // Group tags by group
                const groups = {};
                tags.forEach(t => {
                    if (!groups[t.group]) {
                        groups[t.group] = [];
                    }
                    groups[t.group].push(t);
                });

                Object.entries(groups).forEach(([groupName, groupTags]) => {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = groupName;
                    groupTags.forEach(t => {
                        const opt = document.createElement('option');
                        opt.value = t.tag;
                        opt.textContent = `${t.label} (${t.count})`;
                        if (state.vendorTag === t.tag) {
                            opt.selected = true;
                        }
                        optgroup.appendChild(opt);
                    });
                    $filterVendorTag.appendChild(optgroup);
                });
            } else {
                $filterVendorTag.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('fetchFilters', e);
    }
}

export function initGrid() {
    // 1. Bind .filter-btn click → setFilter(btn.dataset.filter)
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    // 2. Bind #sort-select change → setSort(select.value)
    const $sortSelect = document.getElementById('sort-select');
    if ($sortSelect) {
        $sortSelect.addEventListener('change', () => setSort($sortSelect.value));
    }

    // 3. Bind #filter-focal-length change
    const $filterFocalLength = document.getElementById('filter-focal-length');
    if ($filterFocalLength) {
        $filterFocalLength.addEventListener('change', () => {
            const val = $filterFocalLength.value;
            state.focalLength = val ? parseInt(val, 10) : null;
            state.focusedPhotoId = null;
            fetchPhotos();
        });
    }

    // 4. Bind #filter-vendor-tag changes
    const $filterVendorTag = document.getElementById('filter-vendor-tag');

    if ($filterVendorTag) {
        $filterVendorTag.addEventListener('change', () => {
            const val = $filterVendorTag.value;
            state.vendorTag = val !== '' ? val : null;
            state.focusedPhotoId = null;
            fetchPhotos();
        });
    }

    // 5. Bind window scroll → loadMoreIfNeeded (passive)
    window.addEventListener('scroll', loadMoreIfNeeded, { passive: true });

    // 6. Set $thumbSlider.value = state.thumbSize and bind input → applyThumbSize()
    const $thumbSlider = document.getElementById('thumb-size-slider');
    if ($thumbSlider) {
        $thumbSlider.value = state.thumbSize;
        $thumbSlider.addEventListener('input', (e) => {
            state.thumbSize = parseInt(e.target.value, 10);
            applyThumbSize();
        });
    }
}
