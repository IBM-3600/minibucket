import { el, fmtBytes, timeAgo, esc, copyText, contextMenu, toast } from './ui.js';
import { api } from './api.js';
import { state } from './state.js';
import { categoryIcon } from './icons.js';
import { openPreview } from './preview.js';

export function thumbStyle(rec) {
  if (rec.thumbnail) return `background-image:url('${rec.thumbnail}')`;
  if (rec.category === 'images') return `background-image:url('${rec.publicUrl}')`;
  return '';
}

export function assetActions(rec, onChanged) {
  const origin = location.origin;
  return [
    { label: '👁 Preview', fn: () => openPreview(rec) },
    { label: '📋 Copy CDN URL', fn: () => copyText(`${origin}${rec.publicUrl}`) },
    { label: '📋 Copy Markdown', fn: () => copyText(`![${rec.originalName}](${origin}${rec.publicUrl})`) },
    { label: '📋 Copy HTML', fn: () => copyText(`<img src="${origin}${rec.publicUrl}" alt="${esc(rec.originalName)}">`) },
    { label: '📋 Copy API URL', fn: () => copyText(`${origin}/api/v1/assets/${rec.id}`) },
    { label: '✏️ Rename', fn: async () => {
        const name = prompt('Display name:', rec.originalName);
        if (name) { await api.patch(`/api/v1/assets/${rec.id}`, { originalName: name }); toast('Renamed', 'success'); onChanged?.(); }
      } },
    { label: '🏷 Edit tags', fn: async () => {
        const tags = prompt('Tags (comma separated):', rec.tags.join(', '));
        if (tags !== null) { await api.patch(`/api/v1/assets/${rec.id}`, { tags: tags.split(',').map(t => t.trim()).filter(Boolean) }); toast('Tags updated', 'success'); onChanged?.(); }
      } },
    { label: '⬇ Download', fn: () => window.open(rec.publicUrl, '_blank') },
    { label: '🗑 Delete', danger: true, fn: async () => {
        await api.del(`/api/v1/assets/${rec.id}`); toast('Moved to trash', 'success'); onChanged?.();
      } }
  ];
}

export function renderGrid(container, items, { onChanged } = {}) {
  const grid = el('div', { class: 'grid' });
  for (const rec of items) {
    const selected = state.selection.has(rec.id);
    const card = el('div', { class: `card ${selected ? 'selected' : ''}` },
      el('input', { type: 'checkbox', class: 'check', ...(selected ? { checked: true } : {}), onclick: (e) => {
        e.stopPropagation();
        e.target.checked ? state.selection.add(rec.id) : state.selection.delete(rec.id);
        card.classList.toggle('selected', e.target.checked);
        window.dispatchEvent(new CustomEvent('mb:selection'));
      } }),
      el('button', { class: 'menu-btn', onclick: (e) => {
        e.stopPropagation();
        contextMenu(e.clientX, e.clientY, assetActions(rec, onChanged));
      } }, '⋯'),
      el('div', { class: 'thumb', style: thumbStyle(rec) }, categoryIcon(rec.category)),
      el('div', { class: 'meta' },
        el('div', { class: 'name', title: rec.originalName }, rec.originalName),
        el('div', { class: 'sub' },
          el('span', {}, fmtBytes(rec.sizeBytes)),
          el('span', {}, timeAgo(rec.uploadedAt))))
    );
    card.addEventListener('click', () => openPreview(rec));
    grid.append(card);
  }
  container.append(grid);
}

export function renderList(container, items, { onChanged } = {}) {
  const table = el('table', { class: 'list-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, ''), el('th', {}, 'Name'), el('th', {}, 'Category'),
    el('th', {}, 'Size'), el('th', {}, 'Uploaded'), el('th', {}, '⬇'), el('th', {}, 'Tags'))));
  const tbody = el('tbody', {});
  for (const rec of items) {
    const row = el('tr', {},
      el('td', { class: 'thumb-cell' }, el('div', { style: thumbStyle(rec) }, categoryIcon(rec.category))),
      el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openPreview(rec); } }, rec.originalName)),
      el('td', {}, el('span', { class: `badge cat-${rec.category}` }, rec.category)),
      el('td', {}, fmtBytes(rec.sizeBytes)),
      el('td', {}, timeAgo(rec.uploadedAt)),
      el('td', {}, String(rec.downloads)),
      el('td', {}, rec.tags.map(t => el('span', { class: 'tag-pill' }, t))));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, assetActions(rec, onChanged));
    });
    tbody.append(row);
  }
  table.append(tbody);
  container.append(table);
}

export function bulkBar(onDone) {
  const bar = el('div', { class: 'bulk-bar' });
  const refresh = () => {
    bar.innerHTML = '';
    const n = state.selection.size;
    if (n === 0) { bar.remove(); return; }
    bar.append(
      el('span', {}, `${n} selected`),
      el('button', { class: 'btn small', onclick: async () => {
        const tags = prompt('Add tags (comma separated):');
        if (tags) { await api.post('/api/v1/assets/bulk', { action: 'addTags', ids: [...state.selection], tags: tags.split(',').map(t => t.trim()) }); toast('Tagged', 'success'); onDone(); }
      } }, '🏷 Tag'),
      el('button', { class: 'btn small danger', onclick: async () => {
        await api.post('/api/v1/assets/bulk', { action: 'delete', ids: [...state.selection] });
        state.selection.clear(); toast('Deleted', 'success'); onDone();
      } }, '🗑 Delete'),
      el('button', { class: 'btn small', onclick: () => { state.selection.clear(); window.dispatchEvent(new CustomEvent('mb:selection')); bar.remove(); } }, '✕')
    );
  };
  refresh();
  window.addEventListener('mb:selection', refresh);
  return bar;
}