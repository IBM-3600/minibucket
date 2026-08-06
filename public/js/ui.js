export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
};

export const fmtDate = (iso) => iso ? new Date(iso).toLocaleString() : '—';

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = 'info', ms = 3500) {
  const root = document.getElementById('toasts');
  const t = el('div', { class: `toast ${kind}` }, msg);
  root.append(t);
  setTimeout(() => t.remove(), ms);
}

export function modal({ title, body, actions }) {
  const root = document.getElementById('modal-root');
  const close = () => backdrop.remove();
  const head = el('div', { class: 'modal-head' },
    el('h3', {}, title),
    el('button', { class: 'icon-btn', onclick: close }, '✕'));
  const m = el('div', { class: 'modal' }, head, el('div', { class: 'modal-body' }, body));
  if (actions) m.append(el('div', { class: 'modal-body', style: 'display:flex;gap:.6rem;justify-content:flex-end' }, ...actions(close)));
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, m);
  root.append(backdrop);
  return close;
}

export function confirmDialog(message, { danger = true } = {}) {
  return new Promise(resolve => {
    const body = el('p', {}, message);
    const close = modal({
      title: 'Confirm', body,
      actions: (closeFn) => [
        el('button', { class: 'btn', onclick: () => { closeFn(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { closeFn(); resolve(true); } }, 'Confirm')
      ]
    });
    void close;
  });
}

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label, 'success', 1800); }
  catch { toast('Clipboard blocked by browser', 'error'); }
}

export function contextMenu(x, y, items) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = el('div', { class: 'ctx-menu' });
  for (const item of items) {
    menu.append(el('button', {
      class: item.danger ? 'danger' : '',
      onclick: () => { menu.remove(); item.fn(); }
    }, item.label));
  }
  menu.style.left = `${Math.min(x, window.innerWidth - 210)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 36 - 20)}px`;
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

export function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}