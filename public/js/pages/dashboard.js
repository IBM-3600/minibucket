import { el, fmtBytes } from '../ui.js';
import { api } from '../api.js';
import { renderGrid } from '../render-assets.js';

export async function renderDashboard(view) {
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Dashboard')));

  const [stats, recent] = await Promise.all([
    api.get('/api/v1/statistics'),
    api.get('/api/v1/assets?perPage=8&sort=uploadedAt&order=desc')
  ]);

  const cards = el('div', { class: 'stat-grid' },
    statCard('Total assets', stats.totalAssets.toLocaleString()),
    statCard('Storage used', fmtBytes(stats.totalBytes)),
    statCard('Uploads today', stats.todayUploads),
    statCard('Downloads today', stats.downloadsToday));
  view.append(cards);

  const days = Object.entries(stats.uploadsByDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const max = Math.max(1, ...days.map(([, n]) => n));
  const chart = el('div', { class: 'bar-chart' },
    ...days.map(([day, n]) => el('div', {
      class: 'bar', style: `height:${Math.max(2, (n / max) * 100)}%`,
      'data-label': `${day}: ${n}`
    })));

  const catMax = Math.max(1, ...Object.values(stats.byCategory));
  const cats = el('div', {}, Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([cat, n]) => el('div', { class: 'cat-row' },
      el('span', {}, cat),
      el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(n / catMax) * 100}%` })),
      el('span', { class: 'muted' }, String(n)))));

  view.append(el('div', { class: 'two-col' },
    el('div', { class: 'panel' }, el('h3', {}, 'Uploads — last 14 days'), chart),
    el('div', { class: 'panel' }, el('h3', {}, 'By category'), cats)));

  view.append(el('div', { class: 'panel' }, el('h3', {}, 'Recent uploads'),
    el('div', { id: 'recent-grid' })));
  renderGrid(view.querySelector('#recent-grid'), recent.items, { onChanged: () => renderDashboardRefresh(view) });
}

function statCard(k, v) { return el('div', { class: 'stat-card' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)); }
function renderDashboardRefresh(view) { view.innerHTML = ''; renderDashboard(view); }