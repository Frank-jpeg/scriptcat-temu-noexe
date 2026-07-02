// ==UserScript==
// @name         TEMU商品列表导出
// @namespace    https://tampermonkey.net/
// @version      8.5.1
// @description  独立浮窗导出当前筛选结果的商品列表信息，支持导出字段勾选、SKU体积重量与右侧极简收起。
// @match        https://agentseller.temu.com/goods/list*
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%95%86%E5%93%81%E5%88%97%E8%A1%A8%E5%AF%BC%E5%87%BA.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%95%86%E5%93%81%E5%88%97%E8%A1%A8%E5%AF%BC%E5%87%BA.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = '__codex_temu_goods_list_export_v85';
  const STATUS_ID = '__codex_temu_goods_list_export_status_v85';
  const PROGRESS_BAR_ID = '__codex_temu_goods_list_export_progress_v85';
  const PROGRESS_TEXT_ID = '__codex_temu_goods_list_export_progress_text_v85';
  const TOGGLE_ID = '__codex_temu_goods_list_export_toggle_v85';
  const HEADER_ID = '__codex_temu_goods_list_export_header_v85';
  const CONTENT_ID = '__codex_temu_goods_list_export_content_v85';
  const TITLE_ID = '__codex_temu_goods_list_export_title_v85';
  const MODAL_ID = '__codex_temu_goods_list_export_modal_v85';
  const STORAGE_KEY = '__codex_temu_goods_list_export_collapsed_v85';
  const FIELDS_STORAGE_KEY = '__codex_temu_goods_list_export_fields_v85';

  const EXPORT_FIELDS = [
    { key: 'index', label: '序号' },
    { key: 'page', label: '页码' },
    { key: 'skcId', label: 'SKC_ID' },
    { key: 'spuId', label: 'SPU_ID' },
    { key: 'extCode', label: '商品货号' },
    { key: 'title', label: '商品名称' },
    { key: 'material', label: '材质' },
    { key: 'composition', label: '成分' },
    { key: 'skuId', label: 'SKU_ID' },
    { key: 'skuSpec', label: 'SKU规格' },
    { key: 'skuExtCode', label: 'SKU货号' },
    { key: 'createTime', label: '创建时间' },
    { key: 'sellerVolume', label: '卖家测量体积' },
    { key: 'sellerWeight', label: '卖家测量重量' },
    { key: 'platformVolume', label: '平台测量参考体积' },
    { key: 'platformWeight', label: '平台测量参考重量' },
    { key: 'attributes', label: '商品属性' }
  ];
  const DEFAULT_FIELD_KEYS = EXPORT_FIELDS.map(field => field.key);

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getMemoryRows() {
    const primaryRows = Array.isArray(window.jtkjSkuGoodsData) ? window.jtkjSkuGoodsData : null;
    const backupRows = Array.isArray(window.jtkjBqSkuGoodsData) ? window.jtkjBqSkuGoodsData : null;
    if (primaryRows?.length) return primaryRows;
    if (backupRows?.length) return backupRows;
    if (primaryRows) return primaryRows;
    if (backupRows) return backupRows;
    return [];
  }

  function getCurrentPage() {
    const text = document.querySelector('li[class*="PGT_pagerItemActive"]')?.textContent || '';
    const page = Number(String(text).trim());
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  function getTotalCount() {
    const text = document.querySelector('li[class*="PGT_totalText"]')?.textContent || '';
    const total = Number((text.match(/(\d+)/) || [])[1] || 0);
    return Number.isFinite(total) ? total : 0;
  }

  function getPageSize() {
    return getMemoryRows().length || 0;
  }

  function getNextButton() {
    return document.querySelector('li[data-testid="beast-core-pagination-next"]');
  }

  function isNextDisabled() {
    const next = getNextButton();
    return !next || next.className.includes('PGT_disabled');
  }

  function getRowsToken() {
    const rows = getMemoryRows();
    return JSON.stringify({
      len: rows.length,
      first: rows[0]?.productSkcId || '',
      last: rows[rows.length - 1]?.productSkcId || ''
    });
  }

  function escapeCsvCell(value) {
    const text = String(value ?? '');
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function getSavedFieldKeys() {
    try {
      const saved = JSON.parse(localStorage.getItem(FIELDS_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        const validKeys = new Set(EXPORT_FIELDS.map(field => field.key));
        const keys = saved.filter(key => validKeys.has(key));
        if (keys.length) return keys;
      }
    } catch (error) {
      // Ignore bad localStorage data and fall back to all fields.
    }
    return DEFAULT_FIELD_KEYS.slice();
  }

  function saveFieldKeys(keys) {
    localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify(keys));
  }

  function getFieldsByKeys(keys) {
    const selected = new Set(keys?.length ? keys : DEFAULT_FIELD_KEYS);
    return EXPORT_FIELDS.filter(field => selected.has(field.key));
  }

  function firstFilled(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
  }

  function toNumberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatDecimal(value) {
    return String(Number(value.toFixed(2)));
  }

  function formatMmToCm(value) {
    const number = toNumberOrNull(value);
    return number === null ? '' : formatDecimal(number / 10);
  }

  function formatMgToG(value) {
    const number = toNumberOrNull(value);
    return number === null ? '' : formatDecimal(number / 1000);
  }

  function formatSkuVolume(volume) {
    if (!volume || typeof volume !== 'object') return '';
    const len = formatMmToCm(firstFilled(volume.len, volume.inputLen));
    const width = formatMmToCm(firstFilled(volume.width, volume.inputWidth));
    const height = formatMmToCm(firstFilled(volume.height, volume.inputHeight));
    if (!len || !width || !height) return '';
    return `${len}cm*${width}cm*${height}cm`;
  }

  function formatSkuWeight(weight) {
    if (!weight || typeof weight !== 'object') return '';
    const value = formatMgToG(firstFilled(weight.value, weight.inputValue));
    return value ? `${value}g` : '';
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatCreateTime(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string' && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) {
      return value.replace(/\//g, '-').replace('T', ' ').replace(/\.\d+Z?$/, '').trim();
    }

    let timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return String(value);
    if (timestamp > 0 && timestamp < 10000000000) timestamp *= 1000;

    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return String(value);
    return [
      date.getFullYear(),
      '-',
      pad2(date.getMonth() + 1),
      '-',
      pad2(date.getDate()),
      ' ',
      pad2(date.getHours()),
      ':',
      pad2(date.getMinutes()),
      ':',
      pad2(date.getSeconds())
    ].join('');
  }

  function getPropValue(prop) {
    if (!prop) return '';
    const values = [];
    if (prop.propValue) values.push(prop.propValue);
    if (prop.numberInputValue) values.push(prop.numberInputValue + (prop.valueUnit || ''));
    if (!values.length && prop.valueExtendInfo) values.push(prop.valueExtendInfo);
    return values.join(' ').trim();
  }

  function formatPropertyValue(prop) {
    if (!prop || !prop.propName) return '';
    const value = getPropValue(prop);
    return `${prop.propName}：${value}`.trim();
  }

  function pickProperty(item, names) {
    const props = Array.isArray(item.productProperties) ? item.productProperties : [];
    const hit = props.find(prop => names.includes(String(prop.propName || '').trim()));
    return hit ? getPropValue(hit) : '';
  }

  function getSkuRows(item) {
    return Array.isArray(item.productSkuSummaries) && item.productSkuSummaries.length
      ? item.productSkuSummaries
      : [null];
  }

  function countSkuExportRows(items) {
    return items.reduce((total, item) => total + getSkuRows(item).length, 0);
  }

  function formatSkuSpec(sku) {
    const specs = Array.isArray(sku?.productSkuSpecList) ? sku.productSkuSpecList : [];
    return specs
      .map(spec => {
        const name = String(spec.parentSpecName || '').trim();
        const value = String(spec.specName || '').trim();
        return name && value ? `${name}:${value}` : value || name;
      })
      .filter(Boolean)
      .join(' / ');
  }

  function mapItemSkuToRow(item, sku, index, page) {
    const wh = sku?.productSkuWhExtAttr || {};
    return {
      index,
      page,
      skcId: String(item.productSkcId || ''),
      spuId: String(item.productId || ''),
      extCode: item.extCode || '',
      title: item.productName || '',
      material: pickProperty(item, ['材质', '材料']),
      composition: pickProperty(item, ['成分']),
      skuId: String(sku?.productSkuId || ''),
      skuSpec: formatSkuSpec(sku),
      skuExtCode: sku?.extCode || '',
      createTime: formatCreateTime(firstFilled(sku?.createdAt, sku?.productCreateTime, item.createdAt, item.productCreateTime)),
      sellerVolume: formatSkuVolume(wh.productSkuVolume),
      sellerWeight: formatSkuWeight(wh.productSkuWeight),
      platformVolume: formatSkuVolume(wh.productSkuWmsVolume),
      platformWeight: formatSkuWeight(wh.productSkuWmsWeight),
      attributes: (item.productProperties || []).map(formatPropertyValue).filter(Boolean).join(' | ')
    };
  }

  function downloadCsv(rows, suffix, fieldKeys) {
    const fields = getFieldsByKeys(fieldKeys);
    const header = fields.map(field => field.label);
    const lines = [
      header,
      ...rows.map(row => fields.map(field => row[field.key]))
    ].map(cols => cols.map(escapeCsvCell).join(','));
    const content = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `temu-goods-list-${suffix}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function waitForNextPageData(prevPage, prevToken) {
    let pageChanged = false;
    const expectedPageSize = Math.max(getPageSize(), 20);
    const stableDelay = expectedPageSize >= 500 ? 2600 : expectedPageSize >= 100 ? 1800 : 1200;

    for (let i = 0; i < 120; i += 1) {
      await sleep(250);
      const currentPage = getCurrentPage();
      const currentToken = getRowsToken();
      if (currentPage !== prevPage) {
        pageChanged = true;
      }
      if (pageChanged && currentToken !== prevToken && getMemoryRows().length) {
        await sleep(stableDelay);
        const confirmPage = getCurrentPage();
        const confirmToken = getRowsToken();
        if (confirmPage !== prevPage && confirmToken !== prevToken) {
          return true;
        }
      }
    }
    return false;
  }

  async function goNextPage() {
    const next = getNextButton();
    if (!next || isNextDisabled()) return false;
    const prevPage = getCurrentPage();
    const prevToken = getRowsToken();
    next.click();
    return waitForNextPageData(prevPage, prevToken);
  }

  function setStatus(text, isError) {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#ff4d6d' : '#3d2c33';
  }

  function setProgress(current, total) {
    const bar = document.getElementById(PROGRESS_BAR_ID);
    const text = document.getElementById(PROGRESS_TEXT_ID);
    if (!bar || !text) return;
    const safeTotal = Math.max(total || 0, 1);
    const percent = Math.max(0, Math.min(100, (current / safeTotal) * 100));
    bar.style.width = `${percent}%`;
    text.textContent = `进度 ${current}/${total || '?'} (${percent.toFixed(1)}%)`;
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll('[data-role="action-v85"]').forEach(button => {
      button.disabled = disabled;
      button.style.opacity = disabled ? '0.6' : '1';
      button.style.cursor = disabled ? 'not-allowed' : 'pointer';
    });
  }

  function removeExportDialog() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function showExportDialog(options) {
    removeExportDialog();

    return new Promise(resolve => {
      const savedKeys = new Set(getSavedFieldKeys());
      const overlay = document.createElement('div');
      overlay.id = MODAL_ID;
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:1000000',
        'background:rgba(0,0,0,.38)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'font-family:Segoe UI, Microsoft YaHei, sans-serif',
        'color:#222'
      ].join(';');

      const fieldHtml = EXPORT_FIELDS.map(field => `
        <label style="display:flex;align-items:center;gap:6px;min-width:130px;height:28px;font-size:13px;cursor:pointer;">
          <input type="checkbox" data-field-key="${field.key}" ${savedKeys.has(field.key) ? 'checked' : ''} style="width:14px;height:14px;accent-color:#4678ff;">
          <span>${field.label}</span>
        </label>
      `).join('');

      overlay.innerHTML = `
        <div style="width:560px;max-width:calc(100vw - 28px);background:#fff;border-radius:6px;box-shadow:0 18px 60px rgba(0,0,0,.26);overflow:hidden;">
          <div style="height:52px;display:flex;align-items:center;padding:0 18px;border-bottom:1px solid #edf0f5;font-size:16px;font-weight:600;">${options.title}</div>
          <div style="padding:20px 26px 14px;">
            <div style="font-size:14px;margin-bottom:10px;">${options.summary}</div>
            <div style="font-size:13px;color:#8a5b15;background:#fff7e6;border:1px solid #ffd591;border-radius:4px;padding:8px 10px;margin-bottom:14px;">建议先手动把每页数量改到 500，再导出会更快。</div>
            <label style="display:flex;align-items:center;gap:6px;height:30px;font-size:13px;cursor:pointer;border-bottom:1px solid #edf0f5;margin-bottom:10px;padding-bottom:10px;">
              <input id="${MODAL_ID}_all" type="checkbox" style="width:14px;height:14px;accent-color:#4678ff;">
              <span>全部字段</span>
            </label>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 10px;background:#fafafa;border-radius:4px;padding:10px 12px;">
              ${fieldHtml}
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 24px 18px;border-top:1px solid #edf0f5;">
            <button id="${MODAL_ID}_export" type="button" style="min-width:64px;height:34px;border:none;border-radius:4px;background:#4678ff;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">导出</button>
            <button id="${MODAL_ID}_cancel" type="button" style="min-width:64px;height:34px;border:1px solid #bfc4cc;border-radius:4px;background:#fff;color:#222;font-size:14px;cursor:pointer;">取消</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const allCheckbox = document.getElementById(`${MODAL_ID}_all`);
      const fieldCheckboxes = Array.from(overlay.querySelectorAll('input[data-field-key]'));

      function syncAllCheckbox() {
        const checkedCount = fieldCheckboxes.filter(input => input.checked).length;
        allCheckbox.checked = checkedCount === fieldCheckboxes.length;
        allCheckbox.indeterminate = checkedCount > 0 && checkedCount < fieldCheckboxes.length;
      }

      allCheckbox.addEventListener('change', () => {
        fieldCheckboxes.forEach(input => {
          input.checked = allCheckbox.checked;
        });
        syncAllCheckbox();
      });

      fieldCheckboxes.forEach(input => {
        input.addEventListener('change', syncAllCheckbox);
      });

      document.getElementById(`${MODAL_ID}_cancel`).addEventListener('click', () => {
        removeExportDialog();
        resolve(null);
      });

      document.getElementById(`${MODAL_ID}_export`).addEventListener('click', () => {
        const keys = fieldCheckboxes.filter(input => input.checked).map(input => input.dataset.fieldKey);
        if (!keys.length) {
          window.alert('请至少勾选一个导出字段');
          return;
        }
        saveFieldKeys(keys);
        removeExportDialog();
        resolve(keys);
      });

      syncAllCheckbox();
    });
  }

  async function collectRows(productLimit) {
    const rows = [];
    const seenPages = new Set();
    let collectedProducts = 0;

    while (collectedProducts < productLimit) {
      const page = getCurrentPage();
      const currentItems = getMemoryRows();
      if (!currentItems.length) {
        throw new Error('未读取到页面数据，不能导出');
      }

      if (!seenPages.has(page)) {
        seenPages.add(page);
        for (const item of currentItems) {
          const skuRows = getSkuRows(item);
          for (const sku of skuRows) {
            rows.push(mapItemSkuToRow(item, sku, rows.length + 1, page));
          }
          collectedProducts += 1;
          if (collectedProducts >= productLimit) break;
        }
      }

      setStatus(`已抓取 ${collectedProducts}/${productLimit} 个商品，导出行 ${rows.length} 条，当前第 ${page} 页`, false);
      setProgress(collectedProducts, productLimit);

      if (collectedProducts >= productLimit) break;
      if (isNextDisabled()) break;

      const moved = await goNextPage();
      if (!moved) {
        throw new Error('翻页后未检测到新页数据');
      }
    }

    return { rows, collectedProducts };
  }

  async function runExport(productLimit, suffix, fieldKeys) {
    setButtonsDisabled(true);
    setProgress(0, productLimit);
    try {
      const result = await collectRows(productLimit);
      downloadCsv(result.rows, suffix, fieldKeys);
      setStatus(`导出完成，已下载 ${result.rows.length} 行（${result.collectedProducts} 个商品）`, false);
      setProgress(result.collectedProducts, productLimit);
    } catch (error) {
      setStatus(`导出失败：${error.message || error}`, true);
    } finally {
      setButtonsDisabled(false);
    }
  }

  async function handleCurrentExport() {
    const currentItems = getMemoryRows();
    const currentCount = currentItems.length;
    const currentSkuRows = countSkuExportRows(currentItems);
    const fieldKeys = await showExportDialog({
      title: '导出当前页',
      summary: `检测到当前页 ${currentCount} 个商品，预计导出 ${currentSkuRows} 行 SKU 数据。`
    });
    if (!fieldKeys) return;
    runExport(Math.max(currentCount, 1), 'current-page', fieldKeys);
  }

  async function handleFullExport() {
    const currentItems = getMemoryRows();
    const currentCount = currentItems.length;
    const currentSkuRows = countSkuExportRows(currentItems);
    const totalCount = getTotalCount();
    if (!totalCount) {
      setStatus('未识别到筛选结果总条数，不能全量导出', true);
      return;
    }
    const fieldKeys = await showExportDialog({
      title: '下载查询结果',
      summary: `共查询到 ${totalCount} 个商品；当前页 ${currentCount} 个商品，约 ${currentSkuRows} 行 SKU 数据。`
    });
    if (!fieldKeys) return;
    runExport(totalCount, 'filtered-all', fieldKeys);
  }

  function applyCollapsedState(collapsed) {
    const panel = document.getElementById(PANEL_ID);
    const header = document.getElementById(HEADER_ID);
    const title = document.getElementById(TITLE_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    const content = document.getElementById(CONTENT_ID);
    if (!panel || !header || !title || !toggle || !content) return;

    if (collapsed) {
      panel.style.width = '34px';
      panel.style.borderRadius = '12px 0 0 12px';
      header.style.padding = '0';
      header.style.height = '116px';
      header.style.justifyContent = 'center';
      title.style.display = 'none';
      content.style.display = 'none';
      toggle.textContent = '展开';
      toggle.style.display = 'flex';
      toggle.style.alignItems = 'center';
      toggle.style.justifyContent = 'center';
      toggle.style.width = '34px';
      toggle.style.height = '116px';
      toggle.style.padding = '0';
      toggle.style.borderRadius = '12px 0 0 12px';
      toggle.style.background = 'linear-gradient(180deg,#111 0%,#0b0b0b 100%)';
      toggle.style.color = '#35e287';
      toggle.style.writingMode = 'vertical-rl';
      toggle.style.textOrientation = 'upright';
      toggle.style.letterSpacing = '-2px';
      toggle.style.fontSize = '12px';
      toggle.style.fontWeight = '700';
      toggle.style.boxShadow = '0 10px 24px rgba(0,0,0,.24)';
    } else {
      panel.style.width = '320px';
      panel.style.borderRadius = '16px 0 0 16px';
      header.style.padding = '12px 14px';
      header.style.height = 'auto';
      header.style.justifyContent = 'space-between';
      title.style.display = 'block';
      content.style.display = 'block';
      toggle.textContent = '收起';
      toggle.style.display = 'block';
      toggle.style.width = 'auto';
      toggle.style.height = 'auto';
      toggle.style.padding = '4px 10px';
      toggle.style.borderRadius = '999px';
      toggle.style.background = 'rgba(255,255,255,.16)';
      toggle.style.color = '#fff';
      toggle.style.writingMode = 'horizontal-tb';
      toggle.style.textOrientation = 'mixed';
      toggle.style.letterSpacing = '0';
      toggle.style.fontSize = '12px';
      toggle.style.fontWeight = '600';
      toggle.style.boxShadow = 'none';
    }
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const items = getMemoryRows();
    const current = items.length;
    const currentSkuRows = countSkuExportRows(items);
    const total = getTotalCount();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:0',
      'bottom:120px',
      'z-index:999999',
      'width:320px',
      'background:linear-gradient(180deg,#fff8fb 0%,#fff 100%)',
      'border:1px solid #ffd3e1',
      'border-right:none',
      'border-radius:16px 0 0 16px',
      'box-shadow:0 20px 60px rgba(147,58,91,.22)',
      'color:#3d2c33',
      'font-family:Segoe UI, Microsoft YaHei, sans-serif',
      'overflow:hidden',
      'transition:width .18s ease'
    ].join(';');

    panel.innerHTML = `
      <div id="${HEADER_ID}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(90deg,#ff7aa8 0%,#ff4f87 100%);color:#fff;">
        <div id="${TITLE_ID}" style="font-size:14px;font-weight:700;">TEMU商品列表导出</div>
        <button id="${TOGGLE_ID}" type="button" style="border:none;background:rgba(255,255,255,.16);color:#fff;border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer;">收起</button>
      </div>
      <div id="${CONTENT_ID}" style="padding:14px;">
        <div style="font-size:12px;line-height:1.7;color:#7c5a67;margin-bottom:12px;">
          当前页 <b>${current}</b> 个商品，约 <b>${currentSkuRows}</b> 行 SKU；筛选结果约 <b>${total || '-'}</b> 个商品。<br>
          建议先手动把每页改到 <b>500</b>，导出会更快。<br>
          导出前可勾选需要的字段。
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button data-role="action-v85" id="${PANEL_ID}_current" type="button" style="flex:1;height:38px;border:none;border-radius:10px;background:#ff6b9a;color:#fff;font-weight:700;cursor:pointer;">导出当前页</button>
          <button data-role="action-v85" id="${PANEL_ID}_full" type="button" style="flex:1;height:38px;border:none;border-radius:10px;background:#ff4f87;color:#fff;font-weight:700;cursor:pointer;">导出全部</button>
        </div>
        <div style="margin-bottom:8px;">
          <div style="height:10px;background:#ffe3ec;border-radius:999px;overflow:hidden;">
            <div id="${PROGRESS_BAR_ID}" style="height:100%;width:0;background:linear-gradient(90deg,#ff7aa8 0%,#ff4f87 100%);transition:width .25s ease;"></div>
          </div>
          <div id="${PROGRESS_TEXT_ID}" style="margin-top:6px;font-size:12px;color:#9a7280;">进度 0/0 (0.0%)</div>
        </div>
        <div id="${STATUS_ID}" style="font-size:12px;line-height:1.7;color:#3d2c33;">待命</div>
      </div>
    `;

    document.body.appendChild(panel);
    document.getElementById(TOGGLE_ID).addEventListener('click', () => {
      const collapsed = localStorage.getItem(STORAGE_KEY) === '1';
      applyCollapsedState(!collapsed);
    });
    document.getElementById(`${PANEL_ID}_current`).addEventListener('click', handleCurrentExport);
    document.getElementById(`${PANEL_ID}_full`).addEventListener('click', handleFullExport);

    setProgress(0, total || current || 1);
    applyCollapsedState(localStorage.getItem(STORAGE_KEY) === '1');
  }

  const timer = setInterval(() => {
    if (!document.body) return;
    mountPanel();
    if (document.getElementById(PANEL_ID)) {
      clearInterval(timer);
    }
  }, 1000);
})();
