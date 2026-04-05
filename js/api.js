/**
 * api.js — Three-level barcode product search
 *
 * Level 1: Open Food Facts (open source, no key, global food db with kosher data)
 * Level 2: UPC Item DB   (free tier, no key needed, broad product coverage)
 * Level 3: Barcode Spider / Open EAN via allorigins CORS proxy (fallback)
 */

const ProductAPI = (() => {

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  async function fetchJSON(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, ...options });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function clean(str) {
    if (!str) return '';
    return String(str).trim().replace(/\s+/g, ' ');
  }

  // Normalize result to a common schema
  function normalize({ name, brand, description, image, categories, labels, source }) {
    return {
      name:        clean(name)        || 'Sin nombre',
      brand:       clean(brand)       || '',
      description: clean(description) || '',
      image:       image              || '',
      categories:  Array.isArray(categories) ? categories.slice(0, 5) : [],
      labels:      Array.isArray(labels)     ? labels                 : [],
      source,
      isKosher: (labels || []).some(l =>
        /kosher|kosher\s*certified|OU|OK\s*kosher|kof-k|star-k/i.test(l)
      ),
    };
  }


  // -------------------------------------------------------
  // Level 1 — Open Food Facts
  // https://world.openfoodfacts.org/api/v0/product/{barcode}.json
  // -------------------------------------------------------
  async function searchOpenFoodFacts(barcode) {
    const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
    const data = await fetchJSON(url);

    if (data.status !== 1 || !data.product) {
      throw new Error('Not found in Open Food Facts');
    }

    const p = data.product;

    // Build a meaningful description
    const descParts = [];
    if (p.quantity)   descParts.push(p.quantity);
    if (p.ingredients_text_es || p.ingredients_text_en) {
      const ing = clean(p.ingredients_text_es || p.ingredients_text_en);
      if (ing) descParts.push(`Ingredientes: ${ing.substring(0, 120)}${ing.length > 120 ? '…' : ''}`);
    }
    if (p.nutriscore_grade) descParts.push(`Nutriscore: ${p.nutriscore_grade.toUpperCase()}`);

    // Extract categories
    const rawCats = (p.categories_tags || p.categories || '').toString();
    const categories = rawCats
      .split(',')
      .map(c => c.replace(/^en:/, '').replace(/-/g, ' ').trim())
      .filter(c => c && c.length > 1)
      .slice(0, 5);

    // Extract labels (includes kosher, vegan, etc.)
    const labels = (p.labels_tags || p.labels || '').toString()
      .split(',')
      .map(l => l.replace(/^en:/, '').replace(/-/g, ' ').trim())
      .filter(Boolean);

    return normalize({
      name:        p.product_name_es || p.product_name_en || p.product_name || p.abbreviated_product_name,
      brand:       p.brands,
      description: descParts.join(' · '),
      image:       p.image_url || p.image_front_url || '',
      categories,
      labels,
      source:      'Open Food Facts',
    });
  }


  // -------------------------------------------------------
  // Level 2 — UPC Item DB (free trial, no key)
  // https://api.upcitemdb.com/prod/trial/lookup?upc={barcode}
  // -------------------------------------------------------
  async function searchUPCItemDB(barcode) {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;
    const data = await fetchJSON(url);

    if (!data.items || data.items.length === 0) {
      throw new Error('Not found in UPC Item DB');
    }

    const item = data.items[0];

    const descParts = [];
    if (item.size)  descParts.push(item.size);
    if (item.color) descParts.push(`Color: ${item.color}`);
    if (item.description) descParts.push(clean(item.description).substring(0, 150));

    const categories = [item.category].filter(Boolean);

    return normalize({
      name:        item.title,
      brand:       item.brand,
      description: descParts.join(' · '),
      image:       (item.images || [])[0] || '',
      categories,
      labels:      [],
      source:      'UPC Item DB',
    });
  }


  // -------------------------------------------------------
  // Level 3 — Open EAN via allorigins CORS proxy
  // https://opengtindb.org/?ean={barcode}&cmd=detail&lang=ES
  // Fallback: try barcodelookup.com (scrape-friendly public endpoint)
  // -------------------------------------------------------
  async function searchOpenEAN(barcode) {
    // Try Open EAN database (free, no key)
    const targetUrl = `https://opengtindb.org/?ean=${barcode}&cmd=detail&lang=ES&fmt=json`;
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

    let data;
    try {
      data = await fetchJSON(proxy);
    } catch {
      throw new Error('Not found in Open EAN');
    }

    // opengtindb returns an array or object with product info
    const entries = Array.isArray(data) ? data : (data.entries || data.product ? [data.product || data] : []);
    const p = entries[0];

    if (!p || p.error || (!p.name && !p.detailname && !p.mainname)) {
      throw new Error('Not found in Open EAN');
    }

    const name = p.detailname || p.mainname || p.name || '';
    const brand = p.vendor || p.brand || '';
    const desc  = p.description || p.comment || p.detail || '';

    const categories = [p.maingroupname, p.groupname].filter(Boolean);

    return normalize({
      name,
      brand,
      description: clean(desc).substring(0, 200),
      image:       p.imageUrl || p.image || '',
      categories,
      labels:      [],
      source:      'Open EAN',
    });
  }


  // -------------------------------------------------------
  // Public: search with 3-level fallback
  // Returns { product, level } or throws if all fail
  // onProgress(level, state) where state = 'searching'|'success'|'fail'
  // -------------------------------------------------------
  async function search(barcode, onProgress) {
    const levels = [
      { fn: searchOpenFoodFacts, label: 'Open Food Facts', num: 1 },
      { fn: searchUPCItemDB,     label: 'UPC Item DB',     num: 2 },
      { fn: searchOpenEAN,       label: 'Open EAN',        num: 3 },
    ];

    for (const level of levels) {
      onProgress && onProgress(level.num, 'searching', level.label);
      try {
        const product = await level.fn(barcode);
        onProgress && onProgress(level.num, 'success', level.label);
        return { product, level: level.num, source: level.label };
      } catch (err) {
        onProgress && onProgress(level.num, 'fail', level.label);
        console.warn(`[API L${level.num}] ${level.label}:`, err.message);
      }
    }

    throw new Error('Producto no encontrado en ninguna base de datos');
  }

  return { search };
})();
