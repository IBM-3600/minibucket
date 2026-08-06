export const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  bmp: 'image/bmp', tiff: 'image/tiff',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', fbx: 'model/fbx', obj: 'model/obj',
  dae: 'model/vnd.collada+xml', usdz: 'model/vnd.usdz+zip', stl: 'model/stl',
  hdr: 'application/octet-stream', exr: 'image/x-exr', ktx2: 'image/ktx2', ktx: 'image/ktx',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', rar: 'application/vnd.rar', tar: 'application/x-tar',
  gz: 'application/gzip', '7z': 'application/x-7z-compressed',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  js: 'application/javascript; charset=utf-8', mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8', xml: 'application/xml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8', yml: 'text/yaml; charset=utf-8', wasm: 'application/wasm'
};

export const COMPRESSIBLE = (mime: string): boolean =>
  mime.startsWith('text/') ||
  ['application/json', 'application/javascript', 'application/xml', 'image/svg+xml',
   'application/x-yaml', 'model/gltf+json', 'model/vnd.collada+xml', 'model/obj']
    .some(c => mime.startsWith(c));