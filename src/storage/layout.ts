import fs from 'node:fs/promises';
import { MIME_TYPES } from './mime.js';

export interface CategoriesConfig {
  categories: Record<string, { extensions: string[] }>;
  blocked: string[];
}

export const DEFAULT_CATEGORIES: CategoriesConfig = {
  categories: {
    images:    { extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tiff'] },
    models:    { extensions: ['glb', 'gltf', 'fbx', 'obj', 'dae', 'usdz', 'stl', 'blend'] },
    textures:  { extensions: ['hdr', 'exr', 'ktx2', 'ktx'] },
    videos:    { extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'] },
    audio:     { extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] },
    documents: { extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf'] },
    archives:  { extensions: ['zip', 'rar', 'tar', 'gz', 'bz2', 'xz', '7z'] },
    fonts:     { extensions: ['woff', 'woff2', 'ttf', 'otf', 'eot'] },
    code:      { extensions: ['js', 'mjs', 'cjs', 'ts', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'toml', 'sh', 'py', 'wasm'] }
  },
  blocked: ['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'dll', 'so', 'dylib', 'app', 'jar', 'class', 'ps1', 'vbs', 'hta', 'php', 'jsp']
};

export async function loadCategoriesConfig(file?: string): Promise<CategoriesConfig> {
  if (!file) return DEFAULT_CATEGORIES;
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CategoriesConfig>;
    if (!parsed.categories || typeof parsed.categories !== 'object') return DEFAULT_CATEGORIES;
    return { categories: parsed.categories, blocked: parsed.blocked ?? [] };
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

export class Layout {
  private extToCategory = new Map<string, string>();
  private blockedSet = new Set<string>();

  constructor(public readonly config: CategoriesConfig) {
    for (const [cat, def] of Object.entries(config.categories)) {
      for (const ext of def.extensions) this.extToCategory.set(ext.toLowerCase(), cat);
    }
    for (const ext of config.blocked) this.blockedSet.add(ext.toLowerCase());
  }

  categories(): string[] { return [...Object.keys(this.config.categories), 'other']; }

  isBlocked(ext: string): boolean { return this.blockedSet.has(ext.toLowerCase()); }

  categoryFor(ext: string): string {
    return this.extToCategory.get(ext.toLowerCase()) ?? 'other';
  }

  classify(ext: string): { category: string; allowed: boolean } {
    const e = ext.toLowerCase();
    return { category: this.categoryFor(e), allowed: !this.isBlocked(e) };
  }

  mimeFor(ext: string): string {
    return MIME_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
  }
}