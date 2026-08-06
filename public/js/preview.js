import { el, fmtBytes, fmtDate, esc, copyText } from './ui.js';
import { modal } from './ui.js';

export function openPreview(rec) {
  const origin = location.origin;
  const stage = el('div', { class: 'preview-stage' });

  if (rec.category === 'images') stage.append(el('img', { src: rec.publicUrl, alt: rec.originalName }));
  else if (rec.category === 'videos') stage.append(el('video', { src: rec.publicUrl, controls: true }));
  else if (rec.category === 'audio') stage.append(el('audio', { src: rec.publicUrl, controls: true }));
  else if (rec.extension === 'pdf') stage.append(el('iframe', { src: rec.publicUrl }));
  else stage.append(el('div', { class: 'empty' }, `No inline preview for .${rec.extension || 'unknown'} — download to view.`));

  const kv = el('div', { class: 'kv' },
    ['ID', rec.id], ['Original name', rec.originalName], ['Stored as', rec.storedName],
    ['Category', `${rec.category}${rec.extension ? ` / ${rec.extension}` : ''}`],
    ['MIME', rec.mimeType], ['Size', fmtBytes(rec.sizeBytes)],
    ['SHA-256', rec.sha256], ['Path', rec.relativePath],
    ['Uploaded by', rec.uploadedBy], ['Uploaded at', fmtDate(rec.uploadedAt)],
    ['Downloads', rec.downloads], ['Folder', rec.folder || '(root)'],
    ['Tags', rec.tags.join(', ') || '—']
  ).flatMap ? null : null;

  const kvWrap = el('div', { class: 'kv' });
  const rows = [
    ['ID', rec.id], ['Original name', rec.originalName], ['Stored as', rec.storedName],
    ['Category', `${rec.category}${rec.extension ? ` / ${rec.extension}` : ''}`],
    ['MIME', rec.mimeType], ['Size', fmtBytes(rec.sizeBytes)],
    ['SHA-256', rec.sha256], ['Path', rec.relativePath],
    ['Uploaded by', rec.uploadedBy], ['Uploaded at', fmtDate(rec.uploadedAt)],
    ['Downloads', String(rec.downloads)], ['Folder', rec.folder || '(root)'],
    ['Tags', rec.tags.join(', ') || '—']
  ];
  for (const [k, v] of rows) kvWrap.append(el('div', { class: 'k' }, k), el('div', { class: 'v' }, v));
  void kv; void esc;

  modal({
    title: rec.originalName,
    body: el('div', {}, stage, kvWrap),
    actions: (close) => [
      el('button', { class: 'btn', onclick: () => copyText(`${origin}${rec.publicUrl}`, 'CDN URL copied') }, 'Copy CDN URL'),
      el('button', { class: 'btn', onclick: () => window.open(rec.publicUrl, '_blank') }, 'Open'),
      el('button', { class: 'btn primary', onclick: close }, 'Close')
    ]
  });
}