import { api } from './api.js';
import { state } from './state.js';
import { route, setNotFound, startRouter } from './router.js';
import { toast } from './ui.js';
import { uploader } from './uploader.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderUpload } from './pages/upload.js';
import { renderAssets } from './pages/assets.js';
import { renderCategories, renderFolders, renderSearch, renderStatistics, renderTrash, renderActivity } from './pages/misc.js';
import { renderApiKeys, renderUsers, renderSettings } from './pages/admin.js';

route('dashboard', renderDashboard);
route('upload', (view) => renderUpload(view));
route('assets', renderAssets);
route('categories', renderCategories);
route('folders', renderFolders);
route('search', renderSearch);
route('statistics', renderStatistics);
route('api-keys', renderApiKeys);
route('users', renderUsers);
route('activity', renderActivity);
route('trash', renderTrash);
route('settings', renderSettings);
setNotFound((view) => { view.innerHTML = '<div class="empty">Page not found</div>'; });

// ── Boot ────────────────────────────────────────────────────────────────
async function boot() {
  if (!api.token) return showLogin();
  try {
    state.me = await api.get('/api/v1/users/me');
    showApp();
  } catch { showLogin(); }
}

function showLogin() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
}

function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-chip').textContent = `${state.me?.username ?? 'user'} · ${state.me?.role ?? ''}`;
  document.getElementById('user-chip').onclick = async () => {
    if (confirm('Log out?')) { api.setToken(null); location.reload(); }
  };
  startRouter();
  refreshStorageBadge();
  initSSE();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const res = await api.post('/api/v1/auth/login', {
      username: document.getElementById('login-username').value || 'admin',
      password: document.getElementById('login-password').value
    });
    api.setToken(res.token);
    state.me = res.user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message || 'Login failed';
  }
});

window.addEventListener('mb:unauthorized', () => { api.setToken(null); showLogin(); });

// ── Global drag & drop ──────────────────────────────────────────────────
let dragDepth = 0;
const overlay = document.getElementById('drop-overlay');
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer?.types ?? []].includes('Files')) return;
  dragDepth++; overlay.classList.remove('hidden');
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.add('hidden'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; overlay.classList.add('hidden');
  if (e.dataTransfer?.files?.length) {
    uploader.add([...e.dataTransfer.files]);
    toast(`${e.dataTransfer.files.length} file(s) queued for upload`, 'success');
  }
});

// ── Clipboard image paste ───────────────────────────────────────────────
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.items ?? [])]
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile())
    .filter(Boolean);
  if (files.length) {
    const named = files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type }));
    uploader.add(named);
    toast('Clipboard image queued', 'success');
  }
});

// ── Topbar search shortcut ──────────────────────────────────────────────
const searchInput = document.getElementById('global-search');
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
     location.hash = `#/search?q=${encodeURIComponent(searchInput.value)}`;
      searchInput.value = ''; 
    }
});
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchInput.focus(); }
});
document.getElementById('nav-toggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');

// ── Upload progress in topbar ───────────────────────────────────────────
const mini = document.getElementById('upload-mini');
uploader.addEventListener('change', () => {
  const s = uploader.summary();
  if (s.total === 0 || (s.active === 0 && s.done + s.errors === s.total)) { mini.classList.add('hidden'); return; }
  mini.classList.remove('hidden');
  mini.textContent = s.active > 0 ? `⬆ ${s.active} uploading…` : `✓ ${s.done} uploaded${s.errors ? `, ${s.errors} failed` : ''}`;
});

// ── Live updates via SSE ────────────────────────────────────────────────
function initSSE() {
  try {
    const es = new EventSource(`/api/v1/events?token=`); // auth via cookie fallback not used; SSE relies on fetch-auth below
    // EventSource cannot set headers → use fetch-based fallback stream
    es.close();
  } catch { /* ignore */ }

  let stopped = false;
  async function connect() {
    try {
      const res = await fetch('/api/v1/events', { headers: { Authorization: `Bearer ${api.token}` } });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const eventLine = block.match(/^event: (.+)$/m)?.[1];
          if (eventLine?.startsWith('asset.') || eventLine === 'index.rebuilt' || eventLine === 'stats.updated') {
            refreshStorageBadge();
            window.dispatchEvent(new CustomEvent('mb:live', { detail: { type: eventLine } }));
          }
        }
      }
    } catch { /* network blip */ }
    if (!stopped) setTimeout(connect, 3000);
  }
  connect();
}

async function refreshStorageBadge() {
  try {
    const stats = await api.get('/api/v1/statistics');
    const badge = document.getElementById('storage-badge');
    badge.innerHTML = `${stats.totalAssets.toLocaleString()} assets<br>${(stats.totalBytes / 1073741824).toFixed(2)} GiB stored`;
  } catch { /* offline */ }
}

boot();