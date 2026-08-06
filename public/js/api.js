const TOKEN_KEY = 'mb.token';

export const api = {
  token: localStorage.getItem(TOKEN_KEY) || null,

  setToken(t) { this.token = t; t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); },

  async request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    let payload;
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      payload = body;
      if (body instanceof Blob && !h['Content-Type']) h['Content-Type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers: h, body: payload });
    if (res.status === 401 && !path.includes('/auth/')) {
      window.dispatchEvent(new CustomEvent('mb:unauthorized'));
      throw { status: 401, message: 'unauthorized' };
    }
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw { status: res.status, message: data?.error || res.statusText, data };
    return data;
  },

  get: (p) => api.request(p),
  post: (p, body, headers) => api.request(p, { method: 'POST', body, headers }),
  put: (p, body, headers) => api.request(p, { method: 'PUT', body, headers }),
  patch: (p, body) => api.request(p, { method: 'PATCH', body }),
  del: (p) => api.request(p, { method: 'DELETE' })
};