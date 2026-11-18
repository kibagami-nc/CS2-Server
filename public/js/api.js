/** Petit client fetch : JSON en entrée/sortie, erreurs lisibles. */
async function request(method, url, body, { raw = false, contentType } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    if (raw) {
      opts.body = body;
      opts.headers['Content-Type'] = contentType || 'application/octet-stream';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse vide */
  }
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event('auth:required'));
  }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file) => request('POST', url, file, { raw: true, contentType: 'application/zip' }),
};
