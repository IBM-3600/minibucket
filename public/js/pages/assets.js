import { el } from '../ui.js';
import { api } from '../api.js';
import { state, setViewMode } from '../state.js';
import { renderGrid, renderList, bulkBar } from '../render-assets.js';
import { navigate } from '../router.js';

export async function renderAssets(view, { query }) {
  const params = { perPage: 50, page: Number(query.get('page') ?? 1) };
  for (const k of ['q', 'category', 'tag', 'folder', 'ext', 'mime', 'from', 'to', 'minSize', 'maxSize', 'sort', 'order']) {
    if (query.get(k)) params[k] = query.get(k);
  }
  const qs = new URLSearchParams(params).toString();

  view.append(el('div', { class: 'page-head' },
    el('h2', {}, params.category ? `Assets — ${params.category}` : 'Assets'),
    el('div', { class: 'spacer' }),
    el('button', { class: `btn small ${state.viewMode === 'grid' ? 'primary' : ''}`, onclick: () => { setViewMode('grid'); location.hash = location.hash; reload(); } }, '▦'),
    el('button', { class: `btn small ${state.viewMode === 'list' ? 'primary' : ''}`, onclick: () => { setViewMode('list'); reload(); } }, '☰')));

  const settings = await api.get('/api/v1/settings');
  const categories = Object.keys(settings.categories.categories).concat(['other']);

  const toolbar = el('div', { class: 'toolbar' });
  const catSel = el('select', { onchange: (e) => setQ('category', e.target.value) },
    el('option', { value: '' }, 'All categories'),
    ...categories.map(c => el('option', { value: c, ...(params.category === c ? { selected: true } : {}) }, c)));
  const sortSel = el('select', { onchange: (e) => { const [s, o] = e.target.value.split(':'); setQ('sort', s); setQ('order', o); } },
    ...[['uploadedAt:desc', 'Newest'], ['uploadedAt:asc', 'Oldest'], ['sizeBytes:desc', 'Largest'], ['sizeBytes:asc', 'Smallest'], ['originalName:asc', 'Name A-Z'], ['downloads:desc', 'Most downloaded']]
      .map(([v, l]) => el('option', { value: v }, l)));
  toolbar.append(catSel, sortSel);
  if (params.tag) toolbar.append(el('span', { class: 'tag-pill' }, `tag:${params.tag} `, el('button', { onclick: () => setQ('tag', '') }, '✕')));
  if (params.folder) toolbar.append(el('span', { class: 'tag-pill' }, `folder:${params.folder} `, el('button', { onclick: () => setQ('folder', '') }, '✕')));
  view.append(toolbar);

  const listWrap = el('div', {});
  view.append(listWrap);
  const sentinel = el('div', { style: 'height:30px' });
  view.append(sentinel);
  view.append(bulkBar(() => reload()));

  let page = Number(query.get('page') ?? 1);
  let totalPages = 1;
  let loading = false;
  const collected = [];

  const loadPage = async (p) => {
    if (loading) return;
    loading = true;
    const res = await api.get(`/api/v1/assets?${qs}&page=${p}`);
    totalPages = res.totalPages;
    collected.push(...res.items);
    listWrap.innerHTML = '';
    if (collected.length === 0) listWrap.append(el('div', { class: 'empty' }, 'No assets match.'));
    else state.viewMode === 'grid'
      ? renderGrid(listWrap, collected, { onChanged: reload })
      : renderList(listWrap, collected, { onChanged: reload });
    loading = false;
  };

  const io = new IntersectionObserver(async (entries) => {
    if (entries[0].isIntersecting && page < totalPages) { page++; await loadPage(page); }
  }, { rootMargin: '400px' });
  io.observe(sentinel);

  await loadPage(page);

  function setQ(key, value) {
    const q = new URLSearchParams(query.toString());
    value ? q.set(key, value) : q.delete(key);
    q.delete('page');
    navigate(`#/assets?${q.toString()}`);
  }
  function reload() { location.hash = location.hash; view.innerHTML = ''; renderAssets(view, { query }); }
}