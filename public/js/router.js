const routes = new Map();
let notFound = null;

export function route(name, handler) { routes.set(name, handler); }
export function setNotFound(handler) { notFound = handler; }

export function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [pathPart, queryPart] = hash.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return { name: segments[0] || 'dashboard', param: segments[1], query: new URLSearchParams(queryPart ?? '') };
}

export function navigate(hash) { location.hash = hash; }

export function startRouter(render) {
  const dispatch = async () => {
    const { name, param, query } = parseHash();
    document.querySelectorAll('#nav a').forEach(a =>
      a.classList.toggle('active', a.dataset.route === name));
    const handler = routes.get(name) ?? notFound;
    const view = document.getElementById('view');
    view.innerHTML = '';
    try { await handler?.(view, { param, query }); }
    catch (err) { view.innerHTML = `<div class="empty">Failed to load: ${err?.message ?? err}</div>`; }
  };
  window.addEventListener('hashchange', dispatch);
  dispatch();
  return dispatch;
}