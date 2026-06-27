import { state } from './state.js';
import { api, showToast } from './utils.js';

function updateLikedCache(photoId, liked) {
    if (liked) {
        state.likedSet.add(photoId);
        if (state.likedIdsCache !== null && !state.likedIdsCache.includes(photoId)) {
            state.likedIdsCache.push(photoId);
        }
        return;
    }

    state.likedSet.delete(photoId);
    if (state.likedIdsCache !== null) {
        const idx = state.likedIdsCache.indexOf(photoId);
        if (idx >= 0) state.likedIdsCache.splice(idx, 1);
    }
}

function updateGridCard(photoId, liked) {
    const $grid = document.getElementById('photo-grid');
    const card = $grid ? $grid.querySelector(`.thumb-card[data-photo-id="${photoId}"]`) : null;
    if (card) card.classList.toggle('is-liked', liked);
}

export function setPhotoLiked(photoId, liked, options = {}) {
    if (!photoId) return Promise.resolve();

    updateLikedCache(photoId, liked);
    updateGridCard(photoId, liked);

    if (options.updateViewer) {
        options.updateViewer(liked, !!options.animate);
    }
    if (options.toast) {
        showToast(options.toast);
    }

    const action = liked ? 'like' : 'unlike';
    return api(`/api/${action}/${photoId}`, { method: 'POST' }).catch(e => {
        console.error(`${action} failed`, e);
    });
}
