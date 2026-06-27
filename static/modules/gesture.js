let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let lastTapTime = 0;
let isSwiping = false;
let swipeDirection = '';

function resetSwipeStyles(viewer, img, topBar, bottomBar, closeBtn) {
    img.style.transform = '';
    viewer.style.backgroundColor = '';
    if (topBar) topBar.style.opacity = '';
    if (bottomBar) bottomBar.style.opacity = '';
    if (closeBtn) closeBtn.style.opacity = '';
}

export function attachViewerGestures(container, img, viewer, callbacks) {
    const topBar = viewer.querySelector('.viewer-top-bar');
    const bottomBar = viewer.querySelector('.viewer-bottom-bar');
    const closeBtn = viewer.querySelector('.viewer-close-btn');

    container.addEventListener('touchstart', (e) => {
        if (!callbacks.isTouch()) return;
        if (e.touches.length !== 1) return;

        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        isSwiping = true;
        swipeDirection = '';

        img.style.transition = '';
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!callbacks.isTouch() || !isSwiping) return;
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;

        if (!swipeDirection) {
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                swipeDirection = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
            }
        }

        if (swipeDirection === 'vertical') {
            if (dy > 0) {
                if (e.cancelable) e.preventDefault();
                const scale = Math.max(0.7, 1 - dy / 1000);
                img.style.transform = `translate3d(0, ${dy}px, 0) scale(${scale})`;

                viewer.style.backgroundColor = `rgba(0, 0, 0, ${Math.max(0.15, 1 - dy / 400)})`;
                if (topBar) topBar.style.opacity = Math.max(0, 1 - dy / 150);
                if (bottomBar) bottomBar.style.opacity = Math.max(0, 1 - dy / 150);
                if (closeBtn) closeBtn.style.opacity = Math.max(0, 1 - dy / 150);
            }
        } else if (swipeDirection === 'horizontal') {
            if (e.cancelable) e.preventDefault();
            img.style.transform = `translate3d(${dx}px, 0, 0)`;
        }
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
        if (!callbacks.isTouch()) return;

        const dt = Date.now() - touchStartTime;
        isSwiping = false;

        img.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';

        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        const isTap = Math.sqrt(dx * dx + dy * dy) < 8 && dt < 250;
        if (isTap) {
            const now = Date.now();
            if (now - lastTapTime < 300) {
                callbacks.onDoubleTap();
                lastTapTime = 0;
            } else {
                lastTapTime = now;
            }
        }

        if (swipeDirection === 'vertical') {
            if (dy > 120) {
                callbacks.onSwipeDown();
                resetSwipeStyles(viewer, img, topBar, bottomBar, closeBtn);
                img.style.transition = '';
            } else {
                resetSwipeStyles(viewer, img, topBar, bottomBar, closeBtn);
                setTimeout(() => { img.style.transition = ''; }, 250);
            }
        } else if (swipeDirection === 'horizontal') {
            if (Math.abs(dx) > 60) {
                if (dx > 0) {
                    callbacks.onSwipeRight();
                } else {
                    callbacks.onSwipeLeft();
                }
            }
            img.style.transform = '';
            setTimeout(() => { img.style.transition = ''; }, 250);
        }

        swipeDirection = '';
    }, { passive: false });
}
