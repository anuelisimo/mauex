// Proxy config and fetch wrappers.
// Loaded before app.js so legacy inline handlers and app globals keep working.
var PROXY_URL = localStorage.getItem('mauex_proxy') || 'https://mauex-proxy.mauaparo.workers.dev';
var WORKER_API_TOKEN_KEY = 'mauex_api_token';

function getWorkerApiToken() {
  const token = localStorage.getItem(WORKER_API_TOKEN_KEY)
    || localStorage.getItem('MAUEX_API_TOKEN')
    || localStorage.getItem('mauexApiToken')
    || '';
  if (token && !localStorage.getItem(WORKER_API_TOKEN_KEY)) {
    localStorage.setItem(WORKER_API_TOKEN_KEY, token);
  }
  return token;
}

window.workerFetch = function workerFetch(path, options = {}) {
  if (!PROXY_URL) return fetch(path, options);
  const token = getWorkerApiToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const url = path.startsWith('http') ? path : `${PROXY_URL}${path.startsWith('/') ? path : '/' + path}`;
  return fetch(url, { ...options, headers });
};

window.proxyFetch = function proxyFetch(url, options = {}) {
  if (!PROXY_URL) return fetch(url, options);
  return window.workerFetch(`/proxy?url=${encodeURIComponent(url)}`, options);
};

window.publicFetch = async function publicFetch(url, options = {}) {
  let directResult = null;
  try {
    const direct = await fetch(url, options);
    if (direct.ok || !window.proxyFetch) return direct;
    directResult = direct;
  } catch (e) {
    directResult = e;
  }
  if (window.proxyFetch) {
    try {
      return await window.proxyFetch(url, options);
    } catch (e) {
      if (directResult instanceof Response) return directResult;
      throw e;
    }
  }
  if (directResult instanceof Response) return directResult;
  throw directResult;
};
