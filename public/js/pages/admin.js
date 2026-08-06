import { el, fmtDate, toast, confirmDialog, copyText } from '../ui.js';
import { api } from '../api.js';

export async function renderApiKeys(view) {
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'API Keys'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: createKey }, '+ New key')));

  const panel = el('div', { class: 'panel' });
  view.append(panel);
  await refresh();

  async function refresh() {
    const { keys } = await api.get('/api/v1/api-keys');
    panel.innerHTML = '';
    if (keys.length === 0) { panel.append(el('div', { class: 'empty' }, 'No API keys yet')); return; }
    for (const k of keys) {
      panel.append(el('div', { style: 'display:flex;gap:.7rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--border);flex-wrap:wrap' },
        el('strong', {}, k.name),
        el('code', {}, `${k.prefix}…`),
        el('span', { class: 'badge' }, k.role),
        el('span', { class: 'muted' }, `scopes: ${k.scopes.join(', ') || 'default'}`),
        k.expiresAt ? el('span', { class: 'muted' }, `expires ${fmtDate(k.expiresAt)}`) : null,
        k.revoked ? el('span', { class: 'badge' }, 'revoked') : null,
        el('div', { class: 'spacer', style: 'flex:1' }),
        !k.revoked ? el('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmDialog(`Revoke key "${k.name}"?`)) { await api.del(`/api/v1/api-keys/${k.id}`); refresh(); }
        } }, 'Revoke') : null));
    }
  }

  async function createKey() {
    const name = prompt('Key name:', 'my-integration');
    if (!name) return;
    const role = prompt('Role (viewer/uploader/editor/admin):', 'uploader');
    if (!role) return;
    const res = await api.post('/api/v1/api-keys', { name, role });
    copyText(res.key, 'Key copied — store it now, it is shown only once');
    toast(`Created ${res.key.slice(0, 12)}… (copied)`, 'success', 6000);
    refresh();
  }
}

export async function renderUsers(view) {
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Users'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: createUser }, '+ New user')));
  const panel = el('div', { class: 'panel' });
  view.append(panel);
  await refresh();

  async function refresh() {
    const { users } = await api.get('/api/v1/users');
    panel.innerHTML = '';
    for (const u of users) {
      panel.append(el('div', { style: 'display:flex;gap:.7rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--border);flex-wrap:wrap' },
        el('strong', {}, u.username),
        el('span', { class: 'badge' }, u.role),
        el('span', { class: 'muted' }, `created ${fmtDate(u.createdAt)}`),
        u.lastLoginAt ? el('span', { class: 'muted' }, `last login ${fmtDate(u.lastLoginAt)}`) : null,
        el('div', { style: 'flex:1' }),
        el('button', { class: 'btn small', onclick: async () => {
          const role = prompt('New role (viewer/uploader/editor/admin):', u.role);
          if (role) { await api.patch(`/api/v1/users/${u.id}`, { role }); refresh(); }
        } }, 'Role'),
        el('button', { class: 'btn small', onclick: async () => {
          const pw = prompt('New password (min 8 chars):');
          if (pw) { await api.patch(`/api/v1/users/${u.id}`, { password: pw }); toast('Password updated', 'success'); }
        } }, 'Password'),
        el('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmDialog(`Delete user ${u.username}?`)) { await api.del(`/api/v1/users/${u.id}`).catch(e => toast(e.message, 'error')); refresh(); }
        } }, '🗑')));
    }
  }

  async function createUser() {
    const username = prompt('Username:'); if (!username) return;
    const password = prompt('Password (min 8 chars):'); if (!password) return;
    const role = prompt('Role:', 'viewer'); if (!role) return;
    try { await api.post('/api/v1/users', { username, password, role }); toast('User created', 'success'); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }
}

export async function renderSettings(view) {
  const res = await api.get('/api/v1/settings');
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Settings')));

  const panel = el('div', { class: 'panel' }, el('h3', {}, 'Runtime settings'));
  const dedupe = checkbox('Deduplicate uploads by SHA-256', res.config.dedupe);
  const thumbs = checkbox('Generate thumbnails/previews', res.config.thumbnailEnabled);
  const naming = el('select', {},
    ...['hash', 'timestamp', 'uuid'].map(s => el('option', { value: s, ...(res.config.namingStrategy === s ? { selected: true } : {}) }, s)));

  panel.append(
    labeled('Naming strategy', naming), dedupe.wrap, thumbs.wrap,
    el('button', { class: 'btn primary', onclick: async () => {
      await api.put('/api/v1/settings', { dedupe: dedupe.input.checked, thumbnailEnabled: thumbs.input.checked, namingStrategy: naming.value });
      toast('Settings saved', 'success');
    } }, 'Save'));
  view.append(panel);

  const info = el('div', { class: 'panel' }, el('h3', {}, 'Server'),
    kv('Version', res.config.version), kv('Max file size', `${(res.config.maxFileSize / 1048576).toFixed(0)} MiB`),
    kv('Max chunk size', `${(res.config.maxChunkSize / 1048576).toFixed(0)} MiB`),
    kv('CDN max-age', `${res.config.cdnMaxAge}s (immutable)`),
    kv('S3 compatibility', res.config.s3Enabled ? `enabled (bucket: ${res.config.s3Bucket})` : 'disabled'));
  view.append(info);

  const maint = el('div', { class: 'panel' }, el('h3', {}, 'Maintenance'),
    el('p', { class: 'muted' }, 'Rebuild scans the storage directory and reconciles the JSON index. This is the only operation that walks the filesystem.'),
    el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Rebuilding…';
      try { const r = await api.post('/api/v1/rebuild-index'); toast(`Rebuilt: ${r.scanned} scanned, ${r.created} created, ${r.updated} updated`, 'success', 6000); }
      finally { e.target.disabled = false; e.target.textContent = 'Rebuild index'; }
    } }, 'Rebuild index'));
  view.append(maint);

  function kv(k, v) { return el('div', { class: 'kv', style: 'grid-template-columns:160px 1fr' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)); }
  function checkbox(label, checked) {
    const input = el('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
    return { input, wrap: el('label', { style: 'display:flex;gap:.5rem;align-items:center;margin:.4rem 0' }, input, label) };
  }
  function labeled(label, control) {
    return el('label', { style: 'display:flex;gap:.6rem;align-items:center;margin:.4rem 0' }, el('span', { style: 'min-width:150px' }, label), control);
  }
}