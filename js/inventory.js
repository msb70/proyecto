/**
 * inventory.js — Local inventory management using localStorage
 */

const Inventory = (() => {
  const KEY = 'scanstock_inventory';

  // -------------------------------------------------------
  // CRUD
  // -------------------------------------------------------
  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  }

  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  function getAll() {
    return load();
  }

  function addEntry({ barcode, name, brand, description, image, source, quantity, cost, note, categories, labels, isKosher }) {
    const items = load();

    const entry = {
      id:          Date.now(),
      barcode:     barcode || '',
      name:        name   || 'Producto sin nombre',
      brand:       brand  || '',
      description: description || '',
      image:       image  || '',
      source:      source || 'Manual',
      quantity:    parseInt(quantity, 10) || 1,
      cost:        parseFloat(cost) || 0,
      note:        note   || '',
      categories:  categories || [],
      labels:      labels || [],
      isKosher:    !!isKosher,
      createdAt:   new Date().toISOString(),
    };

    items.unshift(entry);   // newest first
    save(items);
    return entry;
  }

  function removeEntry(id) {
    const items = load().filter(i => i.id !== id);
    save(items);
  }

  function updateQuantity(id, delta) {
    const items = load();
    const idx = items.findIndex(i => i.id === id);
    if (idx !== -1) {
      items[idx].quantity = Math.max(0, items[idx].quantity + delta);
      if (items[idx].quantity === 0) {
        items.splice(idx, 1);
      }
      save(items);
    }
  }

  function clearAll() {
    save([]);
  }

  // -------------------------------------------------------
  // Stats
  // -------------------------------------------------------
  function getStats() {
    const items = load();
    const totalItems = items.length;
    const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
    const totalValue = items.reduce((s, i) => s + i.quantity * i.cost, 0);
    return { totalItems, totalUnits, totalValue };
  }

  // -------------------------------------------------------
  // Search / filter
  // -------------------------------------------------------
  function filter(query) {
    const q = query.toLowerCase().trim();
    if (!q) return load();
    return load().filter(i =>
      i.name.toLowerCase().includes(q)  ||
      i.brand.toLowerCase().includes(q) ||
      i.barcode.includes(q)
    );
  }

  // -------------------------------------------------------
  // Export to CSV
  // -------------------------------------------------------
  function exportCSV() {
    const items = load();
    if (items.length === 0) return null;

    const headers = ['ID', 'Código', 'Nombre', 'Marca', 'Descripción', 'Cantidad', 'Costo', 'Valor Total', 'Nota', 'Kosher', 'Fuente', 'Fecha'];
    const rows = items.map(i => [
      i.id,
      `"${i.barcode}"`,
      `"${i.name.replace(/"/g, '""')}"`,
      `"${i.brand.replace(/"/g, '""')}"`,
      `"${i.description.replace(/"/g, '""').substring(0, 100)}"`,
      i.quantity,
      i.cost.toFixed(2),
      (i.quantity * i.cost).toFixed(2),
      `"${(i.note || '').replace(/"/g, '""')}"`,
      i.isKosher ? 'Sí' : 'No',
      `"${i.source}"`,
      new Date(i.createdAt).toLocaleDateString('es-VE'),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `inventario_scanstock_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  return { getAll, addEntry, removeEntry, updateQuantity, clearAll, getStats, filter, exportCSV };
})();
