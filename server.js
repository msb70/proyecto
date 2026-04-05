'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------
const PORT   = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'inventory.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL for better concurrency
db.pragma('journal_mode = WAL');

// ----------------------------------------------------------------
// Schema
// ----------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS inventory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode     TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL,
    brand       TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    image       TEXT    NOT NULL DEFAULT '',
    source      TEXT    NOT NULL DEFAULT 'Manual',
    quantity    INTEGER NOT NULL DEFAULT 1,
    cost        REAL    NOT NULL DEFAULT 0,
    note        TEXT    NOT NULL DEFAULT '',
    categories  TEXT    NOT NULL DEFAULT '[]',
    labels      TEXT    NOT NULL DEFAULT '[]',
    is_kosher   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function parseItem(row) {
  if (!row) return null;
  return {
    id:          row.id,
    barcode:     row.barcode,
    name:        row.name,
    brand:       row.brand,
    description: row.description,
    image:       row.image,
    source:      row.source,
    quantity:    row.quantity,
    cost:        row.cost,
    note:        row.note,
    categories:  JSON.parse(row.categories || '[]'),
    labels:      JSON.parse(row.labels     || '[]'),
    isKosher:    row.is_kosher === 1,
    createdAt:   row.created_at,
  };
}

// Prepared statements
const stmts = {
  getAll:    db.prepare('SELECT * FROM inventory ORDER BY id DESC'),
  getById:   db.prepare('SELECT * FROM inventory WHERE id = ?'),
  search:    db.prepare(`SELECT * FROM inventory WHERE
                          lower(name)    LIKE lower(?) OR
                          lower(brand)   LIKE lower(?) OR
                          barcode        LIKE ?
                         ORDER BY id DESC`),
  insert:    db.prepare(`INSERT INTO inventory
                          (barcode, name, brand, description, image, source,
                           quantity, cost, note, categories, labels, is_kosher)
                         VALUES
                          (@barcode, @name, @brand, @description, @image, @source,
                           @quantity, @cost, @note, @categories, @labels, @is_kosher)`),
  delete:    db.prepare('DELETE FROM inventory WHERE id = ?'),
  clearAll:  db.prepare('DELETE FROM inventory'),
  stats:     db.prepare(`SELECT
                           COUNT(*)        AS total_items,
                           SUM(quantity)   AS total_units,
                           SUM(quantity * cost) AS total_value
                         FROM inventory`),
};

// ----------------------------------------------------------------
// Express app
// ----------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serve frontend

// ----------------------------------------------------------------
// API routes
// ----------------------------------------------------------------

// GET /api/inventory?q=query
app.get('/api/inventory', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = stmts.search.all(like, like, like);
  } else {
    rows = stmts.getAll.all();
  }
  res.json(rows.map(parseItem));
});

// GET /api/inventory/stats
app.get('/api/inventory/stats', (req, res) => {
  const row = stmts.stats.get();
  res.json({
    totalItems: row.total_items  || 0,
    totalUnits: row.total_units  || 0,
    totalValue: row.total_value  || 0,
  });
});

// GET /api/inventory/export.csv
app.get('/api/inventory/export.csv', (req, res) => {
  const rows  = stmts.getAll.all().map(parseItem);
  const BOM   = '\uFEFF';
  const headers = ['ID','Código','Nombre','Marca','Descripción','Cantidad','Costo','Valor Total','Nota','Kosher','Fuente','Fecha'];

  const csvRows = rows.map(i => [
    i.id,
    `"${i.barcode}"`,
    `"${i.name.replace(/"/g,'""')}"`,
    `"${i.brand.replace(/"/g,'""')}"`,
    `"${i.description.replace(/"/g,'""').substring(0,100)}"`,
    i.quantity,
    i.cost.toFixed(2),
    (i.quantity * i.cost).toFixed(2),
    `"${(i.note||'').replace(/"/g,'""')}"`,
    i.isKosher ? 'Sí' : 'No',
    `"${i.source}"`,
    new Date(i.createdAt).toLocaleDateString('es-VE'),
  ]);

  const csv = BOM + [headers.join(','), ...csvRows.map(r => r.join(','))].join('\r\n');
  const today = new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="inventario_acme_${today}.csv"`);
  res.send(csv);
});

// POST /api/inventory
app.post('/api/inventory', (req, res) => {
  const b = req.body;
  if (!b || !b.name) {
    return res.status(400).json({ error: 'El campo "name" es requerido' });
  }

  const result = stmts.insert.run({
    barcode:     String(b.barcode     || ''),
    name:        String(b.name),
    brand:       String(b.brand       || ''),
    description: String(b.description || ''),
    image:       String(b.image       || ''),
    source:      String(b.source      || 'Manual'),
    quantity:    parseInt(b.quantity, 10)  || 1,
    cost:        parseFloat(b.cost)        || 0,
    note:        String(b.note        || ''),
    categories:  JSON.stringify(Array.isArray(b.categories) ? b.categories : []),
    labels:      JSON.stringify(Array.isArray(b.labels)     ? b.labels     : []),
    is_kosher:   b.isKosher ? 1 : 0,
  });

  const created = parseItem(stmts.getById.get(result.lastInsertRowid));
  res.status(201).json(created);
});

// DELETE /api/inventory/:id
app.delete('/api/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  stmts.delete.run(id);
  res.json({ ok: true });
});

// DELETE /api/inventory  (clear all)
app.delete('/api/inventory', (req, res) => {
  stmts.clearAll.run();
  res.json({ ok: true });
});

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✦ Bodegón Acme — ScanStock corriendo en http://localhost:${PORT}`);
});
