export const state = {
  me: null,
  settings: null,
  selection: new Set(),
  viewMode: localStorage.getItem('mb.view') || 'grid'
};
export function setViewMode(mode) { state.viewMode = mode; localStorage.setItem('mb.view', mode); }