import { el, fmtBytes, fmtDate, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { renderGrid } from '../render-assets.js';
import { navigate } from '../router.js';
import { categoryIcon } from '../icons.js';

export async function renderCategories(view) {
  const [stats, settings] = await Promise.all([api.get('/api/v1/statistics'), api.get('/api/v1/settings')]);
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Categories')));
  const grid = el('div', { class: 'grid' });
  const cats = Object.keys(settings.categories.categories).concat(['other']);
  for (const cat of cats) {
    const count = stats.byCategory[cat] ?? 0;
    const card = el('div', { class: 'card', onclick: () => navigate(`#/assets?category=${cat}`) },
      el('div', { class: 'thumb' }, categoryIcon(cat)),
      el('div', { class: 'meta' },
        el('div', { class: 'name' }, cat),
        el('div', { class: 'sub' }, el('span', {}, `${count} assets`),
          el('span', {}, settings.categories.categories[cat]?.extensions?.length ?? '∞'))));
    grid.append(card);
  }
  view.append(grid);
}

export async function renderFolders(view) {
  const res = await api.get('/api/v1/folders');
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Folders'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: async () => {
      const name = prompt('Folder name:');
      if (name) { await api.post('/api/v1/folders', { name }); toast('Folder created', 'success'); view.innerHTML = ''; renderFolders(view); }
    } }, '+ New folder')));

  const list = el('div', { class: 'panel' });
  if (res.folders.length === 0) list.append(el('div', { class: 'empty' }, 'No folders yet. Assign folders via uploads or the asset menu.'));
  for (const f of res.folders) {
    list.append(el('div', { style: 'display:flex;gap:.6rem;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--border)' },
      el('a', { href: f.name ? `#/assets?folder=${encodeURIComponent(f.name)}` : '#/assets', style: 'flex:1' }, f.name || '(root)'),
      el('span', { class: 'muted' }, `${f.count} · ${fmtBytes(f.bytes)}`),
      f.name ? el('button', { class: 'btn small', onclick: async () => {
        const to = prompt('Rename to:', f.name);
        if (to && to !== f.name) { await api.patch('/api/v1/folders', { from: f.name, to }); view.innerHTML = ''; renderFolders(view); }
      } }, '✏️') : null,
      f.name ? el('button', { class: 'btn small danger', onclick: async () => {
        if (await confirmDialog(`Delete folder "${f.name}"? Contents move to root.`)) {
          await api.del(`/api/v1/folders/${encodeURIComponent(f.name)}?force=1`);
          view.innerHTML = ''; renderFolders(view);
        }
      } }, '🗑') : null));
  }
  view.append(list);
}

export async function renderSearch(view, { query }) {
  const q = query.get('q') ?? '';
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Search')));
  const input = el('input', { placeholder: 'Search names, tags, folders…', value: q, style: 'max-width:480px' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(`#/search?q=${encodeURIComponent(input.value)}`); });
  view.append(el('div', { class: 'toolbar' }, input));
  const results = el('div', {});
  view.append(results);
  if (q) {
    const res = await api.get(`/api/v1/search?q=${encodeURIComponent(q)}&perPage=100`);
    results.append(el('p', { class: 'muted' }, `${res.total} result(s)`));
    renderGrid(results, res.items, { onChanged: () => { results.innerHTML = ''; renderSearch(view, { query }); } });
  }
}

export async function renderStatistics(view) {
  const stats = await api.get('/api/v1/statistics');
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Statistics')));
  view.append(el('div', { class: 'stat-grid' },
    card('Total assets', stats.totalAssets.toLocaleString()),
    card('Total bytes', fmtBytes(stats.totalBytes)),
    card('Uploads today', stats.todayUploads),
    card('Downloads today', stats.downloadsToday),
    card('Last rebuild', stats.lastRebuildAt ? fmtDate(stats.lastRebuildAt) : 'never')));

  const byExt = Object.entries(stats.byExtension).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const max = Math.max(1, ...byExt.map(([, n]) => n));
  view.append(el('div', { class: 'two-col' },
    el('div', { class: 'panel' }, el('h3', {}, 'By category'),
      ...Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => row(c, n, stats.totalAssets))),
    el('div', { class: 'panel' }, el('h3', {}, 'Top extensions'),
      ...byExt.map(([e, n]) => row(`.${e}`, n, max)))));

  const dl = Object.entries(stats.downloadsByDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const dlMax = Math.max(1, ...dl.map(([, n]) => n));
  view.append(el('div', { class: 'panel' }, el('h3', {}, 'Downloads — last 14 days'),
    el('div', { class: 'bar-chart' }, ...dl.map(([d, n]) =>
      el('div', { class: 'bar', style: `height:${Math.max(2, (n / dlMax) * 100)}%`, 'data-label': `${d}: ${n}` })))));

  function card(k, v) { return el('div', { class: 'stat-card' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)); }
  function row(label, n, maxV) {
    return el('div', { class: 'cat-row' },
      el('span', {}, label),
      el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(n / maxV) * 100}%` })),
      el('span', { class: 'muted' }, String(n)));
  }
}

export async function renderTrash(view) {
  const res = await api.get('/api/v1/assets?trashed=true&perPage=200');
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Trash'),
    el('div', { class: 'spacer' }),
    res.items.length ? el('button', { class: 'btn danger', onclick: async () => {
      if (await confirmDialog('Permanently delete ALL trashed assets?')) {
        await api.post('/api/v1/assets/bulk', { action: 'purge', ids: res.items.map(r => r.id) });
        toast('Trash emptied', 'success'); view.innerHTML = ''; renderTrash(view);
      }
    } }, 'Empty trash') : null));
  const wrap = el('div', {});
  if (res.items.length === 0) wrap.append(el('div', { class: 'empty' }, 'Trash is empty'));
  for (const rec of res.items) {
    wrap.append(el('div', { style: 'display:flex;gap:.7rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--border)' },
      el('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, rec.originalName),
      el('span', { class: 'muted' }, fmtBytes(rec.sizeBytes)),
      el('span', { class: 'muted' }, fmtDate(rec.deletedAt)),
      el('button', { class: 'btn small', onclick: async () => { await api.post(`/api/v1/assets/${rec.id}/restore`); toast('Restored', 'success'); view.innerHTML = ''; renderTrash(view); } }, '↩ Restore'),
      el('button', { class: 'btn small danger', onclick: async () => {
        if (await confirmDialog('Permanently delete?')) { await api.del(`/api/v1/assets/${rec.id}?purge=1`); view.innerHTML = ''; renderTrash(view); }
      } }, '✕')));
  }
  view.append(el('div', { class: 'panel' }, wrap));
}

export async function renderActivity(view) {
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Activity log')));
  const panel = el('div', { class: 'panel' });
  const load = async (page = 1) => {
    const res = await api.get(`/api/v1/activity?page=${page}&perPage=100`);
    panel.innerHTML = '';
    for (const e of res.items) {
      panel.append(el('div', { class: 'log-row' },
        el('span', { class: 'ts' }, fmtDate(e.ts)),
        el('span', {}, `${e.actor} · ${e.action}`),
        el('span', { class: 'muted' }, [e.target, e.detail].filter(Boolean).join(' — '))));
    }
    if (res.items.length === 0) panel.append(el('div', { class: 'empty' }, 'No activity yet'));
  };
  await load();
  view.append(panel);
}