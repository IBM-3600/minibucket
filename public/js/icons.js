export const CATEGORY_ICONS = {
  images: '🖼️', models: '🧊', textures: '🎨', videos: '🎬', audio: '🎵',
  documents: '📄', archives: '🗜️', fonts: '🔤', code: '🧩', other: '📦'
};
export const categoryIcon = (cat) => CATEGORY_ICONS[cat] ?? '📦';