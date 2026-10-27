// Modal dialogs and toasts.
import { esc } from './format.js';

const layer = () => document.getElementById('modalLayer');
let onCloseCb = null;
export const modalOpen = () => !layer().hidden;

export function showModal({ title, eyebrow, html, buttons = [], wide = false, onClose = null, dismissable = true }) {
  const L = layer(), box = document.getElementById('modal');
  onCloseCb = onClose;
  box.className = 'modal' + (wide ? ' wide' : '');
  box.innerHTML = `${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}${title ? `<h2>${esc(title)}</h2>` : ''}<div class="mbody">${html || ''}</div>
    ${buttons.length ? `<div class="btns mbtns">${buttons.map((b, i) => `<button data-mb="${i}" class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" ${b.disabled ? 'disabled' : ''}>${b.label}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</button>`).join('')}</div>` : ''}`;
  box.querySelectorAll('[data-mb]').forEach(el => el.onclick = () => { const b = buttons[+el.dataset.mb]; const keep = b.onClick ? b.onClick() : false; if (keep !== true) closeModal(); });
  L.hidden = false; L.dataset.dismiss = dismissable ? '1' : '';
  const first = box.querySelector('input,button.primary,button'); if (first) setTimeout(() => first.focus(), 0);
  return box;
}
export function closeModal() {
  const L = layer(); if (L.hidden) return; L.hidden = true; document.getElementById('modal').innerHTML = '';
  const cb = onCloseCb; onCloseCb = null; if (cb) cb();
}
export function initModalLayer() {
  layer().addEventListener('mousedown', e => { if (e.target === layer() && layer().dataset.dismiss) closeModal(); });
}

export function toast(lab, title, sub, kind) {
  const box = document.getElementById('toasts'), t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = `<span class="eyebrow">${esc(lab)}</span><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  box.appendChild(t); while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 4200);
}
