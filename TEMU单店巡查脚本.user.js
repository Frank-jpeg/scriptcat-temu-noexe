// ==UserScript==
// @name         TEMU单店巡查脚本
// @namespace    https://local.temu.single.inspector
// @version      1.8.9
// @description  单店铺 TEMU 巡查：抽检结果、JIT 逾期、合规中心、违规信息、VMI 未收货、价格申报、退货包裹、资金余额
// @match        https://agentseller.temu.com/*
// @match        https://seller.kuajingmaihuo.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%8D%95%E5%BA%97%E5%B7%A1%E6%9F%A5%E8%84%9A%E6%9C%AC.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%8D%95%E5%BA%97%E5%B7%A1%E6%9F%A5%E8%84%9A%E6%9C%AC.user.js
// ==/UserScript==

(function () {
  'use strict';

  const APP_ID = '__temu_single_store_script_v8';
  const PANEL_ID = `${APP_ID}_panel`;
  const RESULT_DIALOG_ID = `${APP_ID}_result_dialog`;
  const CONFIG_KEY = `${APP_ID}_config`;
  const JOB_KEY = `${APP_ID}_job`;
  const RECENT_DAYS = 2;
  const SHIPPING_STALE_DAYS = 6;
  const WITHDRAW_ALERT_THRESHOLD = 2000;
  const ARRIVAL_OVERDUE_RECENT_DAYS = 4;
  const LOW_DECLARED_PRICE_THRESHOLD = 10;
  const TEMU_URGENT_LIST_API = 'https://agentseller.temu.com/mms/venom/api/supplier/purchase/manager/querySubOrderList';
  const URGENT_DELAY_STATUS = {
    deliverSoon: 101,
    deliverOverdue: 102,
    arrivalSoon: 201,
    arrivalOverdue: 202,
  };

  const URLS = {
    qc: 'https://seller.kuajingmaihuo.com/wms/qc-detail',
    urgent: 'https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency',
    urgent_declared_price: 'https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency',
    govern: 'https://agentseller.temu.com/govern/dashboard',
    shipping: 'https://seller.kuajingmaihuo.com/main/order-manager/shipping-list',
    violation: 'https://agentseller.temu.com/wms/stock-mgt/violation-message',
    limited: 'https://agentseller.temu.com/labor/limited/list',
    price_rule: 'https://agentseller.temu.com/main/adjust-price-manage/order-price',
    return_order: 'https://seller.kuajingmaihuo.com/wms/stock-mgt/return-order-mgt',
    funds: 'https://seller.kuajingmaihuo.com/labor/account',
  };

  const CHECK_ITEMS = [
    { key: 'qc', label: '抽检结果明细', low: false },
    { key: 'urgent', label: '检查JIT是否逾期', low: false },
    { key: 'urgent_declared_price', label: '检查待发货低申报价', low: false },
    { key: 'govern', label: '合规中心', low: false },
    { key: 'shipping', label: `检查VMI超${SHIPPING_STALE_DAYS}天未收货`, low: false },
    { key: 'violation', label: '检查违规信息待处理', low: false },
    { key: 'limited', label: '检查店铺限制记录', low: false },
    { key: 'price_rule', label: '价格申报自动助手', low: false },
    { key: 'return_order', label: '退货包裹查询', low: true },
    { key: 'funds', label: '检查资金中心余额', low: true },
  ];

  const DEFAULT_RULES = [
    { kw: '帽', min: 0, max: 15.5, action: '不调整' },
    { kw: '帽', min: 15.6, max: 99, action: '调整' },
    { kw: '拉链', min: 0, max: 17.5, action: '不调整' },
    { kw: '拉链', min: 17.6, max: 99, action: '调整' },
    { kw: '钱包', min: 0, max: 12, action: '不调整' },
    { kw: '钱包', min: 12.1, max: 99, action: '调整' },
    { kw: '背包', min: 0, max: 17.5, action: '不调整' },
    { kw: '背包', min: 17.56, max: 99, action: '调整' },
    { kw: '健身', min: 0, max: 17.5, action: '不调整' },
    { kw: '健身', min: 17.56, max: 99, action: '调整' },
  ];

  const DEFAULT_CONFIG = {
    selectedChecks: Object.fromEntries(CHECK_ITEMS.map((item) => [item.key, !item.low])),
    lowPriorityVisible: false,
    panelCollapsed: false,
    protectDiff: true,
    protectDiffLimit: 1,
    ruleText: rulesToText(DEFAULT_RULES),
  };

  let panelBooted = false;
  let renderTimer = null;
  let engineRunning = false;
  let uiActionPending = false;

  function normalize(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function checkedSleep(jobId, ms, slice = 250) {
    const end = Date.now() + Math.max(0, ms);
    while (Date.now() < end) {
      await assertNotStopped(jobId);
      await sleep(Math.min(slice, end - Date.now()));
    }
  }

  function visible(el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function toInt(value, fallback = 0) {
    const text = String(value ?? '').replace(/[^\d-]/g, '');
    const num = Number.parseInt(text, 10);
    return Number.isFinite(num) ? num : fallback;
  }

  function toFloat(value, fallback = 0) {
    const text = String(value ?? '').replace(/[^\d.-]/g, '');
    const num = Number.parseFloat(text);
    return Number.isFinite(num) ? num : fallback;
  }

  function parseDateTimeText(text) {
    const value = normalize(text);
    if (!value) {
      return null;
    }
    const normalized = value.length === 16 ? `${value}:00` : value;
    const date = new Date(normalized.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isRecent(target, recentDays) {
    if (!target) {
      return false;
    }
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Math.max(1, recentDays) + 1);
    const current = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return current >= start && current <= end;
  }

  function extractTextAfterLabel(text, label) {
    const pattern = new RegExp(`${escapeRegExp(label)}[:：]\\s*(.+?)(?=\\s+\\S+[:：]|$)`);
    const match = normalize(text).match(pattern);
    return match ? normalize(match[1]) : '';
  }

  function pickMappedValue(mapped, candidates, fallback = '') {
    for (const key of candidates) {
      if (mapped && mapped[key]) {
        return mapped[key];
      }
    }
    return fallback;
  }

  function parseShippingDatetime(text, label) {
    const match = normalize(text).match(new RegExp(`${escapeRegExp(label)}[:：]\\s*(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})`));
    return match ? parseDateTimeText(match[1]) : null;
  }

  function isOlderThanDays(target, days) {
    if (!target) {
      return false;
    }
    return Date.now() - target.getTime() >= days * 24 * 60 * 60 * 1000;
  }

  function violationNeedsManual(progress) {
    const text = normalize(progress);
    return text.startsWith('公示中') || text.includes('逾期未申诉');
  }

  function formatDateTimeValue(value) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function getCookieValue(name) {
    const pattern = new RegExp(`(?:^|; )${escapeRegExp(name)}=([^;]*)`);
    const match = String(document.cookie || '').match(pattern);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function postTemuJson(url, body) {
    const mallid = getCookieValue('mallid');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        mallid,
      },
      body: JSON.stringify(body),
    });
    if (!response || typeof response.text !== 'function') {
      throw new Error('TEMU 接口返回异常');
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_error) {
      throw new Error(`TEMU 接口返回无法解析：${String(text || '').slice(0, 120)}`);
    }
    if (!response.ok || !payload || payload.success !== true) {
      throw new Error(`TEMU 接口失败：${payload && payload.errorMsg ? payload.errorMsg : `HTTP ${response.status}`}`);
    }
    return payload.result || {};
  }

  function createUrgentListRequest(pageNo, pageSize) {
    return {
      pageNo,
      pageSize,
      urgencyType: 1,
      isCustomGoods: false,
      oneDimensionSort: {
        firstOrderByParam: 'createdAt',
        firstOrderByDesc: 1,
      },
    };
  }

  function normalizeUrgentApiRow(item, recentDays = ARRIVAL_OVERDUE_RECENT_DAYS) {
    const skuList = Array.isArray(item && item.skuQuantityDetailList) ? item.skuQuantityDetailList : [];
    const firstSku = skuList[0] || {};
    const createdAt = item && item.purchaseTime ? new Date(item.purchaseTime) : null;
    const status = item && item.deliveryOrderSn ? '已送货' : '待发货';
    const deliveryOrderSn = normalize(item && item.deliveryOrderSn || '');
    const warehouse = normalize(item && item.subWarehouseName || '');
    return {
      prepareOrderNo: normalize(item && item.subPurchaseOrderSn || ''),
      productInfo: normalize(item && item.productName || ''),
      status,
      skuInfo: skuList.map((sku) => normalize(sku.className || sku.extCode || '')).filter(Boolean).join(' / '),
      declaredPrice: Math.round((toFloat(firstSku && firstSku.supplierPrice, 0) / 100) * 100) / 100,
      deliveryInfo: [deliveryOrderSn ? `发货单:${deliveryOrderSn}` : '', warehouse ? `仓库:${warehouse}` : ''].filter(Boolean).join(' '),
      createdTime: formatDateTimeValue(createdAt),
      isRecent: isRecent(createdAt, recentDays),
    };
  }

  async function fetchUrgentSummaryByApi() {
    const result = await postTemuJson(TEMU_URGENT_LIST_API, createUrgentListRequest(1, 1));
    const delayMap = result && result.delayNumMap ? result.delayNumMap : {};
    return {
      shipOverdue: toInt(delayMap[URGENT_DELAY_STATUS.deliverOverdue]),
      arrivalOverdue: toInt(delayMap[URGENT_DELAY_STATUS.arrivalOverdue]),
      raw: result,
    };
  }

  async function fetchArrivalOverdueRowsByApi(jobId, recentDays = ARRIVAL_OVERDUE_RECENT_DAYS) {
    const pageSize = 100;
    let pageNo = 1;
    let total = 0;
    const rows = [];
    while (pageNo <= 20) {
      await assertNotStopped(jobId);
      const body = createUrgentListRequest(pageNo, pageSize);
      body.deliverOrArrivalDelayStatusList = [URGENT_DELAY_STATUS.arrivalOverdue];
      const result = await postTemuJson(TEMU_URGENT_LIST_API, body);
      total = toInt(result && result.total);
      const list = Array.isArray(result && result.subOrderForSupplierList) ? result.subOrderForSupplierList : [];
      rows.push(...list.map((item) => normalizeUrgentApiRow(item, recentDays)).filter((item) => item.prepareOrderNo));
      if (!list.length || rows.length >= total) {
        break;
      }
      pageNo += 1;
    }
    return {
      totalRowCount: total,
      hasNoData: total <= 0,
      rows,
      recentCount: rows.filter((item) => item.isRecent).length,
      recentDays,
      bodyPreview: `接口返回 ${total} 条`,
    };
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function rulesToText(rules) {
    return (rules || []).map((rule) => `${rule.kw}|${rule.min}|${rule.max}|${rule.action}`).join('\n');
  }

  function textToRules(text) {
    const rules = [];
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split('|').map((item) => item.trim());
      if (parts.length !== 4) {
        throw new Error(`规则格式不对：${line}`);
      }
      const [kw, minText, maxText, actionText] = parts;
      if (!kw) {
        throw new Error(`规则缺少关键词：${line}`);
      }
      const min = minText === '' ? Number.NEGATIVE_INFINITY : Number(minText);
      const max = maxText === '' ? Number.POSITIVE_INFINITY : Number(maxText);
      if (!Number.isFinite(min) && min !== Number.NEGATIVE_INFINITY) {
        throw new Error(`最小价格式不对：${line}`);
      }
      if (!Number.isFinite(max) && max !== Number.POSITIVE_INFINITY) {
        throw new Error(`最大价格式不对：${line}`);
      }
      if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        throw new Error(`最小价大于最大价：${line}`);
      }
      rules.push({
        kw,
        min,
        max,
        action: actionText === '不调整' ? '不调整' : '调整',
      });
    }
    if (!rules.length) {
      throw new Error('请至少保留一条价格规则');
    }
    return rules;
  }

  function inspectRuleText(text) {
    try {
      const rules = textToRules(text);
      return {
        ok: true,
        count: rules.length,
        text: `已自动保存，当前生效 ${rules.length} 条规则`,
        color: '#86efac',
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        text: `规则未生效：${String(error && error.message ? error.message : error)}`,
        color: '#fca5a5',
      };
    }
  }

  function renderRuleStatus(panel, text) {
    if (!panel) {
      return null;
    }
    const statusEl = panel.querySelector('[data-role="rule-status"]');
    if (!statusEl) {
      return null;
    }
    const state = inspectRuleText(text);
    statusEl.textContent = state.text;
    statusEl.style.color = state.color;
    return state;
  }

  async function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, fallback);
        return value && typeof value.then === 'function' ? await value : value;
      }
    } catch (_error) {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_error) {
      return fallback;
    }
  }

  async function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        const result = GM_setValue(key, value);
        if (result && typeof result.then === 'function') {
          await result;
        }
        return;
      }
    } catch (_error) {}
    localStorage.setItem(key, JSON.stringify(value));
  }

  async function gmDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        const result = GM_deleteValue(key);
        if (result && typeof result.then === 'function') {
          await result;
        }
        return;
      }
    } catch (_error) {}
    localStorage.removeItem(key);
  }

  async function loadConfig() {
    const stored = await gmGet(CONFIG_KEY, null);
    const merged = Object.assign({}, DEFAULT_CONFIG, stored || {});
    merged.selectedChecks = Object.assign({}, DEFAULT_CONFIG.selectedChecks, merged.selectedChecks || {});
    merged.lowPriorityVisible = !!merged.lowPriorityVisible;
    merged.panelCollapsed = !!merged.panelCollapsed;
    merged.protectDiff = merged.protectDiff !== false;
    merged.protectDiffLimit = Math.max(0, toFloat(merged.protectDiffLimit, 1));
    merged.ruleText = merged.ruleText || rulesToText(DEFAULT_RULES);
    return merged;
  }

  async function saveConfig(config) {
    await gmSet(CONFIG_KEY, config);
  }

  async function loadJob() {
    return await gmGet(JOB_KEY, null);
  }

  async function saveJob(job) {
    const payload = Object.assign({}, job, { updatedAt: Date.now() });
    await gmSet(JOB_KEY, payload);
    scheduleRender();
    return payload;
  }

  async function clearJob() {
    await gmDelete(JOB_KEY);
    scheduleRender();
  }

  async function appendJobLog(level, message) {
    const job = await loadJob();
    if (!job) {
      return;
    }
    const logs = Array.isArray(job.logs) ? job.logs.slice(-119) : [];
    logs.push({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      message,
    });
    job.logs = logs;
    await saveJob(job);
  }

  async function updateJobMessage(message) {
    const job = await loadJob();
    if (!job) {
      return;
    }
    job.currentMessage = message;
    await saveJob(job);
  }

  async function markJobStopped(reason) {
    const job = await loadJob();
    if (!job) {
      return;
    }
    job.status = 'stopped';
    job.finishedAt = Date.now();
    job.currentMessage = reason || '已停止';
    await saveJob(job);
    showFinalResultAlert(job);
  }

  async function markJobError(error) {
    const job = await loadJob();
    if (!job) {
      return;
    }
    job.status = 'error';
    job.finishedAt = Date.now();
    job.error = String(error && error.message ? error.message : error);
    job.currentMessage = `失败：${job.error}`;
    await saveJob(job);
    showFinalResultAlert(job);
  }

  function stopError() {
    const error = new Error('用户已停止巡查');
    error.__temuStop = true;
    return error;
  }

  async function assertNotStopped(jobId) {
    const job = await loadJob();
    if (!job || job.id !== jobId || job.stopRequested || job.status !== 'running') {
      throw stopError();
    }
  }

  function currentTitleGuess() {
    const title = normalize(document.title || '');
    if (!title) {
      return location.hostname;
    }
    return title.length > 80 ? title.slice(0, 80) : title;
  }

  function createJob(config) {
    let parsedRules;
    try {
      parsedRules = textToRules(config.ruleText);
    } catch (error) {
      throw new Error(`价格规则错误：${String(error && error.message ? error.message : error)}`);
    }
    const steps = CHECK_ITEMS.filter((item) => config.selectedChecks[item.key]).map((item) => item.key);
    return {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'running',
      stopRequested: false,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      storeLabel: currentTitleGuess(),
      currentMessage: '准备开始',
      steps,
      stepIndex: 0,
      enabledChecks: Object.assign({}, config.selectedChecks),
      results: {},
      logs: [],
      error: '',
      ruleConfig: {
        protectDiff: !!config.protectDiff,
        protectDiffLimit: Math.max(0, toFloat(config.protectDiffLimit, 1)),
        rules: parsedRules,
      },
    };
  }

  function getStepLabel(stepKey) {
    const item = CHECK_ITEMS.find((entry) => entry.key === stepKey);
    return item ? item.label : stepKey;
  }

  function buildManualReasons(results, enabledChecks) {
    const reasons = [];
    if (enabledChecks.qc && toInt(results.qc && results.qc.recentCount) > 0) {
      reasons.push(`近${RECENT_DAYS}天新不合格${toInt(results.qc.recentCount)}`);
    }
    if (enabledChecks.urgent && toInt(results.urgent && results.urgent.shipOverdue) > 0) {
      reasons.push(`发货已逾期${toInt(results.urgent.shipOverdue)}`);
    }
    if (enabledChecks.urgent && toInt(results.urgent && results.urgent.arrivalOverdueRecentCount) > 0) {
      reasons.push(`到货已逾期近${ARRIVAL_OVERDUE_RECENT_DAYS}天创建${toInt(results.urgent.arrivalOverdueRecentCount)}`);
    }
    if (enabledChecks.urgent_declared_price && toInt(results.urgent_declared_price && results.urgent_declared_price.lowPriceCount) > 0) {
      reasons.push(`待发货低申报价${toInt(results.urgent_declared_price.lowPriceCount)}条`);
    }
    if (enabledChecks.govern && toInt(results.govern && results.govern.ipComplaintCount) > 0) {
      reasons.push(`知识产权投诉${toInt(results.govern.ipComplaintCount)}`);
    }
    if (enabledChecks.govern && toInt(results.govern && results.govern.troCount) > 0) {
      reasons.push(`TRO${toInt(results.govern.troCount)}`);
    }
    if (enabledChecks.shipping && toInt(results.shipping && results.shipping.staleCount) > 0) {
      reasons.push(`VMI超${SHIPPING_STALE_DAYS}天未收货${toInt(results.shipping.staleCount)}`);
    }
    if (enabledChecks.violation && toInt(results.violation && results.violation.pendingCount) > 0) {
      reasons.push(`违规信息待处理${toInt(results.violation.pendingCount)}条`);
    }
    if (enabledChecks.limited && results.limited && results.limited.needsManual) {
      reasons.push('店铺限制记录命中适用法律法规');
    }
    if (enabledChecks.price_rule && results.price_rule && results.price_rule.confirmPending) {
      reasons.push(results.price_rule.message || '价格申报自动确认失败，请人工确认');
    } else if (enabledChecks.price_rule && toInt(results.price_rule && results.price_rule.remainingCount) > 0) {
      reasons.push(`价格申报剩余${toInt(results.price_rule.remainingCount)}条待人工`);
    }
    if (enabledChecks.return_order && toInt(results.return_order && results.return_order.count) > 0) {
      reasons.push(`退货包裹${toInt(results.return_order.count)}条`);
    }
    if (enabledChecks.funds && toFloat(results.funds && results.funds.availableBalance) > WITHDRAW_ALERT_THRESHOLD) {
      reasons.push(`可用余额${toFloat(results.funds.availableBalance).toFixed(2)}待提现`);
    }
    return reasons;
  }

  function buildCheckSummaries(results, enabledChecks) {
    const items = [];
    if (enabledChecks.qc && results.qc) {
      const recentCount = toInt(results.qc.recentCount);
      items.push({
        key: 'qc',
        label: '抽检结果',
        manual: recentCount > 0,
        text: `近${RECENT_DAYS}天新增 ${recentCount}`,
      });
    }
    if (enabledChecks.urgent && results.urgent) {
      const shipOverdue = toInt(results.urgent.shipOverdue);
      const arrivalOverdue = toInt(results.urgent.arrivalOverdue);
      const arrivalOverdueRecentCount = toInt(results.urgent.arrivalOverdueRecentCount);
      const interfaceTag = results.urgent.source === 'api' ? '(接口)' : (results.urgent.source === 'ui' ? '(页面)' : '');
      items.push({
        key: 'urgent',
        label: `JIT逾期${interfaceTag}`,
        manual: shipOverdue > 0 || arrivalOverdueRecentCount > 0,
        text: `发货 ${shipOverdue}，到货 ${arrivalOverdue}，近${ARRIVAL_OVERDUE_RECENT_DAYS}天创建 ${arrivalOverdueRecentCount}`,
      });
    }
    if (enabledChecks.urgent_declared_price && results.urgent_declared_price) {
      const lowPriceCount = toInt(results.urgent_declared_price.lowPriceCount);
      items.push({
        key: 'urgent_declared_price',
        label: '待发货低申报价',
        manual: lowPriceCount > 0,
        text: `${lowPriceCount} 条`,
      });
    }
    if (enabledChecks.govern && results.govern) {
      const ipComplaintCount = toInt(results.govern.ipComplaintCount);
      const troCount = toInt(results.govern.troCount);
      items.push({
        key: 'govern',
        label: '合规中心',
        manual: ipComplaintCount > 0 || troCount > 0,
        text: `知识产权 ${ipComplaintCount}，TRO ${troCount}`,
      });
    }
    if (enabledChecks.shipping && results.shipping) {
      const staleCount = toInt(results.shipping.staleCount);
      items.push({
        key: 'shipping',
        label: `VMI超${SHIPPING_STALE_DAYS}天未收货`,
        manual: staleCount > 0,
        text: `${staleCount} 单`,
      });
    }
    if (enabledChecks.violation && results.violation) {
      const pendingCount = toInt(results.violation.pendingCount);
      const rowCount = Array.isArray(results.violation.rows) ? results.violation.rows.length : 0;
      items.push({
        key: 'violation',
        label: '违规信息待处理',
        manual: pendingCount > 0,
        text: `待处理 ${pendingCount}，列表 ${rowCount}`,
      });
    }
    if (enabledChecks.limited && results.limited) {
      const matchedCount = toInt(results.limited.matchedCount);
      const rowCount = Array.isArray(results.limited.rows) ? results.limited.rows.length : 0;
      items.push({
        key: 'limited',
        label: '店铺限制记录',
        manual: matchedCount > 0,
        text: `命中 ${matchedCount}，列表 ${rowCount}`,
      });
    }
    if (enabledChecks.price_rule && results.price_rule) {
      const remainingCount = toInt(results.price_rule.remainingCount);
      const waitingCount = toInt(results.price_rule.waitingCount);
      const matchedCount = toInt(results.price_rule.matchedCount);
      const confirmPending = !!results.price_rule.confirmPending;
      items.push({
        key: 'price_rule',
        label: '价格申报',
        manual: confirmPending || remainingCount > 0,
        text: confirmPending
          ? (results.price_rule.message || `自动确认失败，待人工 ${remainingCount || waitingCount}`)
          : `待人工 ${remainingCount}，命中 ${matchedCount}`,
      });
    }
    if (enabledChecks.return_order && results.return_order) {
      const count = toInt(results.return_order.count);
      items.push({
        key: 'return_order',
        label: '退货包裹',
        manual: count > 0,
        text: `${count} 条`,
      });
    }
    if (enabledChecks.funds && results.funds) {
      const availableBalance = toFloat(results.funds.availableBalance);
      items.push({
        key: 'funds',
        label: '资金中心',
        manual: availableBalance > WITHDRAW_ALERT_THRESHOLD,
        text: `可用余额 ${availableBalance.toFixed(2)}`,
      });
    }
    return items;
  }

  function buildDecisionState(job) {
    if (!job) {
      return {
        headline: '待命',
        detail: '还没开始巡查',
        tone: 'idle',
        needManual: false,
      };
    }
    if (job.status === 'running') {
      return {
        headline: '巡查中',
        detail: job.currentMessage || '正在执行中',
        tone: 'running',
        needManual: false,
      };
    }
    if (job.status === 'stopped') {
      return {
        headline: '已停止',
        detail: job.currentMessage || '巡查已停止',
        tone: 'warn',
        needManual: false,
      };
    }
    if (job.status === 'error') {
      return {
        headline: '巡查失败',
        detail: job.error || job.currentMessage || '请看日志',
        tone: 'error',
        needManual: true,
      };
    }
    const reasons = buildManualReasons(job.results || {}, job.enabledChecks || {});
    if (reasons.length) {
      return {
        headline: '需人工处理',
        detail: reasons.join('；'),
        tone: 'alert',
        needManual: true,
      };
    }
    return {
      headline: '全部正常',
      detail: '本次已检查项目都不需要人工处理',
      tone: 'ok',
      needManual: false,
    };
  }

  function buildSummaryText(job) {
    if (!job) {
      return '暂无结果';
    }
    const results = job.results || {};
    const checks = job.enabledChecks || {};
    const reasons = buildManualReasons(results, checks);
    const decision = buildDecisionState(job);
    const checkSummaries = buildCheckSummaries(results, checks);
    const lines = [
      `结论：${decision.headline}`,
      `说明：${decision.detail}`,
      `店铺：${job.storeLabel || '当前店铺'}`,
      `状态：${job.status || 'idle'}`,
      `项目：${job.steps && job.steps.length ? job.steps.map(getStepLabel).join('、') : '无'}`,
    ];
    if (reasons.length) {
      lines.push('');
      lines.push('需处理：');
      reasons.forEach((reason, index) => {
        lines.push(`${index + 1}. ${reason}`);
      });
    }
    if (checkSummaries.length) {
      lines.push('');
      lines.push('巡查项：');
      checkSummaries.forEach((item) => {
        lines.push(`[${item.manual ? '处理' : '正常'}] ${item.label}：${item.text}`);
      });
    }
    if (job.error) {
      lines.push('');
      lines.push(`错误：${job.error}`);
    }
    return lines.join('\n');
  }

  function buildAlertText(job) {
    if (!job) {
      return '暂无结果';
    }
    const decision = buildDecisionState(job);
    const reasons = buildManualReasons(job.results || {}, job.enabledChecks || {});
    const checkSummaries = buildCheckSummaries(job.results || {}, job.enabledChecks || {});
    const lines = [
      `结论：${decision.headline}`,
      `店铺：${job.storeLabel || '当前店铺'}`,
    ];
    if (reasons.length) {
      lines.push('');
      lines.push('需处理：');
      reasons.forEach((reason, index) => {
        lines.push(`${index + 1}. ${reason}`);
      });
    } else if (job.status === 'done') {
      lines.push('');
      lines.push('需处理：无');
    }
    if (checkSummaries.length) {
      lines.push('');
      lines.push('巡查项：');
      checkSummaries.forEach((item) => {
        lines.push(`[${item.manual ? '处理' : '正常'}] ${item.label}：${item.text}`);
      });
    }
    if (job.error) {
      lines.push('');
      lines.push(`错误：${job.error}`);
    }
    return lines.join('\n');
  }

  function buildManualActionItems(job) {
    const results = job && job.results ? job.results : {};
    const checks = job && job.enabledChecks ? job.enabledChecks : {};
    return buildCheckSummaries(results, checks)
      .filter((item) => item.manual)
      .map((item) => ({
        key: item.key,
        label: item.label,
        reason: item.text,
        url: URLS[item.key] || location.href,
      }));
  }

  async function copyPlainText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(input);
    input.focus();
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  }

  function closeResultDialog() {
    const old = document.getElementById(RESULT_DIALOG_ID);
    if (old) {
      old.remove();
    }
  }

  function showFinalResultDialog(job) {
    closeResultDialog();
    if (!job || !document.body) {
      return;
    }
    const decision = buildDecisionState(job);
    const actions = buildManualActionItems(job);
    const needManual = actions.length > 0 || job.status === 'error';
    const dialog = document.createElement('div');
    dialog.id = RESULT_DIALOG_ID;
    dialog.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:1000000',
      'background:rgba(2,6,12,.42)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:18px',
      'font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(560px,calc(100vw - 36px))',
      'max-height:min(680px,calc(100vh - 36px))',
      'overflow:auto',
      'background:#101418',
      'color:#e5e7eb',
      'border:1px solid #2f3942',
      'border-radius:12px',
      'box-shadow:0 24px 70px rgba(0,0,0,.45)',
    ].join(';');
    dialog.appendChild(panel);

    const head = document.createElement('div');
    head.style.cssText = 'padding:14px 16px;border-bottom:1px solid #26323d;background:linear-gradient(135deg,#17324d,#101418);';
    head.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <div style="font-size:17px;font-weight:800;color:${needManual ? '#fdba74' : '#86efac'};">${escapeHtml(decision.headline)}</div>
          <div style="margin-top:4px;color:#cbd5e1;">${escapeHtml(job.storeLabel || '当前店铺')}</div>
        </div>
        <button data-role="close-result" style="${buttonStyle('#374151')}">关闭</button>
      </div>
    `;
    panel.appendChild(head);

    const body = document.createElement('div');
    body.style.cssText = 'padding:14px 16px;';
    panel.appendChild(body);

    if (needManual && actions.length) {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;';
      for (const item of actions) {
        const row = document.createElement('div');
        row.style.cssText = 'border:1px solid #3b2f22;background:#21170f;border-radius:8px;padding:10px;';
        row.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
            <div style="min-width:0;">
              <div style="font-weight:800;color:#fed7aa;">${escapeHtml(item.label)}</div>
              <div style="margin-top:3px;color:#ffedd5;">${escapeHtml(item.reason || '需要人工确认')}</div>
              <a href="${escapeHtml(item.url)}" target="_self" style="display:block;margin-top:6px;color:#93c5fd;word-break:break-all;text-decoration:underline;">${escapeHtml(item.url)}</a>
            </div>
            <button data-role="open-link" data-url="${escapeHtml(item.url)}" style="${buttonStyle('#0f766e')}">打开</button>
          </div>
        `;
        list.appendChild(row);
      }
      body.appendChild(list);
    } else if (job.status === 'done') {
      body.innerHTML = '<div style="padding:14px;border:1px solid #1f4d2c;background:#0f2a1d;border-radius:8px;color:#dcfce7;font-weight:700;">全部正常，无需人工处理</div>';
    } else if (job.error) {
      body.innerHTML = `<div style="padding:12px;border:1px solid #5f2323;background:#2a1114;border-radius:8px;color:#fecaca;white-space:pre-wrap;">${escapeHtml(job.error)}</div>`;
    } else {
      body.innerHTML = `<div style="padding:12px;border:1px solid #574016;background:#2a2111;border-radius:8px;color:#fef3c7;">${escapeHtml(job.currentMessage || '巡查已停止')}</div>`;
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 16px;';
    if (actions.length) {
      footer.innerHTML = `
        <button data-role="open-first" style="${buttonStyle('#0f766e')}">打开第一个待处理页面</button>
        <button data-role="open-all-tabs" style="${buttonStyle('#b45309')}">新标签打开全部</button>
        <button data-role="copy-links" style="${buttonStyle('#2563eb')}">复制全部处理链接</button>
      `;
    } else {
      footer.innerHTML = `<button data-role="copy-summary" style="${buttonStyle('#2563eb')}">复制巡查摘要</button>`;
    }
    panel.appendChild(footer);

    dialog.querySelector('[data-role="close-result"]').addEventListener('click', closeResultDialog);
    dialog.querySelectorAll('[data-role="open-link"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        if (url) {
          location.href = url;
        }
      });
    });
    const openFirst = dialog.querySelector('[data-role="open-first"]');
    if (openFirst) {
      openFirst.addEventListener('click', () => {
        if (actions[0] && actions[0].url) {
          location.href = actions[0].url;
        }
      });
    }
    const openAllTabs = dialog.querySelector('[data-role="open-all-tabs"]');
    if (openAllTabs) {
      openAllTabs.addEventListener('click', () => {
        const urls = Array.from(new Set(actions.map((item) => item.url).filter(Boolean)));
        let opened = 0;
        for (const url of urls) {
          const target = window.open(url, '_blank', 'noopener,noreferrer');
          if (target) {
            opened += 1;
          }
        }
        openAllTabs.textContent = opened === urls.length ? `已打开${opened}个` : `已打开${opened}/${urls.length}`;
      });
    }
    const copyLinks = dialog.querySelector('[data-role="copy-links"]');
    if (copyLinks) {
      copyLinks.addEventListener('click', async () => {
        const text = actions.map((item, index) => `${index + 1}. ${item.label}：${item.reason}\n${item.url}`).join('\n\n');
        await copyPlainText(text);
        copyLinks.textContent = '已复制';
      });
    }
    const copySummary = dialog.querySelector('[data-role="copy-summary"]');
    if (copySummary) {
      copySummary.addEventListener('click', async () => {
        await copyPlainText(buildSummaryText(job));
        copySummary.textContent = '已复制';
      });
    }
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        closeResultDialog();
      }
    });
    document.body.appendChild(dialog);
  }

  function showFinalResultAlert(job) {
    if (!job) {
      return;
    }
    setTimeout(() => {
      try {
        showFinalResultDialog(job);
      } catch (_error) {}
    }, 80);
  }

  function downloadText(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function isOnTargetUrl(url) {
    return location.href.startsWith(url);
  }

  async function navigateTo(url, label) {
    await updateJobMessage(`跳转到${label}`);
    await appendJobLog('INFO', `跳转到${label}`);
    location.href = url;
  }

  function readAccessState() {
    const body = normalize(document.body.innerText || '');
    const hasRegionPage = body.includes('中国地区') && body.includes('其他地区');
    const regionButtons = Array.from(document.querySelectorAll('a,button,div,span'))
      .filter((el) => visible(el) && normalize(el.innerText) === '商家中心');
    const authButton = Array.from(document.querySelectorAll('button'))
      .find((el) => visible(el) && normalize(el.innerText).includes('授权登录'));
    const checkbox = document.querySelector('input[type="checkbox"], input[value="on"]');
    return {
      body,
      hasRegionPage,
      regionButtons,
      authButton,
      checkbox,
      loginPrompt: body.includes('扫码登录') || body.includes('账号登录'),
    };
  }

  async function ensureAccessReady(jobId) {
    const state = readAccessState();
    if (state.hasRegionPage && state.regionButtons.length) {
      await appendJobLog('WARN', '检测到地区入口页，自动进入商家中心');
      state.regionButtons[0].click();
      await checkedSleep(jobId, 1500);
      return false;
    }
    if (state.authButton) {
      await appendJobLog('WARN', '检测到授权页，自动勾选并登录');
      if (state.checkbox && !state.checkbox.checked) {
        state.checkbox.click();
      }
      state.authButton.click();
      await checkedSleep(jobId, 2500);
      return false;
    }
    if (state.loginPrompt) {
      throw new Error(`当前未登录：${state.body.slice(0, 120)}`);
    }
    await assertNotStopped(jobId);
    return true;
  }

  function qcReadyState() {
    const body = normalize(document.body.innerText || '');
    return {
      rowCount: document.querySelectorAll('tbody tr').length,
      hasNoData: body.includes('暂无数据'),
      hasTotal: /共有\s*\d+\s*条/.test(body),
      body,
    };
  }

  function extractQcRows() {
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText));
        if (cells.length < 4) {
          return null;
        }
        const latestQcTime = cells[3] || '';
        return {
          productInfo: cells[0] || '',
          skuInfo: cells[1] || '',
          prepareOrderNo: cells[2] || '',
          latestQcTime,
          operation: cells[4] || '',
          isRecent: isRecent(parseDateTimeText(latestQcTime), RECENT_DAYS),
        };
      })
      .filter(Boolean);
    const body = normalize(document.body.innerText || '');
    const totalMatch = body.match(/共有\s*(\d+)\s*条/);
    return {
      rows,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : rows.length,
      bodyPreview: body.slice(0, 3000),
      recentCount: rows.filter((row) => row.isRecent).length,
    };
  }

  function extractUrgentMetrics() {
    const body = normalize(document.body.innerText || '');
    const sectionStart = body.indexOf('快速筛选');
    let section = body;
    if (sectionStart >= 0) {
      const endMarkers = ['备货母单号', '备货单号', '货号', '查询'];
      let sectionEnd = -1;
      for (const marker of endMarkers) {
        const index = body.indexOf(marker, sectionStart);
        if (index > sectionStart && (sectionEnd < 0 || index < sectionEnd)) {
          sectionEnd = index;
        }
      }
      section = body.slice(sectionStart, sectionEnd > sectionStart ? sectionEnd : body.length);
    }
    const readCount = (label) => {
      const regex = new RegExp(`${escapeRegExp(label)}\\s*(\\d[\\d,]*)`);
      const match = section.match(regex) || body.match(regex);
      return match ? Number(match[1].replace(/,/g, '')) : null;
    };
    return {
      shipOverdue: readCount('发货已逾期'),
      arrivalOverdue: readCount('到货已逾期'),
      ready: section.includes('发货已逾期') && section.includes('到货已逾期'),
      bodyPreview: body.slice(0, 3000),
    };
  }

  function readUrgentPendingPriceState() {
    const body = normalize(document.body.innerText || '');
    const isActiveTabNode = (el) => {
      if (!el) {
        return false;
      }
      const chain = [el, el.parentElement, el.parentElement ? el.parentElement.parentElement : null].filter(Boolean);
      return chain.some((node) => {
        const className = String(node.className || '');
        const ariaSelected = String(node.getAttribute && (node.getAttribute('aria-selected') || '')).toLowerCase();
        return className.includes('active') || className.includes('selected') || ariaSelected === 'true';
      });
    };
    const pendingTabNodes = Array.from(document.querySelectorAll('div,button,span,a'))
      .filter((el) => visible(el) && /^待发货(?:\(\d+\))?$/.test(normalize(el.innerText || '')));
    const activeTabNode = pendingTabNodes.find((el) => isActiveTabNode(el)) || null;
    const pendingTabText = pendingTabNodes[0] ? normalize(pendingTabNodes[0].innerText || '') : '';
    const pendingMatch = pendingTabText.match(/\((\d+)\)/);
    const headers = Array.from(document.querySelectorAll('thead th')).map((cell) => normalize(cell.innerText || ''));
    const rowCount = Array.from(document.querySelectorAll('tbody tr')).filter((row) => visible(row)).length;
    return {
      body,
      activeTabText: activeTabNode ? normalize(activeTabNode.innerText || '') : '',
      pendingTabSeen: pendingTabNodes.length > 0,
      pendingCount: pendingMatch ? Number(pendingMatch[1]) : 0,
      rowCount,
      hasPriceHeader: headers.some((header) => header.includes('申报价格')),
      hasNoData: body.includes('暂无数据'),
      loading: body.includes('加载中'),
    };
  }

  function clickUrgentPendingTab() {
    const target = Array.from(document.querySelectorAll('div,button,span,a'))
      .find((el) => visible(el) && /^待发货(?:\(\d+\))?$/.test(normalize(el.innerText || '')));
    if (!target) {
      return false;
    }
    clickLikeUser(target);
    clickLikeUser(target.parentElement);
    return true;
  }

  function extractUrgentPendingPriceRows() {
    const body = normalize(document.body.innerText || '');
    const headers = Array.from(document.querySelectorAll('thead th')).map((cell) => normalize(cell.innerText || ''));
    const readDeclaredPriceText = (mapped, cells) => {
      const mappedText = mapped['申报价格(CNY)'] || mapped['申报价格'] || '';
      if (/[¥￥]/.test(mappedText) && !mappedText.includes('/')) {
        return mappedText;
      }
      const priceCell = cells.find((cell) => /[¥￥]\s*\d/.test(cell) && !cell.includes('/'));
      if (priceCell) {
        return priceCell;
      }
      return '';
    };
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText || ''));
        const mapped = {};
        const size = Math.max(headers.length, cells.length);
        for (let i = 0; i < size; i += 1) {
          const key = headers[i] || `col${i}`;
          mapped[key] = cells[i] || '';
        }
        return { cells, mapped };
      })
      .filter((row) => row.cells.length >= 5);
    const parsedRows = [];
    for (const item of rows) {
      const mapped = item.mapped || {};
      const cells = item.cells || [];
      const declaredPriceText = readDeclaredPriceText(mapped, cells);
      if (!declaredPriceText) {
        continue;
      }
      const declaredPrice = toFloat(declaredPriceText, -1);
      if (declaredPrice < 0 || declaredPrice >= LOW_DECLARED_PRICE_THRESHOLD) {
        continue;
      }
      parsedRows.push({
        prepareOrderNo: mapped['备货单号'] || cells[0] || '',
        productInfo: mapped['商品信息'] || cells[1] || '',
        status: mapped['状态'] || cells[2] || '',
        skuInfo: mapped['SKU信息'] || cells[3] || '',
        declaredPrice: Math.round(declaredPrice * 100) / 100,
        createdTime: mapped['备货单创建时间'] || cells[cells.length - 2] || '',
        remark: `申报价格低于${LOW_DECLARED_PRICE_THRESHOLD}`,
        isLowPrice: true,
      });
    }
    return {
      totalRowCount: rows.length,
      hasNoData: body.includes('暂无数据'),
      rows: parsedRows,
      lowPriceCount: parsedRows.length,
      bodyPreview: body.slice(0, 3000),
    };
  }

  function getUrgentArrivalOverdueCard() {
    const strictCandidates = Array.from(document.querySelectorAll('div.quick-overdue-filter_card__plOUM,div[class*="quick-overdue-filter_card__"]'))
      .filter((el) => visible(el) && /^到货已逾期\s+\d+$/.test(normalize(el.innerText || '')));
    if (strictCandidates.length) {
      return strictCandidates[0];
    }
    const looseTarget = Array.from(document.querySelectorAll('div,span'))
      .find((el) => visible(el) && /^到货已逾期\s+\d+$/.test(normalize(el.innerText || '')));
    if (!looseTarget) {
      return null;
    }
    return looseTarget.closest('div.quick-overdue-filter_card__plOUM,div[class*="quick-overdue-filter_card__"]')
      || (looseTarget.tagName === 'DIV' ? looseTarget : looseTarget.parentElement);
  }

  function hasUrgentBlueTone(value) {
    const text = String(value || '');
    return /64\s*,\s*124\s*,\s*255/.test(text)
      || /65\s*,\s*125\s*,\s*255/.test(text)
      || /#407cff/i.test(text)
      || /#4180ff/i.test(text);
  }

  function isUrgentArrivalOverdueCardSelected(card) {
    if (!card) {
      return false;
    }
    const nodes = [
      card,
      card.parentElement,
      card.parentElement ? card.parentElement.parentElement : null,
      card.firstElementChild,
      card.lastElementChild,
    ].filter(Boolean);
    return nodes.some((node) => {
      const style = getComputedStyle(node);
      const className = String(node.className || '').toLowerCase();
      const ariaSelected = String(node.getAttribute && (node.getAttribute('aria-selected') || '')).toLowerCase();
      return hasUrgentBlueTone(style.borderColor)
        || hasUrgentBlueTone(style.backgroundColor)
        || hasUrgentBlueTone(style.color)
        || className.includes('active')
        || className.includes('selected')
        || ariaSelected === 'true';
    });
  }

  function readUrgentArrivalAllTabCount() {
    const nodes = Array.from(document.querySelectorAll('div,button,span,a'))
      .filter((el) => visible(el) && /^全部\(\d+\)$/.test(normalize(el.innerText || '')));
    if (!nodes.length) {
      return null;
    }
    const text = normalize(nodes[0].innerText || '');
    const match = text.match(/\((\d+)\)/);
    return match ? Number(match[1]) : null;
  }

  function readUrgentArrivalOverdueState() {
    const body = normalize(document.body.innerText || '');
    const isActualRow = (cells) => {
      if (!cells.length) {
        return false;
      }
      const merged = normalize(cells.join(' '));
      if (!merged || merged === '合计' || merged.startsWith('合计 ')) {
        return false;
      }
      return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(merged) || merged.includes('WB');
    };
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText || '')));
    const actualRows = rows.filter((cells) => isActualRow(cells));
    const card = getUrgentArrivalOverdueCard();
    const style = card ? getComputedStyle(card) : null;
    const borderColor = style ? String(style.borderColor || '') : '';
    const selected = isUrgentArrivalOverdueCardSelected(card);
    const allTabCount = readUrgentArrivalAllTabCount();
    return {
      body,
      hasCard: !!card,
      cardText: card ? normalize(card.innerText || '') : '',
      cardBorderColor: borderColor,
      selected,
      allTabCount,
      rowCount: rows.length,
      actualRowCount: actualRows.length,
      hasNoData: body.includes('暂无数据'),
      loading: body.includes('加载中'),
    };
  }

  function clickUrgentArrivalOverdueCard() {
    const card = getUrgentArrivalOverdueCard();
    if (!card) {
      return false;
    }
    const clickable = Array.from(card.querySelectorAll('span,div'))
      .find((el) => normalize(el.innerText || '') === '到货已逾期')
      || card.firstElementChild
      || card;
    clickLikeUser(clickable);
    return true;
  }

  function extractUrgentArrivalOverdueRows(recentDays = ARRIVAL_OVERDUE_RECENT_DAYS) {
    const headers = Array.from(document.querySelectorAll('thead th')).map((cell) => normalize(cell.innerText || ''));
    const isActualRow = (cells) => {
      if (!cells.length) {
        return false;
      }
      const merged = normalize(cells.join(' '));
      if (!merged || merged === '合计' || merged.startsWith('合计 ')) {
        return false;
      }
      return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(merged) || merged.includes('WB');
    };
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText || ''));
        const mapped = {};
        const size = Math.max(headers.length, cells.length);
        for (let i = 0; i < size; i += 1) {
          const key = headers[i] || `col${i}`;
          mapped[key] = cells[i] || '';
        }
        return { cells, mapped };
      })
      .filter((row) => isActualRow(row.cells));
    const parsedRows = [];
    for (const item of rows) {
      const mapped = item.mapped || {};
      const cells = item.cells || [];
      const prepareOrderNo = mapped['备货单号'] || cells[1] || '';
      const createdTime = mapped['备货单创建时间'] || '';
      if (!prepareOrderNo || prepareOrderNo === '-' || !createdTime) {
        continue;
      }
      const createdAt = parseDateTimeText(createdTime);
      parsedRows.push({
        prepareOrderNo,
        productInfo: mapped['商品信息'] || cells[2] || '',
        status: mapped['状态'] || cells[3] || '',
        skuInfo: mapped['SKU信息'] || cells[4] || '',
        declaredPrice: Math.round(toFloat(mapped['申报价格(CNY)'] || mapped['申报价格'] || cells[5] || 0, 0) * 100) / 100,
        deliveryInfo: mapped['送货/入库数'] || cells[7] || '',
        createdTime,
        isRecent: isRecent(createdAt, recentDays),
      });
    }
    return {
      totalRowCount: rows.length,
      hasNoData: normalize(document.body.innerText || '').includes('暂无数据'),
      rows: parsedRows,
      recentCount: parsedRows.filter((item) => item.isRecent).length,
      recentDays,
      bodyPreview: normalize(document.body.innerText || '').slice(0, 3000),
    };
  }

  async function navigateUrgentArrivalOverdue(jobId, expectedCount) {
    if (expectedCount <= 0) {
      return;
    }
    const deadline = Date.now() + 60000;
    let lastActionAt = 0;
    let lastStatus = '';
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const state = readUrgentArrivalOverdueState();
      const probablyFiltered = (Number.isFinite(state.allTabCount) && state.allTabCount > 0 && state.allTabCount <= expectedCount)
        || (state.actualRowCount > 0 && state.actualRowCount <= expectedCount);
      if (state.selected && state.actualRowCount > 0 && state.actualRowCount <= expectedCount) {
        return;
      }
      if (state.selected && state.hasNoData && expectedCount === 0) {
        return;
      }
      const now = Date.now();
      if (probablyFiltered && !state.selected) {
        const status = `到货已逾期已切到疑似结果集(${state.allTabCount ?? state.actualRowCount})，等待按钮变蓝：${state.cardText || state.body.slice(0, 80)}`;
        if (status !== lastStatus) {
          await updateJobMessage(status);
          lastStatus = status;
        }
        await checkedSleep(jobId, 1800, 120);
        continue;
      }
      if (state.hasCard && !state.selected && now - lastActionAt >= 1500) {
        if (!clickUrgentArrivalOverdueCard()) {
          throw new Error('未找到到货已逾期筛选按钮');
        }
        lastActionAt = now;
        await checkedSleep(jobId, 2000, 120);
        continue;
      }
      const status = `到货已逾期筛选处理中，等待按钮变蓝并切表：${state.body.slice(0, 80)}`;
      if (status !== lastStatus) {
        await updateJobMessage(status);
        lastStatus = status;
      }
      await checkedSleep(jobId, 2000, 120);
    }
    throw new Error('等待到货已逾期列表切换超时');
  }

  async function waitExtractUrgentArrivalOverdueRows(jobId, recentDays = ARRIVAL_OVERDUE_RECENT_DAYS) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const result = extractUrgentArrivalOverdueRows(recentDays);
      if ((result.totalRowCount && result.totalRowCount > 0) || result.hasNoData || /暂无数据/.test(result.bodyPreview || '')) {
        return result;
      }
      await updateJobMessage('到货已逾期列表已打开，等待表格行渲染...');
      await checkedSleep(jobId, 1500, 120);
    }
    throw new Error('读取到货已逾期明细超时');
  }

  async function navigateUrgentPendingPriceTab(jobId) {
    const deadline = Date.now() + 60000;
    let lastActionAt = 0;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const state = readUrgentPendingPriceState();
      const now = Date.now();
      if (state.pendingTabSeen && !state.activeTabText.startsWith('待发货') && now - lastActionAt >= 1000) {
        clickUrgentPendingTab();
        lastActionAt = now;
        await checkedSleep(jobId, 1800, 120);
        continue;
      }
      if (state.activeTabText.startsWith('待发货') && state.hasPriceHeader) {
        if (!state.loading && (state.rowCount > 0 || state.hasNoData || toInt(state.pendingCount) === 0)) {
          return;
        }
        await updateJobMessage(`检查待发货低申报价页已打开，等待列表加载：${state.body.slice(0, 80)}`);
      } else {
        await updateJobMessage(`检查待发货低申报价页切换中：${state.body.slice(0, 80)}`);
      }
      await checkedSleep(jobId, 1500, 120);
    }
    throw new Error('等待检查待发货低申报价页超时');
  }

  async function waitExtractUrgentPendingPriceRows(jobId) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const result = extractUrgentPendingPriceRows();
      if ((result.totalRowCount && result.totalRowCount > 0) || result.hasNoData || /暂无数据/.test(result.bodyPreview || '')) {
        return result;
      }
      await updateJobMessage('检查待发货低申报价页已打开，但表格行还没渲染完...');
      await checkedSleep(jobId, 1500, 120);
    }
    throw new Error('读取待发货低申报价明细超时');
  }

  function extractGovernMetrics() {
    const body = normalize(document.body.innerText || '');
    const sectionStart = body.indexOf('涉嫌违反政策');
    let section = body;
    if (sectionStart >= 0) {
      const endMarkers = ['展开', '全部消息', '重要通知'];
      let sectionEnd = -1;
      for (const marker of endMarkers) {
        const index = body.indexOf(marker, sectionStart + 1);
        if (index > sectionStart && (sectionEnd < 0 || index < sectionEnd)) {
          sectionEnd = index;
        }
      }
      section = body.slice(sectionStart, sectionEnd > sectionStart ? sectionEnd : body.length);
    }
    const readCount = (label) => {
      const regex = new RegExp(`${escapeRegExp(label)}\\s*(\\d[\\d,]*)`);
      const match = section.match(regex);
      return match ? Number(match[1].replace(/,/g, '')) : null;
    };
    return {
      ipComplaintCount: readCount('知识产权投诉'),
      troCount: readCount('临时限制令（TRO）'),
      ready: section.includes('涉嫌违反政策') && section.includes('知识产权投诉') && section.includes('临时限制令（TRO）'),
      bodyPreview: body.slice(0, 3000),
    };
  }

  function readViolationState() {
    const title = normalize(document.title || '');
    const body = normalize(document.body.innerText || '');
    const queryButton = Array.from(document.querySelectorAll('button,a,span,div'))
      .find((el) => visible(el) && normalize(el.innerText || el.textContent || '') === '查询');
    const rowCount = Array.from(document.querySelectorAll('tbody tr')).filter((row) => visible(row)).length;
    const totalMatch = body.match(/(?:共有|共)\s*(\d+)\s*条/);
    return {
      url: location.href,
      title,
      body: body.slice(0, 5000),
      rowCount,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : null,
      hasNoData: body.includes('暂无数据') || body.includes('暂无结果'),
      hasQueryButton: !!queryButton,
      loading: body.includes('加载中') || body.includes('查询中'),
      ready: body.includes('违规发起时间') || body.includes('违规类型') || body.includes('违规金额'),
    };
  }

  function extractViolationRows() {
    const headers = Array.from(document.querySelectorAll('thead th')).map((cell) => normalize(cell.innerText));
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText));
        const mapped = {};
        const size = Math.max(headers.length, cells.length);
        for (let index = 0; index < size; index += 1) {
          const key = headers[index] || `col${index}`;
          mapped[key] = cells[index] || '';
        }
        return {
          cells,
          mapped,
        };
      })
      .filter((row) => row.cells.length >= 8);
    const body = normalize(document.body.innerText || '');
    const totalMatch = body.match(/(?:共有|共)\s*(\d+)\s*条/);
    const parsedRows = rows.map(({ mapped, cells }) => {
      const violationTime = pickMappedValue(mapped, ['违规发起时间'], cells[6] || '');
      const progress = pickMappedValue(mapped, ['进度'], cells[10] || '');
      return {
        violationNo: pickMappedValue(mapped, ['违规编号'], cells[2] || ''),
        prepareOrderNo: pickMappedValue(mapped, ['备货单'], cells[3] || ''),
        prepareOrderType: pickMappedValue(mapped, ['备货单类型'], cells[4] || ''),
        violationType: pickMappedValue(mapped, ['违规类型'], cells[5] || ''),
        violationTime,
        amount: pickMappedValue(mapped, ['违规金额(CNY)'], cells[7] || ''),
        reducedAmount: pickMappedValue(mapped, ['减免后违规金额'], cells[9] || ''),
        progress,
        action: pickMappedValue(mapped, ['操作'], cells[11] || ''),
        needsManual: violationNeedsManual(progress),
      };
    });
    return {
      url: location.href,
      title: document.title,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : null,
      bodyPreview: body.slice(0, 5000),
      rows: parsedRows,
      pendingCount: parsedRows.filter((row) => row.needsManual).length,
    };
  }

  function readLimitedState() {
    const title = normalize(document.title || '');
    const body = normalize(document.body.innerText || '');
    const rowCount = Array.from(document.querySelectorAll('tbody tr')).filter((row) => visible(row)).length;
    const totalMatch = body.match(/(?:共有|共)\s*(\d+)\s*条/);
    return {
      url: location.href,
      title,
      body: body.slice(0, 5000),
      rowCount,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : null,
      hasNoData: body.includes('暂无数据') || body.includes('暂无结果'),
      loading: body.includes('加载中') || body.includes('查询中'),
      ready: body.includes('限制记录') || body.includes('限制原因') || body.includes('限制金额说明'),
    };
  }

  function extractLimitedRows() {
    const headers = Array.from(document.querySelectorAll('thead th')).map((cell) => normalize(cell.innerText));
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText));
        const mapped = {};
        const size = Math.max(headers.length, cells.length);
        for (let index = 0; index < size; index += 1) {
          const key = headers[index] || `col${index}`;
          mapped[key] = cells[index] || '';
        }
        const reason = pickMappedValue(mapped, ['限制原因'], cells[0] || '');
        const amount = pickMappedValue(mapped, ['当前限制总金额(CNY)', '当前限制总金额'], cells[1] || '');
        const description = pickMappedValue(mapped, ['限制金额说明', '说明'], cells[2] || '');
        const action = pickMappedValue(mapped, ['操作'], cells[3] || '');
        const rowText = normalize(cells.join(' '));
        return {
          cells,
          mapped,
          reason,
          amount,
          description,
          action,
          rowText,
          needsManual: rowText.includes('店铺违反适用法律法规'),
        };
      })
      .filter((row) => row.cells.length >= 3);
    const body = normalize(document.body.innerText || '');
    const totalMatch = body.match(/(?:共有|共)\s*(\d+)\s*条/);
    const matchedRows = rows.filter((row) => row.needsManual);
    return {
      url: location.href,
      title: document.title,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : null,
      bodyPreview: body.slice(0, 5000),
      rows,
      matchedRows,
      matchedCount: matchedRows.length,
      needsManual: matchedRows.length > 0,
    };
  }

  function readShippingFilterState() {
    const body = normalize(document.body.innerText || '');
    const jitRow = Array.from(document.querySelectorAll('.index-module__row___OoknQ')).find((el) => {
      const label = el.querySelector('.index-module__row_label___3WV-t');
      return label && normalize(label.innerText) === '是否JIT';
    });
    const jitInput = jitRow ? jitRow.querySelector('input[data-testid="beast-core-select-htmlInput"]') : null;
    const activeTab = Array.from(document.querySelectorAll('.TAB_active, .TAB_lineLabelActive_5-117-0'))
      .map((el) => normalize(el.innerText))
      .find(Boolean) || '';
    const totalMatch = body.match(/共有\s*(\d+)\s*条/);
    return {
      body,
      isExpanded: body.includes('是否JIT') && body.includes('发货时间'),
      jitValue: jitInput ? normalize(jitInput.value || '') : '',
      activeTab,
      rowCount: document.querySelectorAll('tbody tr').length,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : null,
      hasNoData: body.includes('暂无数据'),
    };
  }

  function clickShippingExpand() {
    const target = Array.from(document.querySelectorAll('a,button,div,span')).find((el) => visible(el) && normalize(el.innerText) === '展开');
    if (target) {
      target.click();
      return true;
    }
    return false;
  }

  function setShippingJitNo() {
    const row = Array.from(document.querySelectorAll('.index-module__row___OoknQ')).find((el) => {
      const label = el.querySelector('.index-module__row_label___3WV-t');
      return label && normalize(label.innerText) === '是否JIT';
    });
    if (!row) {
      return false;
    }
    const input = row.querySelector('input[data-testid="beast-core-select-htmlInput"]');
    if (input && normalize(input.value || '') === '否') {
      return true;
    }
    const header = row.querySelector('[data-testid="beast-core-select-header"], [data-testid="beast-core-select"]');
    if (!header) {
      return false;
    }
    header.click();
    const option = Array.from(document.querySelectorAll('li,div,span')).find((el) => visible(el) && normalize(el.innerText) === '否');
    if (!option) {
      return false;
    }
    option.click();
    return true;
  }

  async function ensureShippingJitNo(jobId) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const state = readShippingFilterState();
      if (state.jitValue === '否') {
        return true;
      }
      const row = Array.from(document.querySelectorAll('.index-module__row___OoknQ')).find((el) => {
        const label = el.querySelector('.index-module__row_label___3WV-t');
        return label && normalize(label.innerText) === '是否JIT';
      });
      if (!row) {
        return false;
      }
      const option = Array.from(document.querySelectorAll('li,div,span')).find((el) => visible(el) && normalize(el.innerText) === '否');
      if (option) {
        option.click();
        await checkedSleep(jobId, 500, 100);
        continue;
      }
      const opened = setShippingJitNo();
      if (!opened) {
        return false;
      }
      await checkedSleep(jobId, 500, 100);
    }
    return readShippingFilterState().jitValue === '否';
  }

  function clickShippingQuery() {
    const target = Array.from(document.querySelectorAll('button,div,span')).find((el) => visible(el) && normalize(el.innerText) === '查询');
    if (target) {
      target.click();
      return true;
    }
    return false;
  }

  function clickShippingWaitingTab() {
    const active = Array.from(document.querySelectorAll('.TAB_active, .TAB_lineLabelActive_5-117-0'))
      .map((el) => normalize(el.innerText))
      .find(Boolean);
    if (active === '待仓库收货') {
      return true;
    }
    const target = Array.from(document.querySelectorAll('div,span,a')).find((el) => visible(el) && normalize(el.innerText) === '待仓库收货');
    if (target) {
      target.click();
      return true;
    }
    return false;
  }

  function extractShippingRows() {
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => ({
        cells: Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText)),
      }))
      .filter((row) => row.cells.length >= 10);
    const parsedRows = rows.map((item) => {
      const cells = item.cells;
      const nodeInfo = cells[9] || '';
      const status = cells[10] || '';
      const productInfo = cells[4] || '';
      const logisticsInfo = cells[2] || '';
      const shippingOrderInfo = cells[3] || '';
      const shippingOrderNo = shippingOrderInfo.split(/\s+/)[0] || '';
      const prepareOrderNo = extractTextAfterLabel(productInfo, '备货单号');
      const shipTime = parseShippingDatetime(nodeInfo, '发货时间');
      const receiveTime = parseShippingDatetime(nodeInfo, '收货时间');
      return {
        shippingOrderNo,
        prepareOrderNo,
        productInfo,
        shippingInfo: logisticsInfo,
        nodeInfo,
        status,
        shipTimeText: shipTime ? shipTime.toISOString().slice(0, 19).replace('T', ' ') : '',
        receiveTimeText: receiveTime ? receiveTime.toISOString().slice(0, 19).replace('T', ' ') : '',
        isStale: isOlderThanDays(shipTime, SHIPPING_STALE_DAYS),
      };
    });
    return {
      rows: parsedRows,
      staleCount: parsedRows.filter((row) => row.isStale).length,
      bodyPreview: normalize(document.body.innerText || '').slice(0, 3000),
    };
  }

  function readReturnOrderState() {
    const body = normalize(document.body.innerText || '');
    const queryButton = Array.from(document.querySelectorAll('button,a,span,div')).find((el) => visible(el) && normalize(el.innerText) === '查询');
    const rowCount = Array.from(document.querySelectorAll('tbody tr')).filter((row) => visible(row)).length;
    const totalMatch = body.match(/(?:共有|共)\s*(\d+)\s*条/);
    return {
      body,
      rowCount,
      totalRowsText: totalMatch ? Number(totalMatch[1]) : null,
      hasNoData: body.includes('暂无数据') || body.includes('暂无结果'),
      hasQueryButton: !!queryButton,
    };
  }

  function clickReturnOrderQuery() {
    const button = Array.from(document.querySelectorAll('button,a,span,div')).find((el) => visible(el) && normalize(el.innerText) === '查询');
    if (button) {
      button.click();
      return true;
    }
    return false;
  }

  function extractReturnOrderRows() {
    const headers = Array.from(document.querySelectorAll('thead th')).map((cell) => normalize(cell.innerText));
    const rows = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => visible(row))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.innerText));
        const mapped = {};
        const size = Math.max(headers.length, cells.length);
        for (let index = 0; index < size; index += 1) {
          const key = headers[index] || `col${index}`;
          mapped[key] = cells[index] || '';
        }
        return { mapped, cells };
      })
      .filter((row) => row.cells.length >= 6);
    const pick = (mapped, cells, candidates, index) => {
      for (const key of candidates) {
        if (mapped[key]) {
          return mapped[key];
        }
      }
      return cells[index] || '';
    };
    const parsedRows = rows.map(({ mapped, cells }) => ({
      returnPackageNo: pick(mapped, cells, ['退货包裹号'], 2),
      trackingNo: pick(mapped, cells, ['运单号', '快递单号'], 3),
      carrier: pick(mapped, cells, ['物流商', '快递公司'], 10),
      status: pick(mapped, cells, ['状态'], 6),
      packCompleteTime: pick(mapped, cells, ['打包完成时间'], 11),
      outboundTime: pick(mapped, cells, ['出库时间'], 12),
    }));
    return {
      rows: parsedRows,
      count: parsedRows.length,
      bodyPreview: normalize(document.body.innerText || '').slice(0, 3000),
    };
  }

  function extractFundsBalance() {
    const body = normalize(document.body.innerText || '');
    const match = body.match(/可用余额(?:\s*\(CNY\))?\s*[¥￥]?\s*([0-9][0-9,]*(?:\.\d+)?)/);
    const availableBalance = match ? Number(match[1].replace(/,/g, '')) : null;
    return {
      availableBalance,
      balanceText: match ? match[1] : '',
      needWithdraw: availableBalance !== null && availableBalance > WITHDRAW_ALERT_THRESHOLD,
      ready: body.includes('可用余额') && availableBalance !== null,
      bodyPreview: body.slice(0, 3000),
    };
  }

  function getPriceTabs() {
    const isActiveTabNode = (el) => {
      const chain = [el, el && el.parentElement, el && el.parentElement && el.parentElement.parentElement].filter(Boolean);
      return chain.some((node) => {
        const className = String(node.className || '');
        const ariaSelected = String(node.getAttribute && node.getAttribute('aria-selected') || '').toLowerCase();
        return className.includes('TAB_active') || className.includes('tab-active') || className.includes('is-active') || className.includes('active') || ariaSelected === 'true';
      });
    };
    return Array.from(document.querySelectorAll('div,button,span,a'))
      .filter((el) => visible(el))
      .map((el) => ({
        element: el,
        text: normalize(el.innerText || ''),
        active: isActiveTabNode(el),
      }))
      .filter((item) => /^价格申报中\(\d+\)$/.test(item.text) || /^待卖家确认\(\d+\)$/.test(item.text) || /^成功\(\d+\)$/.test(item.text) || /^失败\(\d+\)$/.test(item.text));
  }

  function clickLikeUser(el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try {
        el.dispatchEvent(new MouseEvent(type, options));
      } catch (_error) {}
    });
    try {
      el.click();
    } catch (_error) {}
    return true;
  }

  function isDisabled(el) {
    if (!el) {
      return true;
    }
    const ariaDisabled = String(el.getAttribute && el.getAttribute('aria-disabled') || '').toLowerCase();
    const className = String(el.className || '').toLowerCase();
    return el.disabled === true || ariaDisabled === 'true' || className.includes('disabled') || className.includes('is-disabled');
  }

  function isCheckboxChecked(wrap) {
    if (!wrap) {
      return false;
    }
    if (wrap.matches && wrap.matches('input[type="checkbox"]')) {
      return !!wrap.checked;
    }
    const input = wrap.querySelector && wrap.querySelector('input[type="checkbox"]');
    if (input) {
      return !!input.checked;
    }
    const ariaNode = wrap.matches && wrap.matches('[aria-checked]') ? wrap : (wrap.querySelector && wrap.querySelector('[aria-checked]'));
    if (ariaNode) {
      return String(ariaNode.getAttribute('aria-checked') || '').toLowerCase() === 'true';
    }
    const className = String(wrap.className || '').toLowerCase();
    return className.includes('checked') || className.includes('selected');
  }

  function setCheckboxChecked(wrap, target) {
    if (!wrap) {
      return false;
    }
    if (isCheckboxChecked(wrap) === target) {
      return true;
    }
    const candidates = [
      wrap,
      wrap.querySelector && wrap.querySelector('[role="checkbox"]'),
      wrap.querySelector && wrap.querySelector('[aria-checked]'),
      wrap.querySelector && wrap.querySelector('input[type="checkbox"]'),
      wrap.parentElement,
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        candidate.click();
      } catch (_error) {}
      if (isCheckboxChecked(wrap) === target) {
        return true;
      }
      clickLikeUser(candidate);
      if (isCheckboxChecked(wrap) === target) {
        return true;
      }
    }
    return isCheckboxChecked(wrap) === target;
  }

  async function ensureWaitingTab(jobId) {
    const start = Date.now();
    while (Date.now() - start < 6000) {
      await assertNotStopped(jobId);
      const tabs = getPriceTabs();
      const waitingTab = tabs.find((item) => /^待卖家确认\(\d+\)$/.test(item.text));
      if (!waitingTab) {
        await checkedSleep(jobId, 200, 100);
        continue;
      }
      if (waitingTab.active) {
        return waitingTab.text;
      }
      const target = waitingTab.element.closest('[role="tab"],button,a,div,span') || waitingTab.element.parentElement || waitingTab.element;
      clickLikeUser(target);
      clickLikeUser(target.parentElement);
      await checkedSleep(jobId, 400, 100);
    }
    return '';
  }

  function readPriceRulePageState() {
    const body = normalize(document.body.innerText || '');
    const tabs = getPriceTabs();
    const waitingTab = tabs.find((item) => /^待卖家确认\(\d+\)$/.test(item.text)) || null;
    const activeTab = tabs.find((item) => item.active) || null;
    const waitingMatch = waitingTab ? waitingTab.text.match(/\((\d+)\)/) : null;
    const sizeChanger = Array.from(document.querySelectorAll('li,div,span')).find((el) => String(el.className || '').includes('PGT_sizeChanger'));
    const sizeInput = sizeChanger ? sizeChanger.querySelector('[data-testid="beast-core-select-htmlInput"], input') : null;
    const pageSize = sizeInput ? normalize(sizeInput.value || sizeInput.getAttribute('value') || '') : '';
    const batchButton = Array.from(document.querySelectorAll('button')).find((el) => visible(el) && normalize(el.innerText || '').includes('批量处理'));
    const table = Array.from(document.querySelectorAll('table')).find((el) => {
      const text = normalize(el.innerText || '');
      return text.includes('货品信息') && text.includes('调整后申报价格');
    });
    return {
      body,
      waitingCount: waitingMatch ? Number(waitingMatch[1]) : 0,
      activeTabText: activeTab ? activeTab.text : '',
      waitingTabSeen: !!waitingTab,
      priceTabsReady: tabs.length > 0,
      pageSize,
      rowCount: Array.from(document.querySelectorAll('tbody tr')).filter((row) => visible(row)).length,
      hasBatchButton: !!batchButton,
      hasTable: !!table,
      hasNoData: body.includes('暂无数据') || body.includes('暂无结果'),
      };
  }

  function setPriceRulePageSize100() {
    const sizeChanger = Array.from(document.querySelectorAll('li,div,span')).find((el) => String(el.className || '').includes('PGT_sizeChanger'));
    if (!sizeChanger) {
      return false;
    }
    const input = sizeChanger.querySelector('[data-testid="beast-core-select-htmlInput"], input');
    const current = input ? normalize(input.value || input.getAttribute('value') || '') : '';
    if (current === '100') {
      return true;
    }
    const header = sizeChanger.querySelector('[data-testid="beast-core-select-header"], [data-testid="beast-core-select"]');
    if (!header) {
      return false;
    }
    header.click();
    const option = Array.from(document.querySelectorAll('[role="option"],li,div,span')).find((el) => visible(el) && normalize(el.innerText || '') === '100');
    if (!option) {
      return false;
    }
    option.click();
    return true;
  }

  async function waitPriceRulePageSize(jobId, expectedValue, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const state = readPriceRulePageState();
      if (normalize(state.pageSize) === String(expectedValue)) {
        return true;
      }
      await checkedSleep(jobId, 250, 100);
    }
    return normalize(readPriceRulePageState().pageSize) === String(expectedValue);
  }

  async function waitPriceRuleReady(jobId) {
    const deadline = Date.now() + 90000;
    let pageSizeAttempts = 0;
    let zeroWaitSeenAt = 0;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const dismissed = dismissPricePageInterferenceDialogs();
      if (dismissed.clickedCount > 0) {
        await updateJobMessage(`价格申报页检测到干扰弹窗，已尝试关闭 ${dismissed.clickedTexts.join('、')}`);
        await checkedSleep(jobId, 1200, 120);
        continue;
      }
      const state = readPriceRulePageState();
      if (!state.priceTabsReady) {
        await updateJobMessage('价格申报页已打开，等待标签区加载...');
        await checkedSleep(jobId, 1000);
        continue;
      }
      if (state.waitingCount <= 0 && state.waitingTabSeen) {
        if (!zeroWaitSeenAt) {
          zeroWaitSeenAt = Date.now();
        } else if (Date.now() - zeroWaitSeenAt >= 2000) {
          return { waitingCount: 0, pageSize: state.pageSize, rowCount: state.rowCount };
        }
      } else {
        zeroWaitSeenAt = 0;
      }
      if (state.waitingCount > 0 && (!state.activeTabText.startsWith('待卖家确认') || (state.rowCount === 0 && state.hasNoData))) {
        await ensureWaitingTab(jobId);
        await checkedSleep(jobId, 1200);
        continue;
      }
      if (state.waitingCount <= 0) {
        await updateJobMessage('价格申报页已打开，但待卖家确认计数还未稳定，继续等待...');
        await checkedSleep(jobId, 1000);
        continue;
      }
      const currentPageSize = toInt(state.pageSize, 0);
      if (state.activeTabText.startsWith('待卖家确认') && state.waitingCount > Math.max(currentPageSize, 10) && state.pageSize !== '100' && pageSizeAttempts < 3) {
        setPriceRulePageSize100();
        pageSizeAttempts += 1;
        await waitPriceRulePageSize(jobId, '100', 6000);
        await checkedSleep(jobId, 1200);
        continue;
      }
      const targetRows = Math.min(state.waitingCount, 100);
      if (state.activeTabText.startsWith('待卖家确认') && state.hasTable && state.hasBatchButton && state.rowCount >= Math.max(1, targetRows)) {
        return {
          waitingCount: state.waitingCount,
          pageSize: state.pageSize,
          rowCount: state.rowCount,
        };
      }
      await updateJobMessage(`价格申报页已打开，等待待卖家确认列表加载：${state.body.slice(0, 80)}`);
      await checkedSleep(jobId, 1500);
    }
    throw new Error('等待价格申报页超时');
  }

  function findPriceDialogs() {
    return Array.from(document.querySelectorAll('div,[role="dialog"]'))
      .filter((el) => visible(el))
      .filter((el) => /已勾选商品共有|是否调整申报价格|确认批量处理|确认后不可撤销|确认提交|请确认/.test(el.innerText || ''));
  }

  function dismissPricePageInterferenceDialogs() {
    const priceDialogs = new Set(findPriceDialogs());
    const dialogs = Array.from(document.querySelectorAll('div,[role="dialog"],div[class*="modal"],div[class*="dialog"]'))
      .filter((el) => visible(el))
      .filter((el) => !priceDialogs.has(el));
    const closeTexts = [
      '知道了',
      '我知道了',
      '关闭',
      '暂不处理',
      '暂不',
      '跳过',
      '稍后',
      '下次再说',
      '以后再说',
      '取消',
      '10分钟后再提醒',
      '已读 & 今日不再提示',
      '已读&今日不再提示',
      '已读',
      '今日不再提示',
    ];
    const clicked = [];
    for (const dialog of dialogs) {
      const button = Array.from(dialog.querySelectorAll('button,[role="button"],span,div,a'))
        .filter((el) => visible(el))
        .find((el) => {
          const text = normalize(el.innerText || el.textContent || '');
          if (closeTexts.includes(text)) {
            return true;
          }
          const className = String(el.className || '').toLowerCase();
          const ariaLabel = normalize(el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || ''));
          return className.includes('close') || ariaLabel === '关闭' || ariaLabel === 'close' || text === '×' || text === 'x';
        });
      if (button) {
        const text = normalize(button.innerText || button.textContent || '') || '关闭';
        clickLikeUser(button.closest('button,[role="button"],a,div,span') || button);
        clicked.push(text);
      }
    }
    return {
      clickedCount: clicked.length,
      clickedTexts: clicked,
    };
  }

  function findPrimaryPriceModal() {
    const dialogs = findPriceDialogs();
    return dialogs.find((el) => el.querySelector('table') && /已勾选商品共有|是否调整申报价格/.test(el.innerText || ''))
      || dialogs.find((el) => el.querySelector('table'))
      || dialogs[0]
      || null;
  }

  function findConfirmActionButton(root) {
    if (!root) {
      return null;
    }
    const candidates = Array.from(root.querySelectorAll('button,[role="button"],span,div,a'))
      .filter((el) => visible(el))
      .filter((el) => ['确认', '确定', '提交'].includes(normalize(el.innerText || el.textContent || '')));
    return candidates.find((el) => !isDisabled(el.closest('button,[role="button"],a,div,span') || el)) || null;
  }

  function findModalScrollContainer(modal) {
    if (!modal) {
      return null;
    }
    const table = modal.querySelector('table');
    if (!table) {
      return null;
    }
    let node = table.parentElement;
    while (node && node !== modal) {
      const style = getComputedStyle(node);
      if ((/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflow))
        && node.scrollHeight > node.clientHeight + 24) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function buildRowFingerprint(row) {
    return normalize(row && row.innerText || '');
  }

  async function processPriceRuleModalRows(jobId, modal, selectedRules, modalIdx) {
    const actionIdx = modalIdx.action >= 0 ? modalIdx.action : 7;
    const scrollContainer = findModalScrollContainer(modal);
    const processedFingerprints = new Set();
    const preview = [];
    let actedCount = 0;
    let protectedCount = 0;
    let unmatchedModalRows = 0;
    let nextSelectedIndex = 0;
    let stagnantTurns = 0;
    const deadline = Date.now() + 30000;

    const processVisibleRows = async () => {
      let newRows = 0;
      const rows = Array.from(modal.querySelectorAll('table tbody tr')).filter((row) => visible(row));
      for (const row of rows) {
        await assertNotStopped(jobId);
        const fingerprint = buildRowFingerprint(row);
        if (!fingerprint || processedFingerprints.has(fingerprint)) {
          continue;
        }
        processedFingerprints.add(fingerprint);
        newRows += 1;
        const cells = row.querySelectorAll('td');
        const cell = cells[actionIdx >= 0 ? Math.min(actionIdx, cells.length - 1) : Math.min(7, cells.length - 1)];
        const matched = selectedRules[nextSelectedIndex];
        if (!matched || !cell) {
          unmatchedModalRows += 1;
          continue;
        }
        const currentPrice = modalIdx.currentPrice >= 0 ? toFloat(cells[modalIdx.currentPrice] && cells[modalIdx.currentPrice].innerText) : NaN;
        const targetPrice = modalIdx.targetPrice >= 0 ? toFloat(cells[modalIdx.targetPrice] && cells[modalIdx.targetPrice].innerText) : NaN;
        let finalAction = matched.action;
        if (matched.protectDiff && Number.isFinite(currentPrice) && Number.isFinite(targetPrice) && Math.abs(currentPrice - targetPrice) > matched.protectDiffLimit) {
          finalAction = '不调整';
          protectedCount += 1;
        }
        const button = Array.from(cell.querySelectorAll('span,button,div,label')).find((el) => normalize(el.textContent || '') === finalAction);
        if (button) {
          clickLikeUser(button);
          actedCount += 1;
        }
        preview.push({
          name: matched.name,
          price: matched.price,
          currentPrice,
          targetPrice,
          action: matched.action,
          finalAction,
          keyword: matched.kw,
        });
        nextSelectedIndex += 1;
      }
      return newRows;
    };

    while (Date.now() < deadline) {
      const newRows = await processVisibleRows();
      if (actedCount >= selectedRules.length) {
        break;
      }
      if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 12) {
        break;
      }
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const currentScrollTop = scrollContainer.scrollTop;
      const nextScrollTop = Math.min(maxScrollTop, currentScrollTop + Math.max(220, Math.floor(scrollContainer.clientHeight * 0.82)));
      if (nextScrollTop <= currentScrollTop + 1) {
        stagnantTurns += 1;
        if (stagnantTurns >= 2) {
          break;
        }
      } else {
        stagnantTurns = 0;
        scrollContainer.scrollTop = nextScrollTop;
      }
      if (newRows === 0 && stagnantTurns >= 1) {
        break;
      }
      await checkedSleep(jobId, 420, 120);
    }

    return {
      actedCount,
      protectedCount,
      unmatchedModalRows,
      preview,
      discoveredRows: processedFingerprints.size,
      hasScrollContainer: !!scrollContainer,
    };
  }

  async function finishPriceRuleDialogs(jobId, primaryModal, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let followupClicks = 0;
    while (Date.now() < deadline) {
      await assertNotStopped(jobId);
      const dialogs = findPriceDialogs();
      const followup = dialogs.find((el) => el !== primaryModal && /确认批量处理|确认后不可撤销|请确认|确认提交/.test(el.innerText || ''));
      if (followup) {
        const button = findConfirmActionButton(followup);
        if (button) {
          clickLikeUser(button);
          followupClicks += 1;
          await checkedSleep(jobId, 600, 120);
          continue;
        }
      }
      const primaryExists = primaryModal && document.contains(primaryModal) && visible(primaryModal);
      const anyDialog = dialogs.some((el) => visible(el));
      if (!primaryExists && !anyDialog) {
        return { closed: true, followupClicks };
      }
      await checkedSleep(jobId, 220, 100);
    }
    return { closed: false, followupClicks };
  }

  async function runPriceRuleAssistantOnPage(jobId, ruleConfig) {
    const pageState = readPriceRulePageState();
    const initialWaitingCount = toInt(pageState.waitingCount, 0);
    if (initialWaitingCount <= 0) {
      return {
        waitingCount: 0,
        matchedCount: 0,
        actedCount: 0,
        protectedCount: 0,
        unmatchedModalRows: 0,
        remainingCount: 0,
        selectedPreview: [],
        stage: 'done',
        confirmPending: false,
        confirmed: false,
        message: '待卖家确认为 0',
      };
    }

    const dismissedBeforeRun = dismissPricePageInterferenceDialogs();
    if (dismissedBeforeRun.clickedCount > 0) {
      await updateJobMessage(`价格申报自动助手：已先关闭干扰弹窗 ${dismissedBeforeRun.clickedTexts.join('、')}`);
      await checkedSleep(jobId, 1000, 120);
    }
    await ensureWaitingTab(jobId);
    const dismissedAfterTab = dismissPricePageInterferenceDialogs();
    if (dismissedAfterTab.clickedCount > 0) {
      await updateJobMessage(`价格申报自动助手：切到待确认后关闭干扰弹窗 ${dismissedAfterTab.clickedTexts.join('、')}`);
      await checkedSleep(jobId, 800, 120);
    }
    await updateJobMessage('价格申报自动助手：第1步筛选勾选中...');

    const table = Array.from(document.querySelectorAll('table')).find((entry) => {
      const text = normalize(entry.innerText || '');
      return text.includes('货品信息') && text.includes('调整后申报价格') && text.includes('操作');
    });
    if (!table) {
      throw new Error('没找到价格申报列表');
    }

    const headers = Array.from(table.querySelectorAll('thead th, tr th')).map((th) => normalize(th.innerText || ''));
    const nameIdx = headers.findIndex((text) => text.includes('货品信息'));
    const priceIdx = headers.findIndex((text) => text.includes('调整后申报价'));
    if (nameIdx < 0 || priceIdx < 0) {
      throw new Error('价格列表列识别失败');
    }

    const rows = Array.from(table.querySelectorAll('tbody tr')).filter((row) => visible(row));
    const selectedRules = [];
    for (const tr of rows) {
      await assertNotStopped(jobId);
      const tds = tr.querySelectorAll('td');
      if (tds.length <= Math.max(nameIdx, priceIdx)) {
        continue;
      }
      const name = normalize(tds[nameIdx] ? tds[nameIdx].innerText : '');
      const price = toFloat(tds[priceIdx] ? tds[priceIdx].innerText : '');
      const td0 = tr.querySelector('td');
      const wrap = td0 ? (td0.querySelector('[role="checkbox"], input[type="checkbox"], [aria-checked]') || td0.firstElementChild || td0) : null;
      if (!wrap || !name || !Number.isFinite(price)) {
        continue;
      }
      const matchedRule = (ruleConfig.rules || []).find((rule) => name.includes(rule.kw) && price >= rule.min && price <= rule.max) || null;
      if (matchedRule) {
        if (!setCheckboxChecked(wrap, true)) {
          await checkedSleep(jobId, 120, 60);
        }
        if (!setCheckboxChecked(wrap, true)) {
          continue;
        }
        selectedRules.push({
          name,
          price,
          action: matchedRule.action,
          kw: matchedRule.kw,
          protectDiff: !!ruleConfig.protectDiff,
          protectDiffLimit: Math.max(0, toFloat(ruleConfig.protectDiffLimit, 1)),
        });
      } else {
        setCheckboxChecked(wrap, false);
      }
    }

    if (!selectedRules.length) {
      return {
        waitingCount: initialWaitingCount,
        matchedCount: 0,
        actedCount: 0,
        protectedCount: 0,
        unmatchedModalRows: 0,
        remainingCount: initialWaitingCount,
        selectedPreview: [],
        stage: 'done',
        confirmPending: false,
        confirmed: false,
        message: `没有命中项（已加载${(ruleConfig.rules || []).length}条规则），剩余${initialWaitingCount}条待人工处理`,
      };
    }

    const batchButton = Array.from(document.querySelectorAll('button')).find((el) => visible(el) && normalize(el.innerText || '').includes('批量处理'));
    if (!batchButton) {
      throw new Error('批量处理按钮不可点');
    }
    batchButton.click();
    await updateJobMessage(`价格申报自动助手：第2步等待弹窗（已命中${selectedRules.length}条）...`);

    let modal = null;
    const modalDeadline = Date.now() + 10000;
    while (Date.now() < modalDeadline) {
      modal = findPrimaryPriceModal();
      if (modal) {
        break;
      }
      await assertNotStopped(jobId);
      await checkedSleep(jobId, 120, 60);
    }
    if (!modal) {
      throw new Error('未出现价格申报批量弹窗');
    }

    const modalHeaders = Array.from(modal.querySelectorAll('thead th, tr th')).map((th) => normalize(th.innerText || ''));
    const modalIdx = {
      currentPrice: modalHeaders.findIndex((text) => text.includes('当前申报价格') || text.includes('当前申报价')),
      targetPrice: modalHeaders.findIndex((text) => text.includes('调整后申报价格') || text.includes('调整后申报价')),
      action: modalHeaders.findIndex((text) => text.includes('是否调整申报价格') || text.includes('操作')),
    };

    await updateJobMessage(`价格申报自动助手：批量弹窗已打开，开始处理 ${selectedRules.length} 条...`);
    const modalResult = await processPriceRuleModalRows(jobId, modal, selectedRules, modalIdx);
    const actedCount = modalResult.actedCount;
    const protectedCount = modalResult.protectedCount;
    const unmatchedModalRows = modalResult.unmatchedModalRows;
    const preview = modalResult.preview;
    const remainingCount = Math.max(initialWaitingCount - actedCount, 0);
    const canAutoConfirm = actedCount >= selectedRules.length && unmatchedModalRows === 0;
    if (!canAutoConfirm) {
      const reason = modalResult.hasScrollContainer
        ? `第一层批量弹窗只自动处理了 ${actedCount}/${selectedRules.length} 条，已停在批量弹窗等待人工确认`
        : `第一层批量弹窗只自动处理了 ${actedCount}/${selectedRules.length} 条，且未识别到可滚动区域，请人工确认`;
      return {
        waitingCount: initialWaitingCount,
        matchedCount: selectedRules.length,
        actedCount,
        protectedCount,
        unmatchedModalRows,
        remainingCount,
        selectedPreview: preview.slice(0, 20),
        stage: 'await_confirm',
        confirmPending: true,
        confirmed: false,
        message: reason,
      };
    }

    const confirmDelayMs = Math.max(5000, Math.min(20000, 3000 + actedCount * 450));
    await updateJobMessage(`价格申报自动助手：第一层弹窗已处理完，等待${(confirmDelayMs / 1000).toFixed(1)}秒后自动确认...`);
    await checkedSleep(jobId, confirmDelayMs, 250);

    const confirmButton = findConfirmActionButton(modal);
    if (!confirmButton) {
      return {
        waitingCount: initialWaitingCount,
        matchedCount: selectedRules.length,
        actedCount,
        protectedCount,
        unmatchedModalRows,
        remainingCount,
        selectedPreview: preview.slice(0, 20),
        stage: 'confirm_failed',
        confirmPending: true,
        confirmed: false,
        message: '第一层批量弹窗未找到可点击的确认按钮，请人工确认',
      };
    }

    clickLikeUser(confirmButton);
    await updateJobMessage('价格申报自动助手：已点击第一层确认，继续处理后续确认弹窗...');
    const dialogResult = await finishPriceRuleDialogs(jobId, modal, 20000);
    if (dialogResult.closed) {
      return {
        waitingCount: initialWaitingCount,
        matchedCount: selectedRules.length,
        actedCount,
        protectedCount,
        unmatchedModalRows,
        remainingCount,
        selectedPreview: preview.slice(0, 20),
        stage: 'done',
        confirmPending: false,
        confirmed: true,
        message: remainingCount > 0
          ? `已自动确认，剩余${remainingCount}条待人工处理`
          : `已自动确认完成${dialogResult.followupClicks > 0 ? `，并处理了 ${dialogResult.followupClicks} 次后续确认` : ''}`,
      };
    }

    return {
      waitingCount: initialWaitingCount,
      matchedCount: selectedRules.length,
      actedCount,
      protectedCount,
      unmatchedModalRows,
      remainingCount,
      selectedPreview: preview.slice(0, 20),
      stage: 'confirm_failed',
      confirmPending: true,
      confirmed: false,
      message: '已点击第一层确认，但后续确认弹窗未自动完成，请人工确认',
    };
  }

  async function stepQc(job) {
    if (!isOnTargetUrl(URLS.qc)) {
      await navigateTo(URLS.qc, getStepLabel('qc'));
      return null;
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const state = qcReadyState();
      if (state.rowCount > 0 || state.hasNoData || state.hasTotal) {
        return { completed: true, data: extractQcRows() };
      }
      await updateJobMessage(`抽检结果明细页已打开，等待表格渲染：${state.body.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待抽检结果明细页超时');
  }

  async function stepUrgent(job) {
    if (!isOnTargetUrl(URLS.urgent)) {
      await navigateTo(URLS.urgent, getStepLabel('urgent'));
      return null;
    }
    const buildUrgentResult = (source, shipOverdue, arrivalOverdue, bodyPreview = '') => ({
      shipOverdue: toInt(shipOverdue),
      arrivalOverdue: toInt(arrivalOverdue),
      arrivalOverdueRecentCount: 0,
      arrivalOverdueRows: [],
      bodyPreview,
      source,
    });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      try {
        const summary = await fetchUrgentSummaryByApi();
        const result = buildUrgentResult('api', summary.shipOverdue, summary.arrivalOverdue, 'JIT 逾期明细改为接口读取');
        await appendJobLog('INFO', '检查JIT是否逾期：接口模式读取，不切换到货已逾期按钮');
        if (result.arrivalOverdue > 0) {
          await updateJobMessage(`检查JIT是否逾期：发现到货已逾期 ${result.arrivalOverdue} 条，正在拉接口明细...`);
          const arrivalResult = await fetchArrivalOverdueRowsByApi(job.id, ARRIVAL_OVERDUE_RECENT_DAYS);
          result.arrivalOverdueRows = arrivalResult.rows || [];
          result.arrivalOverdueRecentCount = toInt(arrivalResult.recentCount);
          result.arrivalOverdueRecentDays = ARRIVAL_OVERDUE_RECENT_DAYS;
        }
        return { completed: true, data: result };
      } catch (error) {
        const metrics = extractUrgentMetrics();
        if (metrics.ready) {
          const result = buildUrgentResult('ui', metrics.shipOverdue, metrics.arrivalOverdue, metrics.bodyPreview);
          await appendJobLog('WARN', `检查JIT是否逾期：接口读取失败，改用页面卡片数字（发货${result.shipOverdue}，到货${result.arrivalOverdue}）`);
          if (result.arrivalOverdue > 0) {
            try {
              await navigateUrgentArrivalOverdue(job.id, result.arrivalOverdue);
              const arrivalResult = await waitExtractUrgentArrivalOverdueRows(job.id, ARRIVAL_OVERDUE_RECENT_DAYS);
              result.arrivalOverdueRows = arrivalResult.rows || [];
              result.arrivalOverdueRecentCount = toInt(arrivalResult.recentCount);
              result.arrivalOverdueRecentDays = ARRIVAL_OVERDUE_RECENT_DAYS;
            } catch (detailError) {
              result.arrivalOverdueDetailError = normalize(detailError && detailError.message || detailError);
              await appendJobLog('WARN', `到货已逾期明细读取失败，仅使用卡片总数：${result.arrivalOverdueDetailError}`);
            }
          }
          return { completed: true, data: result };
        }
        await updateJobMessage(`检查JIT是否逾期页已打开，接口读取重试中：${normalize(error && error.message || error)} ${metrics.bodyPreview.slice(0, 40)}`);
      }
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待检查JIT是否逾期页超时');
  }

  async function stepUrgentDeclaredPrice(job) {
    if (!isOnTargetUrl(URLS.urgent_declared_price)) {
      await navigateTo(URLS.urgent_declared_price, getStepLabel('urgent_declared_price'));
      return null;
    }
    const deadline = Date.now() + 70000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      await navigateUrgentPendingPriceTab(job.id);
      const result = await waitExtractUrgentPendingPriceRows(job.id);
      return { completed: true, data: result };
    }
    throw new Error('等待检查待发货低申报价页超时');
  }

  async function stepGovern(job) {
    if (!isOnTargetUrl(URLS.govern)) {
      await navigateTo(URLS.govern, getStepLabel('govern'));
      return null;
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const metrics = extractGovernMetrics();
      if (metrics.ready && metrics.ipComplaintCount !== null && metrics.troCount !== null) {
        return { completed: true, data: metrics };
      }
      await updateJobMessage(`合规中心已打开，等待涉嫌违反政策指标加载：${metrics.bodyPreview.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待合规中心页超时');
  }

  async function stepShipping(job) {
    if (!isOnTargetUrl(URLS.shipping)) {
      await navigateTo(URLS.shipping, getStepLabel('shipping'));
      return null;
    }
    const deadline = Date.now() + 90000;
    let queryClicked = false;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const state = readShippingFilterState();
      if (!state.isExpanded) {
        clickShippingExpand();
        await updateJobMessage('VMI 页正在展开筛选区...');
        await checkedSleep(job.id, 1500);
        continue;
      }
      if (state.jitValue !== '否') {
        const jitReady = await ensureShippingJitNo(job.id);
        if (!jitReady) {
          await updateJobMessage('VMI 页未找到“是否JIT=否”选项，继续重试...');
          await checkedSleep(job.id, 1200);
          continue;
        }
        clickShippingQuery();
        queryClicked = true;
        await updateJobMessage('VMI 页已切到是否JIT=否，正在查询...');
        await checkedSleep(job.id, 2000);
        continue;
      }
      if (state.activeTab !== '待仓库收货') {
        clickShippingWaitingTab();
        await updateJobMessage('VMI 页正在切到待仓库收货...');
        await checkedSleep(job.id, 1500);
        continue;
      }
      if (!queryClicked && state.rowCount === 0 && !state.hasNoData) {
        clickShippingQuery();
        queryClicked = true;
        await updateJobMessage('VMI 页正在执行查询...');
        await checkedSleep(job.id, 1800);
        continue;
      }
      if (state.rowCount > 0 || state.hasNoData || state.totalRowsText === 0) {
        return { completed: true, data: extractShippingRows() };
      }
      await updateJobMessage(`VMI 页已打开，等待表格渲染：${state.body.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error(`等待VMI超${SHIPPING_STALE_DAYS}天未收货页超时`);
  }

  async function stepViolation(job) {
    if (!isOnTargetUrl(URLS.violation)) {
      await navigateTo(URLS.violation, getStepLabel('violation'));
      return null;
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const state = readViolationState();
      if (state.ready && !state.loading && (state.rowCount > 0 || state.hasNoData || state.totalRowsText === 0)) {
        const result = extractViolationRows();
        const pendingCount = toInt(result.pendingCount);
        await appendJobLog(
          pendingCount > 0 ? 'WARN' : 'INFO',
          pendingCount > 0
            ? `违规信息：命中待处理 ${pendingCount} 条`
            : '违规信息：未命中待处理项',
        );
        return { completed: true, data: result };
      }
      await updateJobMessage(`违规信息页已打开，等待列表加载：${state.body.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待违规信息页超时');
  }

  async function stepLimited(job) {
    if (!isOnTargetUrl(URLS.limited)) {
      await navigateTo(URLS.limited, getStepLabel('limited'));
      return null;
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const state = readLimitedState();
      if (state.ready && !state.loading && (state.rowCount > 0 || state.hasNoData || state.totalRowsText === 0)) {
        const result = extractLimitedRows();
        const matchedCount = toInt(result.matchedCount);
        await appendJobLog(
          matchedCount > 0 ? 'WARN' : 'INFO',
          matchedCount > 0
            ? `店铺限制记录：命中适用法律法规 ${matchedCount} 条`
            : '店铺限制记录：未命中适用法律法规',
        );
        return { completed: true, data: result };
      }
      await updateJobMessage(`店铺限制记录页已打开，等待列表加载：${state.body.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待店铺限制记录页超时');
  }

  async function stepPriceRule(job) {
    if (!isOnTargetUrl(URLS.price_rule)) {
      await navigateTo(URLS.price_rule, getStepLabel('price_rule'));
      return null;
    }
    if (!await ensureAccessReady(job.id)) {
      return null;
    }
    await waitPriceRuleReady(job.id);
    const result = await runPriceRuleAssistantOnPage(job.id, job.ruleConfig);
    return { completed: true, data: result };
  }

  async function stepReturnOrder(job) {
    if (!isOnTargetUrl(URLS.return_order)) {
      await navigateTo(URLS.return_order, getStepLabel('return_order'));
      return null;
    }
    const deadline = Date.now() + 90000;
    let queryClicked = false;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const state = readReturnOrderState();
      if (!queryClicked && state.hasQueryButton) {
        clickReturnOrderQuery();
        queryClicked = true;
        await updateJobMessage('退货包裹查询页正在执行查询...');
        await checkedSleep(job.id, 1800);
        continue;
      }
      if (state.rowCount > 0 || state.hasNoData || state.totalRowsText === 0) {
        return { completed: true, data: extractReturnOrderRows() };
      }
      await updateJobMessage(`退货包裹查询页已打开，等待表格渲染：${state.body.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待退货包裹查询页超时');
  }

  async function stepFunds(job) {
    if (!isOnTargetUrl(URLS.funds)) {
      await navigateTo(URLS.funds, getStepLabel('funds'));
      return null;
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!await ensureAccessReady(job.id)) {
        continue;
      }
      const result = extractFundsBalance();
      if (result.ready) {
        return { completed: true, data: result };
      }
      await updateJobMessage(`资金中心页已打开，等待余额加载：${result.bodyPreview.slice(0, 80)}`);
      await checkedSleep(job.id, 1500);
    }
    throw new Error('等待资金中心页超时');
  }

  const STEP_HANDLERS = {
    qc: stepQc,
    urgent: stepUrgent,
    urgent_declared_price: stepUrgentDeclaredPrice,
    govern: stepGovern,
    shipping: stepShipping,
    violation: stepViolation,
    limited: stepLimited,
    price_rule: stepPriceRule,
    return_order: stepReturnOrder,
    funds: stepFunds,
  };

  async function continueJob() {
    if (engineRunning) {
      return;
    }
    engineRunning = true;
    try {
      let job = await loadJob();
      if (!job || job.status !== 'running') {
        return;
      }
      if (job.stopRequested) {
        await markJobStopped('用户已停止巡查');
        return;
      }
      if (!Array.isArray(job.steps) || job.stepIndex >= job.steps.length) {
        job.status = 'done';
        job.finishedAt = Date.now();
        job.currentMessage = '巡查完成';
        job.manualReasons = buildManualReasons(job.results || {}, job.enabledChecks || {});
        await saveJob(job);
        await appendJobLog('SUCCESS', '单店巡查完成');
        showFinalResultAlert(await loadJob());
        return;
      }

      const stepKey = job.steps[job.stepIndex];
      const handler = STEP_HANDLERS[stepKey];
      if (!handler) {
        throw new Error(`未知巡查步骤：${stepKey}`);
      }

      await updateJobMessage(`正在执行：${getStepLabel(stepKey)}`);
      const outcome = await handler(job);
      if (!outcome) {
        return;
      }
      if (outcome.completed) {
        job = await loadJob();
        if (!job || job.status !== 'running') {
          return;
        }
        job.storeLabel = currentTitleGuess();
        job.results = Object.assign({}, job.results, { [stepKey]: outcome.data });
        job.stepIndex += 1;
        job.manualReasons = buildManualReasons(job.results, job.enabledChecks || {});
        job.currentMessage = `${getStepLabel(stepKey)} 完成`;
        await saveJob(job);
        await appendJobLog('SUCCESS', `${getStepLabel(stepKey)} 完成`);
        const nextStep = job.steps[job.stepIndex];
        if (nextStep) {
          const nextUrl = URLS[nextStep];
          if (nextUrl && !isOnTargetUrl(nextUrl)) {
            await navigateTo(nextUrl, getStepLabel(nextStep));
            return;
          }
          setTimeout(() => {
            continueJob().catch(console.error);
          }, 200);
          return;
        }
        job.status = 'done';
        job.finishedAt = Date.now();
        job.currentMessage = '巡查完成';
        job.manualReasons = buildManualReasons(job.results || {}, job.enabledChecks || {});
        await saveJob(job);
        await appendJobLog('SUCCESS', '单店巡查完成');
        showFinalResultAlert(await loadJob());
      }
    } catch (error) {
      if (error && error.__temuStop) {
        await markJobStopped('用户已停止巡查');
      } else {
        await appendJobLog('ERROR', String(error && error.message ? error.message : error));
        await markJobError(error);
      }
    } finally {
      engineRunning = false;
      scheduleRender();
    }
  }

  async function startJobFromUi() {
    if (uiActionPending) {
      return;
    }
    uiActionPending = true;
    try {
      const currentJob = await loadJob();
      if (currentJob && currentJob.status === 'running') {
        return;
      }
      const config = await readConfigFromUi();
      if (!Object.values(config.selectedChecks || {}).some(Boolean)) {
        throw new Error('请至少勾选一个巡查项目');
      }
      const job = createJob(config);
      await saveConfig(config);
      await saveJob(job);
      if (job.enabledChecks.price_rule) {
        await appendJobLog('INFO', `价格规则已加载 ${job.ruleConfig.rules.length} 条`);
      }
      await appendJobLog('INFO', `开始单店巡查：${job.steps.map(getStepLabel).join('、')}`);
      await continueJob();
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      alert(`启动失败：${message}`);
      console.error(error);
    } finally {
      uiActionPending = false;
      scheduleRender();
    }
  }

  async function stopJobFromUi() {
    if (uiActionPending) {
      return;
    }
    const job = await loadJob();
    if (!job || job.status !== 'running') {
      return;
    }
    job.stopRequested = true;
    job.currentMessage = '收到停止请求，正在尽快停止...';
    await saveJob(job);
    await appendJobLog('WARN', '收到停止请求');
  }

  async function exportJsonFromUi() {
    const job = await loadJob();
    if (!job) {
      alert('暂无巡查结果');
      return;
    }
    const filename = `TEMU单店巡查结果_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-').replace(/Z$/, '')}.json`;
    downloadText(filename, JSON.stringify(job, null, 2));
  }

  async function copySummaryFromUi() {
    const job = await loadJob();
    const text = buildSummaryText(job);
    await navigator.clipboard.writeText(text);
    alert('摘要已复制');
  }

  async function clearResultFromUi() {
    await clearJob();
  }

  async function restoreDefaultRulesFromUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    panel.querySelector('[data-role="rule-text"]').value = rulesToText(DEFAULT_RULES);
    panel.querySelector('[data-role="protect-diff"]').checked = true;
    panel.querySelector('[data-role="protect-limit"]').value = '1';
    const config = await readConfigFromUi();
    await saveConfig(config);
    scheduleRender();
  }

  async function saveRulesFromUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    const config = await readConfigFromUi();
    await saveConfig(config);
    renderRuleStatus(panel, config.ruleText);
    scheduleRender();
  }

  async function readConfigFromUi() {
    const panel = document.getElementById(PANEL_ID);
    const current = await loadConfig();
    if (!panel) {
      return current;
    }
    const selectedChecks = Object.assign({}, current.selectedChecks);
    for (const item of CHECK_ITEMS) {
      const input = panel.querySelector(`[data-check="${item.key}"]`);
      if (input) {
        selectedChecks[item.key] = !!input.checked;
      }
    }
    return {
      selectedChecks,
      lowPriorityVisible: panel.querySelector('[data-role="low-priority-visibility"]').value === 'show',
      panelCollapsed: panel.dataset.collapsed === 'true',
      protectDiff: !!panel.querySelector('[data-role="protect-diff"]').checked,
      protectDiffLimit: Math.max(0, toFloat(panel.querySelector('[data-role="protect-limit"]').value, 1)),
      ruleText: panel.querySelector('[data-role="rule-text"]').value,
    };
  }

  function renderLogs(logs) {
    if (!logs || !logs.length) {
      return '暂无日志';
    }
    return logs.slice(-8).map((item) => `[${item.time}] ${item.message}`).join('\n');
  }

  async function renderPanel() {
    const config = await loadConfig();
    const job = await loadJob();
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }

    const decision = buildDecisionState(job);
    const toneMap = {
      idle: { bg: '#17202a', border: '#334155', title: '#cbd5e1', detail: '#94a3b8' },
      running: { bg: '#132a3a', border: '#155e75', title: '#67e8f9', detail: '#bae6fd' },
      ok: { bg: '#0f2a1d', border: '#15803d', title: '#86efac', detail: '#dcfce7' },
      alert: { bg: '#3a1f12', border: '#ea580c', title: '#fdba74', detail: '#ffedd5' },
      error: { bg: '#3a1418', border: '#dc2626', title: '#fca5a5', detail: '#fee2e2' },
      warn: { bg: '#332612', border: '#d97706', title: '#fcd34d', detail: '#fef3c7' },
    };
    const tone = toneMap[decision.tone] || toneMap.idle;

    panel.querySelector('[data-role="decision-title"]').textContent = decision.headline;
    panel.querySelector('[data-role="decision-detail"]').textContent = decision.detail;
    panel.querySelector('[data-role="decision-card"]').style.background = tone.bg;
    panel.querySelector('[data-role="decision-card"]').style.borderColor = tone.border;
    panel.querySelector('[data-role="decision-title"]').style.color = tone.title;
    panel.querySelector('[data-role="decision-detail"]').style.color = tone.detail;
    panel.querySelector('[data-role="status"]').textContent = job ? (job.currentMessage || job.status || '待命') : '待命';
    panel.querySelector('[data-role="summary"]').textContent = buildSummaryText(job);
    panel.querySelector('[data-role="logs"]').textContent = renderLogs(job && job.logs);
    panel.querySelector('[data-role="low-priority-wrap"]').style.display = config.lowPriorityVisible ? 'block' : 'none';
    panel.querySelector('[data-role="low-priority-visibility"]').value = config.lowPriorityVisible ? 'show' : 'hide';
    panel.dataset.collapsed = config.panelCollapsed ? 'true' : 'false';

    const bodyEl = document.getElementById(`${APP_ID}_body`);
    const headerEl = document.getElementById(`${APP_ID}_header`);
    const toggleBtn = document.getElementById(`${APP_ID}_toggle_btn`);
    const brandEl = panel.querySelector('[data-role="brand"]');
    const metaEl = panel.querySelector('[data-role="meta"]');
    const miniStatusEl = panel.querySelector('[data-role="mini-status"]');
    if (config.panelCollapsed) {
      bodyEl.style.display = 'none';
      panel.style.width = '44px';
      panel.style.right = '0px';
      panel.style.bottom = '112px';
      panel.style.background = 'transparent';
      panel.style.border = 'none';
      panel.style.borderRadius = '0';
      panel.style.boxShadow = 'none';
      panel.style.overflow = 'visible';
      headerEl.style.padding = '0';
      headerEl.style.background = 'transparent';
      headerEl.style.justifyContent = 'flex-end';
      headerEl.style.gap = '0';
      brandEl.style.display = 'none';
      metaEl.style.display = 'none';
      toggleBtn.textContent = '查\n<<';
      toggleBtn.style.minWidth = '44px';
      toggleBtn.style.width = '44px';
      toggleBtn.style.height = '74px';
      toggleBtn.style.padding = '0';
      toggleBtn.style.border = '1px solid #2a4d6b';
      toggleBtn.style.borderRadius = '18px 0 0 18px';
      toggleBtn.style.background = 'linear-gradient(135deg,#17324d,#101418)';
      toggleBtn.style.color = '#dbeafe';
      toggleBtn.style.boxShadow = '0 14px 28px rgba(9,18,31,.42)';
      toggleBtn.style.font = '800 12px/1.15 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif';
      toggleBtn.style.letterSpacing = '0';
      toggleBtn.style.whiteSpace = 'pre-line';
      toggleBtn.style.textAlign = 'center';
      miniStatusEl.style.display = 'none';
      miniStatusEl.textContent = '';
    } else {
      bodyEl.style.display = 'block';
      panel.style.width = '360px';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.background = '#101418';
      panel.style.border = '1px solid #2f3942';
      panel.style.borderRadius = '12px';
      panel.style.boxShadow = '0 18px 40px rgba(0,0,0,.35)';
      panel.style.overflow = 'hidden';
      headerEl.style.padding = '8px 10px';
      headerEl.style.background = 'linear-gradient(135deg,#17324d,#101418)';
      headerEl.style.justifyContent = 'space-between';
      headerEl.style.gap = '8px';
      brandEl.style.display = 'flex';
      metaEl.style.display = 'block';
      toggleBtn.textContent = '收起';
      toggleBtn.style.minWidth = '38px';
      toggleBtn.style.width = 'auto';
      toggleBtn.style.height = '22px';
      toggleBtn.style.padding = '0 8px';
      toggleBtn.style.border = '1px solid #2563eb';
      toggleBtn.style.borderRadius = '999px';
      toggleBtn.style.background = 'rgba(37,99,235,.14)';
      toggleBtn.style.color = '#bfdbfe';
      toggleBtn.style.boxShadow = 'none';
      toggleBtn.style.font = '700 10.5px/1 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif';
      toggleBtn.style.letterSpacing = '0';
      toggleBtn.style.whiteSpace = 'nowrap';
      toggleBtn.style.textAlign = 'center';
      miniStatusEl.style.display = 'none';
      miniStatusEl.textContent = '';
    }

    for (const item of CHECK_ITEMS) {
      const checkbox = panel.querySelector(`[data-check="${item.key}"]`);
      if (checkbox) {
        checkbox.checked = !!config.selectedChecks[item.key];
      }
    }
    const protectDiffInput = panel.querySelector('[data-role="protect-diff"]');
    const protectLimitInput = panel.querySelector('[data-role="protect-limit"]');
    const ruleTextInput = panel.querySelector('[data-role="rule-text"]');
    if (document.activeElement !== protectDiffInput) {
      protectDiffInput.checked = !!config.protectDiff;
    }
    if (document.activeElement !== protectLimitInput) {
      protectLimitInput.value = String(config.protectDiffLimit ?? 1);
    }
    const ruleText = document.activeElement === ruleTextInput
      ? ruleTextInput.value
      : (config.ruleText || rulesToText(DEFAULT_RULES));
    if (document.activeElement !== ruleTextInput) {
      ruleTextInput.value = ruleText;
    }
    renderRuleStatus(panel, ruleText);

    const running = job && job.status === 'running';
    panel.querySelector('[data-role="start"]').disabled = running || uiActionPending;
    panel.querySelector('[data-role="stop"]').disabled = !running || uiActionPending;
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderPanel().catch(console.error);
    }, 50);
  }

  function buildPanelDom() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:999999',
      'width:360px',
      'background:#101418',
      'color:#f3f4f6',
      'border:1px solid #2f3942',
      'border-radius:12px',
      'box-shadow:0 18px 40px rgba(0,0,0,.35)',
      'font:11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'overflow:hidden',
      'transition:width .2s ease,right .2s ease,bottom .2s ease',
    ].join(';');

    panel.innerHTML = `
      <div id="${APP_ID}_header" style="padding:8px 10px;background:linear-gradient(135deg,#17324d,#101418);display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;user-select:none;">
        <span id="${APP_ID}_toggle_btn" style="display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:22px;padding:0 8px;border:1px solid #2563eb;border-radius:999px;background:rgba(37,99,235,.14);color:#bfdbfe;font:700 10.5px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;flex:0 0 auto;">收起</span>
        <div data-role="brand" style="min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden;flex:1 1 auto;">
          <span style="font-weight:700;white-space:nowrap;">TEMU单店巡查脚本</span>
          <span data-role="mini-status" style="display:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bfdbfe;font-size:10px;opacity:.95;"></span>
        </div>
        <div data-role="meta" style="font-size:10px;opacity:.78;flex:0 0 auto;">Chrome / ScriptCat</div>
      </div>
      <div id="${APP_ID}_body" style="padding:10px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <button data-role="start" style="${buttonStyle('#0f766e')}">开始巡查</button>
          <button data-role="stop" style="${buttonStyle('#b45309')}">停止</button>
          <button data-role="copy" style="${buttonStyle('#374151')}">复制摘要</button>
          <button data-role="clear" style="${buttonStyle('#4b5563')}">清空结果</button>
        </div>

        <div data-role="decision-card" style="margin-bottom:8px;padding:8px 9px;border:1px solid #334155;border-radius:9px;background:#17202a;">
          <div data-role="decision-title" style="font-weight:700;font-size:16px;line-height:1.2;color:#cbd5e1;">待命</div>
          <div data-role="decision-detail" style="margin-top:4px;font-size:10.5px;line-height:1.45;color:#94a3b8;white-space:pre-wrap;">还没开始巡查</div>
        </div>

        <div style="margin-bottom:8px;padding:7px;border:1px solid #25303a;border-radius:8px;background:#161b22;">
          <div style="font-weight:600;margin-bottom:5px;">常规项目</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${CHECK_ITEMS.filter((item) => !item.low).map((item) => checkboxHtml(item)).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:7px;">
            <span>低优先级项目</span>
            <select data-role="low-priority-visibility" style="${inputStyle('92px')}">
              <option value="hide">隐藏</option>
              <option value="show">显示</option>
            </select>
          </div>
          <div data-role="low-priority-wrap" style="display:none;margin-top:7px;border-top:1px dashed #30363d;padding-top:7px;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${CHECK_ITEMS.filter((item) => item.low).map((item) => checkboxHtml(item)).join('')}
            </div>
          </div>
        </div>

        <details style="margin-bottom:8px;border:1px solid #25303a;border-radius:8px;background:#161b22;">
          <summary style="padding:7px 9px;cursor:pointer;font-weight:600;">价格规则</summary>
          <div style="padding:0 9px 9px;">
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">
              <input type="checkbox" data-role="protect-diff">
              <span>开启价差保护，阈值</span>
              <input type="number" data-role="protect-limit" min="0" step="0.1" style="${inputStyle('64px')}">
            </label>
            <div style="font-size:10px;opacity:.85;margin-bottom:5px;">每行格式：关键词|最小价|最大价|动作</div>
            <textarea data-role="rule-text" style="width:100%;height:138px;resize:vertical;background:#0f1317;color:#f9fafb;border:1px solid #334155;border-radius:8px;padding:7px;font:11px/1.45 Consolas,monospace;"></textarea>
            <div data-role="rule-status" style="margin-top:6px;font-size:10px;color:#94a3b8;">规则输入后自动保存</div>
            <div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap;">
              <button data-role="save-rules" style="${buttonStyle('#2563eb')}">保存规则</button>
              <button data-role="restore-rules" style="${buttonStyle('#4b5563')}">恢复默认规则</button>
            </div>
          </div>
        </details>

        <div style="margin-bottom:7px;padding:7px;border-radius:8px;background:#0f1317;border:1px solid #25303a;">
          <div style="font-weight:600;margin-bottom:3px;">当前状态</div>
          <div data-role="status" style="color:#67e8f9;white-space:pre-wrap;font-size:10.5px;">待命</div>
        </div>

        <div style="margin-bottom:7px;padding:7px;border-radius:8px;background:#0f1317;border:1px solid #25303a;">
          <div style="font-weight:600;margin-bottom:3px;">巡查摘要</div>
          <pre data-role="summary" style="margin:0;max-height:170px;overflow:auto;white-space:pre-wrap;color:#e5e7eb;font:10.5px/1.42 Consolas,monospace;">暂无结果</pre>
        </div>

        <div style="padding:7px;border-radius:8px;background:#0f1317;border:1px solid #25303a;">
          <div style="font-weight:600;margin-bottom:3px;">最近日志</div>
          <pre data-role="logs" style="margin:0;max-height:110px;overflow:auto;white-space:pre-wrap;color:#cbd5e1;font:10px/1.4 Consolas,monospace;">暂无日志</pre>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector('[data-role="start"]').addEventListener('click', () => startJobFromUi().catch(console.error));
    panel.querySelector('[data-role="stop"]').addEventListener('click', () => stopJobFromUi().catch(console.error));
    panel.querySelector('[data-role="copy"]').addEventListener('click', () => copySummaryFromUi().catch(console.error));
    panel.querySelector('[data-role="clear"]').addEventListener('click', () => clearResultFromUi().catch(console.error));
    panel.querySelector('[data-role="save-rules"]').addEventListener('click', () => saveRulesFromUi().catch(console.error));
    panel.querySelector('[data-role="restore-rules"]').addEventListener('click', () => restoreDefaultRulesFromUi().catch(console.error));
    document.getElementById(`${APP_ID}_header`).addEventListener('click', async () => {
      const nextConfig = await readConfigFromUi();
      nextConfig.panelCollapsed = !nextConfig.panelCollapsed;
      await saveConfig(nextConfig);
      scheduleRender();
    });
    panel.querySelector('[data-role="low-priority-visibility"]').addEventListener('change', async (event) => {
      const nextConfig = await readConfigFromUi();
      nextConfig.lowPriorityVisible = event.target.value === 'show';
      await saveConfig(nextConfig);
      scheduleRender();
    });

    panel.querySelectorAll('input[data-check], [data-role="protect-diff"], [data-role="protect-limit"]').forEach((input) => {
      input.addEventListener('change', async () => {
        const nextConfig = await readConfigFromUi();
        await saveConfig(nextConfig);
        scheduleRender();
      });
      input.addEventListener('input', async () => {
        const nextConfig = await readConfigFromUi();
        await saveConfig(nextConfig);
      });
    });

    const ruleTextInput = panel.querySelector('[data-role="rule-text"]');
    ruleTextInput.addEventListener('input', async () => {
      renderRuleStatus(panel, ruleTextInput.value);
      const nextConfig = await readConfigFromUi();
      await saveConfig(nextConfig);
    });
    ruleTextInput.addEventListener('change', async () => {
      await saveRulesFromUi();
    });
  }

  function checkboxHtml(item) {
    return `<label style="display:flex;align-items:center;gap:5px;padding:3px 7px;border:1px solid #334155;border-radius:999px;background:#0f1317;font-size:10.5px;"><input type="checkbox" data-check="${item.key}"><span>${item.label}</span></label>`;
  }

  function buttonStyle(color) {
    return [
      'border:none',
      'border-radius:7px',
      'padding:6px 8px',
      `background:${color}`,
      'color:#fff',
      'cursor:pointer',
      'font-size:10.5px',
      'font-weight:600',
    ].join(';');
  }

  function inputStyle(width = '140px') {
    return [
      `width:${width}`,
      'padding:3px 5px',
      'border-radius:6px',
      'border:1px solid #334155',
      'background:#0f1317',
      'color:#f9fafb',
      'font-size:10.5px',
    ].join(';');
  }

  async function bootPanel() {
    if (panelBooted) {
      return;
    }
    panelBooted = true;
    buildPanelDom();
    await renderPanel();
    setInterval(() => {
      renderPanel().catch(console.error);
    }, 1200);
  }

  async function bootRunner() {
    const job = await loadJob();
    if (job && job.status === 'running') {
      setTimeout(() => {
        continueJob().catch(console.error);
      }, 800);
    }
  }

  async function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') {
      return;
    }
    GM_registerMenuCommand('TEMU单店巡查脚本：开始当前店铺', () => {
      startJobFromUi().catch(console.error);
    });
    GM_registerMenuCommand('TEMU单店巡查脚本：停止', () => {
      stopJobFromUi().catch(console.error);
    });
  }

  bootPanel().catch(console.error);
  bootRunner().catch(console.error);
  registerMenu().catch(console.error);
})();
