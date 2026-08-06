import { el, fmtBytes, toast } from '../ui.js';
import { uploader } from '../uploader.js';

export function renderUpload(view) {
  view.append(el('div', { class: 'page-head' }, el('h2', {}, 'Upload')));

  const folderInput = el('input', { id: 'up-folder-name', placeholder: 'Target folder (optional)', style: 'max-width:260px' });
  const tagsInput = el('input', { id: 'up-tags', placeholder: 'Tags (comma separated, optional)', style: 'max-width:320px' });
  const fileInput = el('input', { type: 'file', multiple: true, class: 'hidden' });
  const dirInput = el('input', { type: 'file', multiple: true, webkitdirectory: '', class: 'hidden' });

  const dz = el('div', { class: 'dropzone' },
    el('div', { style: 'font-size:2.4rem' }, '⬆️'),
    el('p', {}, 'Drag & drop files here, paste an image (Ctrl+V), or'),
    el('div', { style: 'display:flex;gap:.6rem;justify-content:center;margin-top:.6rem;flex-wrap:wrap' },
      el('button', { class: 'btn primary', onclick: () => fileInput.click() }, 'Choose files'),
      el('button', { class: 'btn', onclick: () => dirInput.click() }, 'Choose folder')));

  const startUpload = (files) => {
    if (!files?.length) return;
    uploader.add([...files], { folder: folderInput.value.trim(), tags: tagsInput.value.split(',').map(t => t.trim()).filter(Boolean) });
    toast(`${files.length} file(s) queued`, 'success');
  };

  dz.addEventListener('click', (e) => { if (e.target === dz) fileInput.click(); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); startUpload(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => startUpload(fileInput.files));
  dirInput.addEventListener('change', () => startUpload(dirInput.files));

  view.append(el('div', { class: 'panel' },
    el('div', { style: 'display:flex;gap:.6rem;margin-bottom:1rem;flex-wrap:wrap' }, folderInput, tagsInput), dz));

  const queuePanel = el('div', { class: 'panel' }, el('h3', {}, 'Upload queue'));
  const queueList = el('div', {});
  queuePanel.append(queueList);
  view.append(queuePanel);

  const draw = () => {
    queueList.innerHTML = '';
    const items = [...uploader.items.values()];
    if (items.length === 0) { queueList.append(el('div', { class: 'empty' }, 'Queue is empty')); return; }
    for (const it of items) {
      const pct = it.size ? Math.min(100, Math.round((it.done / it.size) * 100)) : 0;
      const controls = [];
      if (it.state === 'uploading') controls.push(el('button', { class: 'btn small', onclick: () => uploader.pause(it.id) }, '⏸'));
      if (it.state === 'paused') controls.push(el('button', { class: 'btn small', onclick: () => uploader.resume(it.id) }, '▶'));
      if (it.state === 'error') controls.push(el('button', { class: 'btn small', onclick: () => uploader.retry(it.id) }, '↻ Retry'));
      if (!['done', 'cancelled'].includes(it.state)) controls.push(el('button', { class: 'btn small danger', onclick: () => uploader.cancel(it.id) }, '✕'));

      const status = { waiting: 'queued', uploading: `${pct}%`, paused: 'paused', done: '✓ done', error: `✗ ${it.error}`, cancelled: 'cancelled' }[it.state];
      queueList.append(el('div', { class: 'queue-item' },
        el('div', { class: 'qname' }, it.name),
        el('div', { class: 'qstatus' }, el('span', {}, `${fmtBytes(it.done)} / ${fmtBytes(it.size)}`), el('span', {}, status), ...controls),
        el('div', { class: 'progress' }, el('div', { style: `width:${pct}%` }))));
    }
  };
  uploader.addEventListener('change', draw);
  draw();
}