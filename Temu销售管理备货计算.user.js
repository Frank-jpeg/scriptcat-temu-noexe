// ==UserScript==
// @name         Temu 销售管理备货计算
// @namespace    http://tampermonkey.net/
// @version      2026.0702.1
// @description  在 Temu 销售管理页按近7天销量、备货天数、仓内可用库存和已发货库存计算每个颜色/SKU需要备货的数量
// @author       Codex
// @match        https://agentseller.temu.com/stock/fully-mgt/sale-manage/main*
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/Temu%E9%94%80%E5%94%AE%E7%AE%A1%E7%90%86%E5%A4%87%E8%B4%A7%E8%AE%A1%E7%AE%97.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/Temu%E9%94%80%E5%94%AE%E7%AE%A1%E7%90%86%E5%A4%87%E8%B4%A7%E8%AE%A1%E7%AE%97.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP_ID = 'temu-stock-calculator';
  const DEFAULT_DAYS = 14;
  const STORAGE_KEY = 'temu-stock-calculator-days';

  const state = {
    root: null,
    button: null,
    panel: null,
    daysInput: null,
    resultBox: null,
    opened: false,
    textItems: null
  };

  function init() {
    if (document.getElementById(APP_ID)) return;

    injectStyle();

    const root = document.createElement('div');
    root.id = APP_ID;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tsc-float-button';
    button.textContent = '备货计算';
    button.addEventListener('click', openPanel);

    const panel = document.createElement('section');
    panel.className = 'tsc-panel';
    panel.hidden = true;
    panel.appendChild(createPanelHeader());
    panel.appendChild(createControlBar());

    const resultBox = document.createElement('div');
    resultBox.className = 'tsc-result';
    panel.appendChild(resultBox);

    root.appendChild(button);
    root.appendChild(panel);

    state.root = root;
    state.button = button;
    state.panel = panel;
    state.resultBox = resultBox;

    mountRoot();
  }

  function mountRoot() {
    if (!state.root) return;

    const anchor = findToolbarAnchorButton();
    if (anchor?.parentElement) {
      if (state.root.parentElement !== anchor.parentElement || anchor.nextElementSibling !== state.root) {
        anchor.insertAdjacentElement('afterend', state.root);
      }
      state.root.classList.add('tsc-embedded');
      state.root.classList.remove('tsc-floating');
      return;
    }

    if (state.root.parentElement !== document.body) {
      document.body.appendChild(state.root);
    }
    state.root.classList.add('tsc-floating');
    state.root.classList.remove('tsc-embedded');
  }

  function findToolbarAnchorButton() {
    const buttons = [...document.querySelectorAll('button')];
    return buttons.find((button) => normalizeTextKey(button.innerText || button.textContent) === 'Excel修改卖家仓库存')
      || buttons.find((button) => normalizeTextKey(button.innerText || button.textContent) === '期望到货区域设置')
      || buttons.find((button) => normalizeTextKey(button.innerText || button.textContent) === '批量申请备货');
  }

  function injectStyle() {
    if (document.getElementById(`${APP_ID}-style`)) return;

    const style = document.createElement('style');
    style.id = `${APP_ID}-style`;
    style.textContent = `
      #${APP_ID} {
        z-index: 2147483000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937;
      }
      #${APP_ID}.tsc-floating {
        position: fixed;
        right: 18px;
        top: 118px;
      }
      #${APP_ID}.tsc-embedded {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        height: 28px;
        vertical-align: top;
      }
      #${APP_ID}.tsc-scanning {
        pointer-events: none !important;
        visibility: hidden !important;
      }
      #${APP_ID} * {
        box-sizing: border-box;
      }
      #${APP_ID} .tsc-float-button {
        width: 86px;
        height: 28px;
        border: 0;
        border-radius: 4px;
        background: #1677ff;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: none;
      }
      #${APP_ID} .tsc-float-button:hover {
        background: #0958d9;
      }
      #${APP_ID} .tsc-panel {
        position: fixed;
        right: 18px;
        top: 92px;
        z-index: 2147483001;
        width: min(620px, calc(100vw - 36px));
        max-height: calc(100vh - 150px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid #d9dee8;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.20);
      }
      #${APP_ID} .tsc-panel[hidden] {
        display: none !important;
      }
      #${APP_ID} .tsc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-bottom: 1px solid #eef1f6;
      }
      #${APP_ID} .tsc-title {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
      }
      #${APP_ID} .tsc-close {
        width: 28px;
        height: 28px;
        border: 1px solid #d9dee8;
        border-radius: 6px;
        background: #fff;
        color: #4b5563;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      #${APP_ID} .tsc-close:hover {
        background: #f3f6fb;
      }
      #${APP_ID} .tsc-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid #eef1f6;
        background: #f8fafc;
      }
      #${APP_ID} .tsc-controls label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        white-space: nowrap;
      }
      #${APP_ID} .tsc-days {
        width: 76px;
        height: 30px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 0 8px;
        font-size: 13px;
      }
      #${APP_ID} .tsc-primary {
        height: 30px;
        border: 0;
        border-radius: 6px;
        padding: 0 12px;
        background: #1677ff;
        color: #fff;
        font-size: 13px;
        cursor: pointer;
      }
      #${APP_ID} .tsc-primary:hover {
        background: #0958d9;
      }
      #${APP_ID} .tsc-result {
        overflow: auto;
        padding: 12px 14px 14px;
      }
      #${APP_ID} .tsc-product {
        display: grid;
        grid-template-columns: 58px 1fr;
        gap: 10px;
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fbfdff;
        margin-bottom: 10px;
      }
      #${APP_ID} .tsc-product-img {
        width: 58px;
        height: 58px;
        border-radius: 6px;
        object-fit: cover;
        background: #edf2f7;
        border: 1px solid #e5e7eb;
      }
      #${APP_ID} .tsc-product-placeholder {
        width: 58px;
        height: 58px;
        border-radius: 6px;
        background: #edf2f7;
        border: 1px solid #e5e7eb;
      }
      #${APP_ID} .tsc-product-name {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
        max-height: 36px;
        overflow: hidden;
      }
      #${APP_ID} .tsc-meta {
        margin-top: 5px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 12px;
        color: #64748b;
      }
      #${APP_ID} .tsc-chip {
        padding: 2px 6px;
        border-radius: 4px;
        background: #eef2ff;
        color: #334155;
      }
      #${APP_ID} .tsc-warning {
        margin: 8px 0 10px;
        padding: 8px 10px;
        border: 1px solid #fde68a;
        border-radius: 6px;
        background: #fffbeb;
        color: #92400e;
        font-size: 12px;
        line-height: 1.5;
      }
      #${APP_ID} .tsc-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      #${APP_ID} .tsc-table th,
      #${APP_ID} .tsc-table td {
        border: 1px solid #e5e7eb;
        padding: 7px 6px;
        text-align: right;
        vertical-align: middle;
        word-break: break-word;
      }
      #${APP_ID} .tsc-table th {
        background: #f8fafc;
        color: #475569;
        font-weight: 700;
      }
      #${APP_ID} .tsc-table td:first-child,
      #${APP_ID} .tsc-table th:first-child,
      #${APP_ID} .tsc-table td:nth-child(2),
      #${APP_ID} .tsc-table th:nth-child(2) {
        text-align: left;
      }
      #${APP_ID} .tsc-need {
        font-size: 14px;
        font-weight: 800;
        color: #dc2626;
      }
      #${APP_ID} .tsc-empty {
        padding: 18px 8px;
        text-align: center;
        color: #64748b;
        font-size: 13px;
      }
    `;
    document.head.appendChild(style);
  }

  function createPanelHeader() {
    const header = document.createElement('div');
    header.className = 'tsc-header';

    const title = document.createElement('div');
    title.className = 'tsc-title';
    title.textContent = 'Temu 备货计算';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tsc-close';
    close.textContent = '×';
    close.title = '关闭';
    close.addEventListener('click', closePanel);

    header.appendChild(title);
    header.appendChild(close);
    return header;
  }

  function createControlBar() {
    const controls = document.createElement('div');
    controls.className = 'tsc-controls';

    const label = document.createElement('label');
    label.textContent = '备货天数';

    const input = document.createElement('input');
    input.className = 'tsc-days';
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = getSavedDays();
    input.addEventListener('change', () => {
      saveDays(getDays());
      calculateAndRender();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') calculateAndRender();
    });
    state.daysInput = input;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tsc-primary';
    button.textContent = '重新计算';
    button.addEventListener('click', calculateAndRender);

    label.appendChild(input);
    controls.appendChild(label);
    controls.appendChild(button);
    return controls;
  }

  function openPanel() {
    state.opened = true;
    state.button.hidden = true;
    state.panel.hidden = false;
    calculateAndRender();
  }

  function closePanel() {
    state.opened = false;
    state.panel.hidden = true;
    state.button.hidden = false;
  }

  function getSavedDays() {
    const saved = Number(readSavedDays());
    return Number.isFinite(saved) && saved > 0 ? String(Math.floor(saved)) : String(DEFAULT_DAYS);
  }

  function getDays() {
    const value = Number(state.daysInput?.value || DEFAULT_DAYS);
    if (!Number.isFinite(value) || value <= 0) {
      state.daysInput.value = String(DEFAULT_DAYS);
      return DEFAULT_DAYS;
    }
    const days = Math.floor(value);
    state.daysInput.value = String(days);
    return days;
  }

  function readSavedDays() {
    try {
      return window.localStorage?.getItem(STORAGE_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function saveDays(days) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(days));
    } catch (error) {
      // localStorage may be unavailable in some injected or restricted documents.
    }
  }

  function calculateAndRender() {
    const days = getDays();
    saveDays(days);

    const data = scanPageSafely(days);
    render(data);
  }

  function scanPageSafely(days) {
    const root = state.root;
    root.classList.add('tsc-scanning');
    try {
      return collectPageData(days);
    } catch (error) {
      return {
        product: createFallbackProduct([], []),
        rows: [],
        warnings: [`脚本读取页面失败：${error?.message || error}`]
      };
    } finally {
      root.classList.remove('tsc-scanning');
    }
  }

  function collectPageData(days) {
    const warnings = [];
    const previousTextItems = state.textItems;
    state.textItems = collectVisibleTextItems();

    try {
      const headers = findHeaders();
      const missingHeaders = [];

      if (!headers.weekSales) missingHeaders.push('销售数据-近7天');
      if (!headers.availableStock) missingHeaders.push('仓内可用库存');
      if (!headers.shippedStock) missingHeaders.push('已发货库存');

      const skuCells = findSkuCells();
      const rows = skuCells.map((skuCell) => buildSkuResult(skuCell, headers, days)).filter(Boolean);
      const product = detectProduct(skuCells, rows);

      if (!rows.length) {
        warnings.push('未检测到 SKU 行。请确认当前页已搜索出商品，并且 SKU 信息区域可见。');
      }

      rows.forEach((row) => {
        if (row.missing.length) {
          warnings.push(`${row.color || row.skuId || '某个SKU'} 缺少字段：${row.missing.join('、')}`);
        }
      });

      if (missingHeaders.length && rows.some((row) => row.missing.length)) {
        warnings.unshift(`未检测到 ${missingHeaders.join('、')} 列。如果仍有 SKU 缺数据，请把表格横向滚动到“销售数据 / 库存数据”区域后点击“重新计算”。`);
      }

      return { product, rows, warnings: dedupe(warnings) };
    } finally {
      state.textItems = previousTextItems;
    }
  }

  function findHeaders() {
    const weekSalesCandidates = findTextMatches((text) => normalizeTextKey(text) === '近7天');
    const availableCandidates = findTextMatches((text) => normalizeTextKey(text) === '仓内可用库存');
    const shippedCandidates = findTextMatches((text) => normalizeTextKey(text) === '已发货库存');

    return {
      weekSales: chooseHeader(weekSalesCandidates, '销售数据'),
      availableStock: chooseHeader(availableCandidates, '库存数据'),
      shippedStock: chooseHeader(shippedCandidates, '库存数据')
    };
  }

  function chooseHeader(candidates, groupText) {
    const visible = candidates
      .filter((item) => isRectUsable(item.rect))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    if (!visible.length) return null;

    const groupCandidates = findTextMatches((text) => normalizeTextKey(text).includes(groupText)).filter((item) => isRectUsable(item.rect));
    if (!groupCandidates.length) return visible[0];

    let best = visible[0];
    let bestScore = Number.POSITIVE_INFINITY;

    visible.forEach((candidate) => {
      const centerX = candidate.rect.left + candidate.rect.width / 2;
      const score = Math.min(...groupCandidates.map((group) => {
        const groupCenterX = group.rect.left + group.rect.width / 2;
        const verticalPenalty = Math.max(0, candidate.rect.top - group.rect.bottom);
        const horizontalPenalty = Math.abs(centerX - groupCenterX);
        return verticalPenalty * 3 + horizontalPenalty;
      }));

      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return {
      text: best.text,
      x: best.rect.left + best.rect.width / 2,
      rect: best.rect
    };
  }

  function findSkuCells() {
    const splitRows = findSkuRowsFromTextItems();
    if (splitRows.length) return splitRows;

    const matches = findTextMatches((text) => /SKU\s*ID\s*[:：]\s*[A-Za-z0-9_-]+/.test(text));
    const seen = new Set();
    const skuCells = [];

    matches.forEach((match) => {
      const cell = findSkuCell(match.element);
      if (!cell) return;

      const info = parseSkuInfo(getElementText(cell));
      const key = info.skuId || getElementText(cell);
      if (!key || seen.has(key)) return;

      seen.add(key);
      skuCells.push({ element: cell, rect: cell.getBoundingClientRect(), info });
    });

    return skuCells.sort((a, b) => a.rect.top - b.rect.top);
  }

  function findSkuRowsFromTextItems() {
    const items = state.textItems || collectVisibleTextItems();
    const seen = new Set();
    const rows = [];

    items.forEach((item, index) => {
      const text = normalizeTextKey(item.text);
      let skuId = pickMatch(text, /SKUID[:：]?([A-Za-z0-9_-]{4,})/i);
      let valueItem = item;

      if (!skuId && isSkuIdLabel(text)) {
        valueItem = findNextValueItem(items, index, looksLikeSkuId);
        skuId = valueItem?.text ? normalizeTextKey(valueItem.text) : '';
      }

      if (!skuId || seen.has(skuId)) return;

      const colorItem = findColorItemBefore(items, index);
      const skuNoLabelIndex = findNextLabelIndex(items, index, isSkuNoLabel, 8);
      const skuNoItem = skuNoLabelIndex >= 0 ? findNextValueItem(items, skuNoLabelIndex, looksLikeSkuNo) : null;
      const rect = unionRects([colorItem?.rect, item.rect, valueItem?.rect].filter(Boolean));

      seen.add(skuId);
      rows.push({
        element: item.element,
        rect,
        sourceIndex: index,
        info: {
          color: colorItem?.text || '未识别颜色',
          skuId,
          skuNo: skuNoItem?.text ? normalizeTextKey(skuNoItem.text) : ''
        }
      });
    });

    return rows.sort((a, b) => a.rect.top - b.rect.top);
  }

  function buildSkuResult(skuCell, headers, days) {
    const rect = skuCell.rect || skuCell.element.getBoundingClientRect();
    const y = clamp(rect.top + rect.height / 2, 1, window.innerHeight - 1);
    const info = skuCell.info;
    const missing = [];
    const sequenceMetrics = readRowMetricsFromSequence(skuCell);

    const weekSales = sequenceMetrics
      ? { ok: true, value: sequenceMetrics.sales7 }
      : readNumberFromHeader(headers.weekSales, y);
    const availableStock = sequenceMetrics
      ? { ok: true, value: sequenceMetrics.available }
      : readNumberFromHeader(headers.availableStock, y);
    const shippedStock = sequenceMetrics
      ? { ok: true, value: sequenceMetrics.shipped }
      : readNumberFromHeader(headers.shippedStock, y);

    if (!weekSales.ok) missing.push('近7天');
    if (!availableStock.ok) missing.push('仓内可用库存');
    if (!shippedStock.ok) missing.push('已发货库存');

    const sales7 = weekSales.ok ? weekSales.value : 0;
    const available = availableStock.ok ? availableStock.value : 0;
    const shipped = shippedStock.ok ? shippedStock.value : 0;
    const rawNeed = (sales7 / 7) * days - available - shipped;
    const need = Math.max(0, Math.ceil(rawNeed));

    return {
      color: info.color,
      skuId: info.skuId,
      skuNo: info.skuNo,
      sales7,
      available,
      shipped,
      need,
      missing
    };
  }

  function readRowMetricsFromSequence(skuCell) {
    const items = state.textItems || [];
    if (!Number.isFinite(skuCell.sourceIndex) || !items.length) return null;

    const start = skuCell.sourceIndex;
    const end = findRowSequenceEnd(items, start);
    const statusIndex = findRowStatusIndex(items, start, end);
    if (statusIndex < 0) return null;

    const values = [];
    for (let index = statusIndex + 1; index < end; index += 1) {
      const value = parsePlainNumber(items[index].text);
      if (Number.isFinite(value)) values.push(value);
    }

    if (values.length < 11) return null;

    return {
      sales7: values[5],
      available: values[7],
      shipped: values[10]
    };
  }

  function findRowSequenceEnd(items, start) {
    const limits = [Math.min(items.length, start + 90)];

    for (let index = start + 1; index < items.length; index += 1) {
      const text = normalizeTextKey(items[index].text);
      if (isSkuIdLabel(text)) {
        limits.push(index);
        break;
      }
    }

    for (let index = start + 1; index < items.length; index += 1) {
      const text = normalizeTextKey(items[index].text);
      if (/^更新时间[:：]?$/.test(text)) {
        limits.push(index);
        break;
      }
    }

    return Math.min(...limits);
  }

  function findRowStatusIndex(items, start, end) {
    for (let index = start + 1; index < end; index += 1) {
      const text = normalizeTextKey(items[index].text);
      if (/^(已生效|未生效|待生效|已失效)$/.test(text)) return index;
    }
    return -1;
  }

  function readNumberFromHeader(header, y) {
    if (!header || !Number.isFinite(header.x)) return { ok: false, value: 0, text: '' };

    const x = clamp(header.x, 1, window.innerWidth - 1);
    const text = readCellTextFromPoint(x, y);
    const value = parseNumber(text);

    if (!Number.isFinite(value)) return { ok: false, value: 0, text };
    return { ok: true, value, text };
  }

  function readCellTextFromPoint(x, y) {
    const elements = document.elementsFromPoint(x, y).filter((element) => !state.root.contains(element));
    const cell = findSmallestCellAtPoint(elements, x, y);
    if (cell) return getElementText(cell);

    const fallback = elements.find((element) => {
      const text = getElementText(element);
      return text && text.length <= 80;
    });
    return fallback ? getElementText(fallback) : '';
  }

  function findSmallestCellAtPoint(elements, x, y) {
    const candidates = [];

    elements.forEach((element) => {
      for (let current = element; current && current !== document.body; current = current.parentElement) {
        if (!isCellLike(current)) continue;
        const rect = current.getBoundingClientRect();
        if (!pointInRect(x, y, rect)) continue;
        candidates.push({ element: current, area: rect.width * rect.height });
      }
    });

    candidates.sort((a, b) => a.area - b.area);
    return candidates[0]?.element || null;
  }

  function isCellLike(element) {
    if (!element || element.nodeType !== 1) return false;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') || '';
    const className = String(element.className || '');

    if (tag === 'td' || tag === 'th') return true;
    if (/^(cell|gridcell|columnheader|rowheader)$/i.test(role)) return true;
    return /(cell|Cell|td|Td|bodyCell|BodyCell|table-cell|tableCell)/.test(className);
  }

  function findSkuCell(startElement) {
    let best = null;

    for (let current = startElement; current && current !== document.body; current = current.parentElement) {
      const text = getElementText(current);
      if (!/SKU\s*ID\s*[:：]/.test(text)) continue;

      const rect = current.getBoundingClientRect();
      if (!isRectUsable(rect) || rect.width < 90 || rect.height < 24) continue;

      const area = rect.width * rect.height;
      const hasSkuNo = /SKU\s*货号\s*[:：]/.test(text);
      const hasWarehouse = /备货仓组\s*[:：]/.test(text);
      const classScore = isCellLike(current) ? -100000 : 0;
      const contentScore = (hasSkuNo ? -50000 : 0) + (hasWarehouse ? -50000 : 0);
      const score = area + classScore + contentScore;

      if (!best || score < best.score) best = { element: current, score };
    }

    return best?.element || startElement;
  }

  function parseSkuInfo(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const compact = text.replace(/\s+/g, ' ');
    const skuId = pickMatch(compact, /SKU\s*ID\s*[:：]\s*([A-Za-z0-9_-]+)/);
    const skuNoRaw = pickMatch(text, /SKU\s*货号\s*[:：]\s*([\s\S]*?)(?:备货仓组|$)/);
    const skuNo = skuNoRaw ? skuNoRaw.replace(/\s+/g, '') : '';
    const skuLineIndex = lines.findIndex((line) => /SKU\s*ID\s*[:：]/.test(line));
    const color = skuLineIndex > 0 ? lines.slice(0, skuLineIndex).join(' ') : '';

    return {
      color: color || '未识别颜色',
      skuId,
      skuNo
    };
  }

  function detectProduct(skuCells, rows) {
    const textProduct = detectProductFromTextItems(skuCells, rows);
    if (textProduct.title !== '未识别商品标题' || textProduct.skc || textProduct.platformId || textProduct.image) {
      return textProduct;
    }

    const skuSourceElements = skuCells.map((item) => item.element);
    const skcMatches = findTextMatches((text) => /SKC\s*[:：]\s*[A-Za-z0-9_-]+/.test(text));
    const productElement = findBestProductElement(skcMatches, skuSourceElements);

    if (!productElement) return createFallbackProduct(skuCells, rows);

    const text = getElementText(productElement);
    const skc = pickMatch(text.replace(/\s+/g, ' '), /SKC\s*[:：]\s*([A-Za-z0-9_-]+)/);
    const platformId = pickMatch(text.replace(/\s+/g, ' '), /(?:商品\s*ID|平台商品\s*ID|SPU\s*ID|商品ID|平台商品ID)\s*[:：]\s*([A-Za-z0-9_-]+)/);
    const image = findProductImage(productElement);
    const title = detectProductTitle(text);

    return {
      title: title || '未识别商品标题',
      image,
      skc: skc || '',
      platformId: platformId || '',
      skuCount: rows.length || skuCells.length
    };
  }

  function detectProductFromTextItems(skuCells, rows) {
    const items = state.textItems || collectVisibleTextItems();
    const firstSkuIndex = skuCells.reduce((min, item) => Math.min(min, Number.isFinite(item.sourceIndex) ? item.sourceIndex : min), Number.POSITIVE_INFINITY);
    const skuSearchEnd = Number.isFinite(firstSkuIndex) ? firstSkuIndex : items.length;
    const productSearchEnd = items.length;

    let skc = '';
    let skcIndex = -1;
    for (let index = 0; index < productSearchEnd; index += 1) {
      const text = normalizeTextKey(items[index].text);
      const combined = pickMatch(text, /SKC[:：]?([A-Za-z0-9_-]{4,})/i);
      if (combined) {
        skc = combined;
        skcIndex = index;
        continue;
      }
      if (isSkcLabel(text)) {
        const valueItem = findNextValueItem(items, index, looksLikeSkuId);
        if (valueItem) {
          skc = normalizeTextKey(valueItem.text);
          skcIndex = index;
        }
      }
    }

    const title = skcIndex >= 0 ? findProductTitleBefore(items, skcIndex) : '';
    const spu = findLabelValueBefore(items, skuSearchEnd, 'SPU') || findLabelValueBefore(items, productSearchEnd, 'SPU');
    const image = findVisibleProductImage(skuCells[0]?.rect);

    return {
      title: title || '未识别商品标题',
      image,
      skc,
      platformId: spu,
      skuCount: rows.length || skuCells.length
    };
  }

  function findBestProductElement(skcMatches, skuSourceElements) {
    const skuSet = new Set(skuSourceElements);
    let best = null;

    skcMatches.forEach((match) => {
      for (let current = match.element; current && current !== document.body; current = current.parentElement) {
        const text = getElementText(current);
        if (!/SKC\s*[:：]/.test(text)) continue;

        const rect = current.getBoundingClientRect();
        if (!isRectUsable(rect) || rect.width < 120 || rect.height < 50) continue;
        if (skuSet.has(current)) continue;

        const hasImage = Boolean(current.querySelector('img'));
        const hasProductHints = /评论数|加入站点时长|SKC货号|国内备货|商品/.test(text);
        const area = rect.width * rect.height;
        const score = area + (hasImage ? -200000 : 0) + (hasProductHints ? -80000 : 0);

        if (!best || score < best.score) best = { element: current, score };
      }
    });

    return best?.element || null;
  }

  function findProductImage(productElement) {
    const image = [...productElement.querySelectorAll('img')].find((img) => {
      const rect = img.getBoundingClientRect();
      return rect.width >= 30 && rect.height >= 30 && img.src;
    });
    return image?.src || '';
  }

  function findVisibleProductImage(firstSkuRect) {
    const targetY = firstSkuRect ? firstSkuRect.top + 70 : window.innerHeight / 2;
    const maxLeft = firstSkuRect ? firstSkuRect.left : window.innerWidth * 0.5;
    const images = [...document.querySelectorAll('img')].map((img) => {
      const rect = img.getBoundingClientRect();
      return { img, rect };
    }).filter(({ img, rect }) => {
      if (!img.src || state.root.contains(img)) return false;
      if (!isRectUsable(rect)) return false;
      if (rect.width < 38 || rect.height < 38 || rect.width > 220 || rect.height > 220) return false;
      if (rect.left > maxLeft + 20) return false;
      if (Math.abs((rect.top + rect.height / 2) - targetY) > 230) return false;
      return true;
    }).sort((a, b) => {
      const scoreA = Math.abs((a.rect.top + a.rect.height / 2) - targetY) + Math.max(0, a.rect.left - 120) / 5;
      const scoreB = Math.abs((b.rect.top + b.rect.height / 2) - targetY) + Math.max(0, b.rect.left - 120) / 5;
      return scoreA - scoreB;
    });

    return images[0]?.img.src || '';
  }

  function findNextValueItem(items, startIndex, validator) {
    const labelRect = items[startIndex]?.rect;

    for (let index = startIndex + 1; index < Math.min(items.length, startIndex + 7); index += 1) {
      const item = items[index];
      const text = normalizeTextKey(item.text);
      if (!text || text === '：') continue;
      if (labelRect && Math.abs(item.rect.top - labelRect.top) > 80) continue;
      if (validator(text)) return item;
    }

    return null;
  }

  function findNextLabelIndex(items, startIndex, predicate, maxDistance) {
    for (let index = startIndex + 1; index <= Math.min(items.length - 1, startIndex + maxDistance); index += 1) {
      if (predicate(normalizeTextKey(items[index].text))) return index;
    }
    return -1;
  }

  function findColorItemBefore(items, labelIndex) {
    const labelRect = items[labelIndex]?.rect;
    let fallback = null;

    for (let index = labelIndex - 1; index >= Math.max(0, labelIndex - 12); index -= 1) {
      const item = items[index];
      const text = item.text.trim();
      const key = normalizeTextKey(text);
      if (!text || key === '：') continue;
      if (labelRect && labelRect.top - item.rect.top > 130) break;
      if (/^(SKU|SKC|SPU|备货仓组|评论数|加入站点|¥)/i.test(key)) continue;
      if (looksLikeSkuId(key)) continue;

      if (!fallback && text.length >= 2) fallback = item;
      if (/[-－—]|通用尺码|尺码|颜色/.test(text)) return item;
    }

    return fallback;
  }

  function findProductTitleBefore(items, skcIndex) {
    for (let index = skcIndex - 1; index >= Math.max(0, skcIndex - 30); index -= 1) {
      const text = items[index].text.trim();
      const key = normalizeTextKey(text);
      if (text.length < 10) continue;
      if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) continue;
      if (/^(SKU|SKC|SPU|评论数|加入站点|节日|销售站点|下架站点|买手端标签|类目|运动与户外用品)/i.test(key)) continue;
      return text;
    }
    return '';
  }

  function findLabelValueBefore(items, searchEnd, labelText) {
    let value = '';
    const labelKey = normalizeTextKey(labelText);

    for (let index = 0; index < searchEnd; index += 1) {
      const key = normalizeTextKey(items[index].text);
      if (key !== `${labelKey}：` && key !== `${labelKey}:`) continue;

      const item = findNextValueItem(items, index, looksLikeSkuId);
      if (item) value = normalizeTextKey(item.text);
    }

    return value;
  }

  function unionRects(rects) {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right ?? rect.left + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.bottom ?? rect.top + rect.height));

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function isSkuIdLabel(text) {
    return /^SKUID[:：]$/.test(text);
  }

  function isSkuNoLabel(text) {
    return /^SKU货号[:：]$/.test(text);
  }

  function isSkcLabel(text) {
    return /^SKC[:：]$/.test(text);
  }

  function looksLikeSkuId(text) {
    return /^[A-Za-z0-9_-]{5,}$/.test(normalizeTextKey(text));
  }

  function looksLikeSkuNo(text) {
    return /^[A-Za-z0-9_-]{8,}$/.test(normalizeTextKey(text));
  }

  function detectProductTitle(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const ignored = [
      /^(SKU|SKC|SPU)\s*(ID|货号)?\s*[:：]/i,
      /^评论数[:：]?/,
      /^加入站点时长[:：]?/,
      /^国内备货$/,
      /^今日系统创建$/,
      /^热销款$/,
      /^有待发货备货单$/,
      /^节日\/季节标签[:：]?/,
      /^评分[:：]?/,
      /^备货仓组[:：]?/,
      /^设置$/,
      /^帽子$/
    ];

    const title = lines.find((line) => {
      if (line.length < 4) return false;
      return !ignored.some((rule) => rule.test(line));
    });

    return title || '';
  }

  function createFallbackProduct(skuCells, rows) {
    return {
      title: '未识别商品标题',
      image: '',
      skc: '',
      platformId: '',
      skuCount: rows.length || skuCells.length || 0
    };
  }

  function render(data) {
    state.resultBox.textContent = '';
    state.resultBox.appendChild(renderProduct(data.product));

    if (data.warnings.length) {
      const warning = document.createElement('div');
      warning.className = 'tsc-warning';
      warning.textContent = data.warnings.join(' ');
      state.resultBox.appendChild(warning);
    }

    if (!data.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'tsc-empty';
      empty.textContent = '暂无可计算的 SKU 数据';
      state.resultBox.appendChild(empty);
      return;
    }

    state.resultBox.appendChild(renderTable(data.rows));
  }

  function renderProduct(product) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tsc-product';

    if (product.image) {
      const image = document.createElement('img');
      image.className = 'tsc-product-img';
      image.src = product.image;
      image.alt = '商品图';
      wrapper.appendChild(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'tsc-product-placeholder';
      wrapper.appendChild(placeholder);
    }

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'tsc-product-name';
    title.textContent = product.title || '未识别商品标题';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'tsc-meta';
    appendChip(meta, `SKU数量：${product.skuCount || 0}`);
    if (product.skc) appendChip(meta, `SKC：${product.skc}`);
    if (product.platformId) appendChip(meta, `商品ID：${product.platformId}`);
    body.appendChild(meta);

    wrapper.appendChild(body);
    return wrapper;
  }

  function appendChip(parent, text) {
    const chip = document.createElement('span');
    chip.className = 'tsc-chip';
    chip.textContent = text;
    parent.appendChild(chip);
  }

  function renderTable(rows) {
    const table = document.createElement('table');
    table.className = 'tsc-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['颜色/SKU', 'SKU ID', '近7天', '仓内可用', '已发货', '建议备货'].forEach((text) => {
      const th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      appendCell(tr, row.color || '未识别颜色');
      appendCell(tr, row.skuId || '');
      appendCell(tr, formatNumber(row.sales7));
      appendCell(tr, formatNumber(row.available));
      appendCell(tr, formatNumber(row.shipped));

      const needCell = document.createElement('td');
      const need = document.createElement('span');
      need.className = 'tsc-need';
      need.textContent = row.missing.length ? '-' : String(row.need);
      needCell.appendChild(need);
      tr.appendChild(needCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function appendCell(row, text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.appendChild(cell);
  }

  function findTextMatches(match) {
    return (state.textItems || collectVisibleTextItems()).filter((item) => match(item.text));
  }

  function collectVisibleTextItems() {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.parentElement) return NodeFilter.FILTER_REJECT;
        if (state.root && state.root.contains(node.parentElement)) return NodeFilter.FILTER_REJECT;

        const text = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      const rect = getTextNodeRect(node);
      if (!isRenderedTextRect(rect)) continue;
      results.push({ index: results.length, node, element: node.parentElement, text, rect });
    }

    return results;
  }

  function getTextNodeRect(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    range.detach();
    return rect;
  }

  function getElementText(element) {
    return (element?.innerText || element?.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function normalizeTextKey(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, '');
  }

  function parseNumber(text) {
    const normalized = String(text || '').replace(/,/g, '').replace(/\s+/g, ' ');
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Number.NaN;
  }

  function parsePlainNumber(text) {
    const normalized = normalizeTextKey(text).replace(/,/g, '');
    return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
  }

  function pickMatch(text, regex) {
    const match = String(text || '').match(regex);
    return match ? match[1].trim() : '';
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function isRectUsable(rect) {
    return Boolean(
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function isRenderedTextRect(rect) {
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function pointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function dedupe(items) {
    return [...new Set(items.filter(Boolean))];
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById(APP_ID)) init();
    else mountRoot();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
