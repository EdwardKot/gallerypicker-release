import { state } from './state.js';

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
        if (pinSuccessCallback) {
            pinSuccessCallback();
        }
    }

    btn.onclick = attempt;
    input.onkeydown = e => { if (e.key === 'Enter') attempt(); };
}
