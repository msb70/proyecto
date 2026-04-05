/**
 * inventory.js — Inventory management via server REST API
 * All methods return Promises.
 */

const Inventory = (() => {
  const BASE = '/api/inventory';

  async function request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Returns all items, or filtered by query string */
  function getAll(query = '') {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return request('GET', qs);
  }

  /** Add a new inventory entry */
  function addEntry(data) {
    return request('POST', '', data);
  }

  /** Remove an entry by id */
  function removeEntry(id) {
    return request('DELETE', `/${id}`);
  }

  /** Clear entire inventory */
  function clearAll() {
    return request('DELETE', '');
  }

  /** Get aggregate stats */
  function getStats() {
    return request('GET', '/stats');
  }

  /** Filter items (same as getAll with query) */
  function filter(query) {
    return getAll(query);
  }

  /** Trigger server-side CSV download */
  function exportCSV() {
    window.location.href = `${BASE}/export.csv`;
    return Promise.resolve(true);
  }

  return { getAll, addEntry, removeEntry, clearAll, getStats, filter, exportCSV };
})();
