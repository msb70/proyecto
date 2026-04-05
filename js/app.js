/**
 * app.js — Main application controller
 */

(function () {
  'use strict';

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  let scanner       = null;
  let scannerActive = false;
  let currentBarcode = '';
  let currentProduct = null;

  // -------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (el) el.style.display = ''; };
  const hide = id => { const el = $(id); if (el) el.style.display = 'none'; };

  function showEl(id, displayType = '') {
    const el = $(id);
    if (el) el.style.display = displayType || 'block';
  }

  // -------------------------------------------------------
  // Toast notifications
  // -------------------------------------------------------
  function toast(msg, type = 'default', duration = 3000) {
    const icons = { success: '✓', error: '✕', info: 'ℹ', default: '✦' };
    const container = $('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || icons.default}</span><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('hiding');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }

  // -------------------------------------------------------
  // Confirm dialog
  // -------------------------------------------------------
  function confirm(msg) {
    return new Promise(resolve => {
      $('dialog-msg').textContent = msg;
      $('dialog-overlay').style.display = 'flex';
      const cleanup = () => { $('dialog-overlay').style.display = 'none'; };
      $('dialog-confirm').onclick = () => { cleanup(); resolve(true); };
      $('dialog-cancel').onclick  = () => { cleanup(); resolve(false); };
    });
  }

  // -------------------------------------------------------
  // Tab navigation
  // -------------------------------------------------------
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        $(`tab-${tab}`).classList.add('active');
        if (tab === 'inventory') renderInventory();
      });
    });
  }

  // -------------------------------------------------------
  // Scanner
  // -------------------------------------------------------
  function initScanner() {
    $('btn-start-scan').addEventListener('click', startScanner);
    $('btn-stop-scan').addEventListener('click', stopScanner);
    $('btn-manual').addEventListener('click', toggleManualInput);
    $('btn-search-manual').addEventListener('click', () => {
      const code = $('manual-barcode').value.trim();
      if (code) searchBarcode(code);
    });
    $('manual-barcode').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const code = $('manual-barcode').value.trim();
        if (code) searchBarcode(code);
      }
    });
  }

  function startScanner() {
    if (scannerActive) return;

    // Reset UI
    hideResults();

    scanner = new Html5Qrcode('reader');
    const config = {
      fps: 15,
      qrbox: { width: 260, height: 120 },
      aspectRatio: 1.0,
      supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
      ],
    };

    scanner.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      () => {}  // suppress per-frame errors
    ).then(() => {
      scannerActive = true;
      $('btn-start-scan').style.display = 'none';
      showEl('btn-stop-scan', 'inline-flex');
      $('viewfinder-wrap').classList.add('active-scan');
    }).catch(err => {
      console.error('Camera error:', err);
      toast('No se pudo acceder a la cámara. Usa el modo manual.', 'error');
    });
  }

  function stopScanner() {
    if (!scanner || !scannerActive) return;
    scanner.stop().then(() => {
      scanner.clear();
      scannerActive = false;
      $('btn-start-scan').style.display = '';
      $('btn-stop-scan').style.display = 'none';
    }).catch(console.warn);
  }

  function onScanSuccess(decodedText) {
    if (decodedText === currentBarcode) return; // debounce same code
    stopScanner();
    searchBarcode(decodedText);
  }

  function toggleManualInput() {
    const mi = $('manual-input');
    if (mi.style.display === 'none') {
      mi.style.display = 'block';
      $('manual-barcode').focus();
    } else {
      mi.style.display = 'none';
    }
  }

  // -------------------------------------------------------
  // Search flow
  // -------------------------------------------------------
  function hideResults() {
    hide('product-card');
    hide('not-found');
    hide('manual-add-form');
    hide('search-status');
    // Reset steps
    [1, 2, 3].forEach(n => {
      const step = $(`step-${n}`);
      if (step) step.className = 'status-step';
    });
  }

  async function searchBarcode(barcode) {
    currentBarcode = barcode;
    currentProduct = null;

    hideResults();
    hide('manual-input');

    // Show search status
    showEl('search-status', 'block');
    $('status-text').textContent = 'Iniciando búsqueda...';

    function onProgress(level, state, label) {
      const step = $(`step-${level}`);
      if (!step) return;
      step.className = `status-step ${state}`;
      if (state === 'searching') {
        $('status-text').textContent = `Buscando en ${label}...`;
      } else if (state === 'success') {
        $('status-text').textContent = `Encontrado en ${label} ✓`;
      } else if (state === 'fail') {
        $('status-text').textContent = `No encontrado en ${label}, probando siguiente...`;
      }
    }

    try {
      const { product } = await ProductAPI.search(barcode, onProgress);
      currentProduct = product;
      showProductCard(barcode, product);
    } catch {
      showNotFound(barcode);
    }
  }

  // -------------------------------------------------------
  // Product display
  // -------------------------------------------------------
  function showProductCard(barcode, product) {
    // Image
    const img = $('product-img');
    const placeholder = $('product-img-placeholder');
    if (product.image) {
      img.src = product.image;
      img.style.display = 'block';
      placeholder.style.display = 'none';
      img.onerror = () => {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
      };
    } else {
      img.style.display = 'none';
      placeholder.style.display = 'flex';
    }

    // Meta
    $('product-source').textContent = product.source;
    $('product-barcode-display').textContent = barcode;

    // Body
    $('product-name').textContent = product.name;
    $('product-brand').textContent = product.brand;
    $('product-brand').style.display = product.brand ? '' : 'none';
    $('product-desc').textContent = product.description;
    $('product-desc').style.display = product.description ? '' : 'none';

    // Tags
    const tagsEl = $('product-tags');
    tagsEl.innerHTML = '';
    product.categories.forEach(cat => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = cat;
      tagsEl.appendChild(tag);
    });

    // Kosher badge
    if (product.isKosher) {
      showEl('kosher-badge', 'flex');
    } else {
      hide('kosher-badge');
    }

    // Reset form
    $('qty-input').value = 1;
    $('cost-input').value = '';
    $('note-input').value = '';

    showEl('product-card', 'block');
  }

  function showNotFound(barcode) {
    $('not-found-code').textContent = `Código: ${barcode}`;
    showEl('not-found', 'block');
  }

  // -------------------------------------------------------
  // Quantity controls
  // -------------------------------------------------------
  function initQtyControls() {
    function bindQty(minusId, plusId, inputId) {
      $(minusId).addEventListener('click', () => {
        const inp = $(inputId);
        const v = parseInt(inp.value, 10) || 1;
        inp.value = Math.max(1, v - 1);
      });
      $(plusId).addEventListener('click', () => {
        const inp = $(inputId);
        const v = parseInt(inp.value, 10) || 1;
        inp.value = Math.min(9999, v + 1);
      });
    }
    bindQty('qty-minus', 'qty-plus', 'qty-input');
    bindQty('manual-qty-minus', 'manual-qty-plus', 'manual-qty-input');
  }

  // -------------------------------------------------------
  // Add to inventory
  // -------------------------------------------------------
  function initInventoryActions() {
    // Add from product card
    $('btn-add-inventory').addEventListener('click', () => {
      if (!currentProduct && !currentBarcode) return;
      const qty  = parseInt($('qty-input').value, 10)   || 1;
      const cost = parseFloat($('cost-input').value)    || 0;
      const note = $('note-input').value.trim();

      Inventory.addEntry({
        barcode:     currentBarcode,
        name:        currentProduct.name,
        brand:       currentProduct.brand,
        description: currentProduct.description,
        image:       currentProduct.image,
        source:      currentProduct.source,
        categories:  currentProduct.categories,
        labels:      currentProduct.labels,
        isKosher:    currentProduct.isKosher,
        quantity:    qty,
        cost,
        note,
      });

      toast(`"${currentProduct.name}" agregado al inventario`, 'success');
      updateStats();
      hideResults();
      resetScannerView();
    });

    // Scan again
    ['btn-scan-again', 'btn-scan-again-2'].forEach(id => {
      $(id).addEventListener('click', () => {
        hideResults();
        currentBarcode = '';
        currentProduct = null;
        resetScannerView();
      });
    });

    // Not found → add manually
    $('btn-add-manual-product').addEventListener('click', () => {
      hide('not-found');
      hide('search-status');
      showEl('manual-add-form', 'block');
    });

    // Save manual product
    $('btn-save-manual').addEventListener('click', () => {
      const name = $('manual-name').value.trim();
      if (!name) { toast('El nombre del producto es requerido', 'error'); return; }

      const qty  = parseInt($('manual-qty-input').value, 10) || 1;
      const cost = parseFloat($('manual-cost-input').value)  || 0;

      Inventory.addEntry({
        barcode:     currentBarcode,
        name,
        brand:       $('manual-brand').value.trim(),
        description: $('manual-description').value.trim(),
        source:      'Manual',
        quantity:    qty,
        cost,
      });

      toast(`"${name}" guardado en inventario`, 'success');
      updateStats();

      // Clear form
      ['manual-name', 'manual-brand', 'manual-description', 'manual-cost-input'].forEach(id => {
        $(id).value = '';
      });
      $('manual-qty-input').value = 1;
      hide('manual-add-form');
      currentBarcode = '';
      resetScannerView();
    });

    $('btn-cancel-manual').addEventListener('click', () => {
      hide('manual-add-form');
    });
  }

  function resetScannerView() {
    // Re-show scanner start button if camera not active
    if (!scannerActive) {
      $('btn-start-scan').style.display = '';
    }
  }

  // -------------------------------------------------------
  // Inventory render
  // -------------------------------------------------------
  function renderInventory(query = '') {
    updateStats();
    const items = query ? Inventory.filter(query) : Inventory.getAll();
    const list  = $('inventory-list');
    const empty = $('empty-inventory');

    // Remove old items (keep empty placeholder)
    list.querySelectorAll('.inv-item').forEach(el => el.remove());

    if (items.length === 0) {
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';

    items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'inv-item';
      el.dataset.id = item.id;

      const totalVal = (item.quantity * item.cost).toFixed(2);
      const dateStr  = new Date(item.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });

      el.innerHTML = `
        <span class="inv-item-num">${idx + 1}</span>
        <div class="inv-item-body">
          <div class="inv-item-name">${escHtml(item.name)}</div>
          <div class="inv-item-sub">
            ${item.brand ? `<span>🏷 ${escHtml(item.brand)}</span>` : ''}
            ${item.barcode ? `<span>📊 ${escHtml(item.barcode)}</span>` : ''}
            ${item.cost > 0 ? `<span>$ ${item.cost.toFixed(2)} c/u · Total: $${totalVal}</span>` : ''}
            ${item.isKosher ? `<span style="color:#7dc45f">✡ Kosher</span>` : ''}
            <span>📅 ${dateStr}</span>
          </div>
          ${item.note ? `<div class="inv-item-sub"><span>💬 ${escHtml(item.note)}</span></div>` : ''}
        </div>
        <div class="inv-item-right">
          <span class="inv-qty">${item.quantity}</span>
          <span class="inv-qty-label">uds</span>
          <div class="inv-item-actions">
            <button class="inv-action-btn" data-action="delete" title="Eliminar">
              <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        </div>
      `;

      // Delete action
      el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        const ok = await confirm(`¿Eliminar "${item.name}" del inventario?`);
        if (ok) {
          Inventory.removeEntry(item.id);
          renderInventory($('inventory-search').value);
          toast(`"${item.name}" eliminado`, 'info');
        }
      });

      list.appendChild(el);
    });
  }

  function updateStats() {
    const { totalItems, totalUnits, totalValue } = Inventory.getStats();
    $('stat-items').textContent  = totalItems;
    $('stat-units').textContent  = totalUnits;
    $('stat-value').textContent  = totalValue > 0
      ? `$${totalValue.toFixed(totalValue < 1000 ? 2 : 0)}`
      : '$0';
  }

  function initInventoryTab() {
    // Search
    $('inventory-search').addEventListener('input', e => {
      renderInventory(e.target.value);
    });

    // Export CSV
    $('btn-export').addEventListener('click', () => {
      const ok = Inventory.exportCSV();
      if (ok) toast('Inventario exportado como CSV', 'success');
      else    toast('El inventario está vacío', 'info');
    });

    // Clear all
    $('btn-clear-inventory').addEventListener('click', async () => {
      const { totalItems } = Inventory.getStats();
      if (totalItems === 0) { toast('El inventario ya está vacío', 'info'); return; }
      const ok = await confirm(`¿Limpiar todo el inventario? (${totalItems} productos)`);
      if (ok) {
        Inventory.clearAll();
        renderInventory();
        toast('Inventario limpiado', 'info');
      }
    });
  }

  // -------------------------------------------------------
  // Utility
  // -------------------------------------------------------
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------
  function init() {
    initTabs();
    initScanner();
    initQtyControls();
    initInventoryActions();
    initInventoryTab();
    updateStats();
    console.log('✦ ScanStock ready');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
