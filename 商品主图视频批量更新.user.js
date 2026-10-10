// ==UserScript==
// @name         商品主图视频批量更新
// @namespace    lan.temu.main-video-fill
// @version      1.5.1
// @description  沿用网页查询后的分类、状态、货号、语言等条件及每页条数，每页扫描后立即提交空缺视频；预览为可选项。
// @author       Lan
// @match        https://agentseller.temu.com/material/image-task*
// @match        https://agentseller.temu.com/material/*
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%95%86%E5%93%81%E4%B8%BB%E5%9B%BE%E8%A7%86%E9%A2%91%E6%89%B9%E9%87%8F%E6%9B%B4%E6%96%B0.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%95%86%E5%93%81%E4%B8%BB%E5%9B%BE%E8%A7%86%E9%A2%91%E6%89%B9%E9%87%8F%E6%9B%B4%E6%96%B0.user.js
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.5.1';
  const APP_ID = 'temu-main-video-fill-v1';
  const LIST_PAGE_SIZE = 20;
  const VIDEO_QUERY_BATCH_SIZE = 20;
  const UPLOAD_PART_SIZE = 4 * 1024 * 1024;
  const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;
  const POLL_INTERVAL = 3000;
  const POLL_TIMEOUT = 8 * 60 * 1000;
  const MATERIAL_TYPE_VIDEO = 0;
  const MATERIAL_STATUS = Object.freeze({ Parsing: 1, TransferFail: 2, Available: 3, Fail: 5 });

  const API = Object.freeze({
    productPage: '/phoenix-mms/picture/task/pageQuery',
    queryVideo: '/visage-agent-seller/product/image/batchQueryProductVideo',
    editVideo: '/visage-agent-seller/product/image/batchEditProductVideo',
    signature: '/general_auth/get_signature?tag_name=goods-video-tag&scene_id=agent-seller',
    uploadSmall: '/api/galerie/v1/store_video',
    uploadInit: '/api/galerie/large_file/v1/video/upload_init',
    uploadPart: '/api/galerie/large_file/v1/video/upload_part',
    uploadComplete: '/api/galerie/large_file/v1/video/upload_complete',
    materialQuery: '/phoenix-mms/material/queryByMd5',
    materialCreate: '/phoenix-mms/material/create',
    materialEdit: '/phoenix-mms/material/edit',
    materialPage: '/phoenix-mms/material/pageQuery',
  });

  function chunk(items, size) {
    const groups = [];
    for (let index = 0; index < items.length; index += size) {
      groups.push(items.slice(index, index + size));
    }
    return groups;
  }

  function isMissingMainVideo(item) {
    return !Array.isArray(item && item.carouseVideoVOList)
      || item.carouseVideoVOList.length === 0;
  }

  function isMissingDetailVideo(item) {
    return !Array.isArray(item && item.detailVideoVOList)
      || item.detailVideoVOList.length === 0;
  }

  function getUpdateTargets(item, includeDetail) {
    const includeMain = isMissingMainVideo(item);
    const shouldIncludeDetail = includeDetail === true && isMissingDetailVideo(item);
    return {
      includeMain,
      includeDetail: shouldIncludeDetail,
      needsUpdate: includeMain || shouldIncludeDetail,
    };
  }

  function buildVideoRequest(productId, media, videoType) {
    const width = Number(media.width) || 0;
    const height = Number(media.height) || 0;
    return {
      productId: Number(productId),
      videoType,
      vid: String(media.vid),
      videoUrl: String(media.videoUrl),
      coverUrl: String(media.coverUrl),
      width,
      height,
    };
  }

  function buildEditRequest(productIds, media, options = {}) {
    const includeMain = options.includeMain !== false;
    const includeDetail = options.includeDetail === true;
    return {
      editProductVideoReqList: productIds.map((productId) => ({
        productId: Number(productId),
        productCarouseVideoReqList: includeMain ? [buildVideoRequest(productId, media, 1)] : [],
        productDetailVideoReqList: includeDetail ? [buildVideoRequest(productId, media, 2)] : [],
      })),
    };
  }

  function normalizeMaterialName(fileName) {
    const name = String(fileName || '').replace(/\.[^.]+$/, '').trim();
    return (name || '视频素材').slice(0, 20);
  }

  function buildMaterialMd5Query(md5) {
    return { materialType: MATERIAL_TYPE_VIDEO, md5IdList: [String(md5)] };
  }

  function buildMaterialCreateRequest(fileName, md5) {
    return {
      createDetailList: [{
        materialType: MATERIAL_TYPE_VIDEO,
        materialMd5: String(md5),
        materialName: normalizeMaterialName(fileName),
      }],
    };
  }

  function buildMaterialEditRequest(id, fileName, url) {
    return {
      id: Number(id),
      url: String(url),
      materialName: normalizeMaterialName(fileName),
      uploadStatus: MATERIAL_STATUS.Parsing,
      materialType: MATERIAL_TYPE_VIDEO,
    };
  }

  function buildMaterialPageQuery(id) {
    return { pageInfo: { pageNo: 1, pageSize: 1 }, videoIdList: [Number(id)] };
  }

  function getResponseResult(response) {
    if (response && response.result != null) return response.result;
    return response;
  }

  function collectObjects(value, output = [], seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return output;
    seen.add(value);
    if (!Array.isArray(value)) output.push(value);
    for (const child of Object.values(value)) collectObjects(child, output, seen);
    return output;
  }

  function firstField(value, names) {
    const objects = collectObjects(value);
    for (const name of names) {
      const wanted = name.toLowerCase();
      for (const object of objects) {
        for (const [key, fieldValue] of Object.entries(object)) {
          if (key.toLowerCase() === wanted && fieldValue != null && fieldValue !== '') {
            return fieldValue;
          }
        }
      }
    }
    return null;
  }

  function normalizeMedia(value, fallback = {}) {
    return {
      vid: firstField(value, ['vid', 'videoId', 'video_id']) || fallback.vid || '',
      videoUrl: firstField(value, [
        'destMaterialUrl', 'videoUrl', 'video_url', 'materialUrl',
        'material_url', 'originalMaterialUrl', 'url',
      ]) || fallback.videoUrl || '',
      coverUrl: firstField(value, [
        'firstImageUrl', 'coverUrl', 'cover_url', 'videoCoverUrl',
        'video_cover_url', 'imageUrl', 'image_url',
      ]) || fallback.coverUrl || '',
      width: Number(firstField(value, ['width', 'videoWidth', 'video_width']) || fallback.width || 0),
      height: Number(firstField(value, ['height', 'videoHeight', 'video_height']) || fallback.height || 0),
      uploadStatus: String(firstField(value, ['uploadStatus', 'upload_status', 'materialStatus', 'status']) ?? ''),
    };
  }

  function findMaterialRecord(value, md5) {
    const records = collectObjects(getResponseResult(value)).filter((item) => (
      item.id != null && (item.materialMd5 != null || item.alreadyExists != null)
    ));
    return records.find((item) => String(item.materialMd5) === String(md5)) || records[0] || null;
  }

  function isCompleteMedia(media) {
    return Boolean(media && media.vid && media.videoUrl && media.coverUrl);
  }

  function extractVideoRows(response) {
    const result = getResponseResult(response) || {};
    const direct = result.respList || result.list || result.dataList || result.items;
    if (Array.isArray(direct)) return direct;
    return collectObjects(result).filter((item) => (
      item.productId != null
      && ('carouseVideoVOList' in item || 'detailVideoVOList' in item)
    ));
  }

  function extractProductPage(response) {
    const result = getResponseResult(response) || {};
    const pageObject = collectObjects(result).find((item) => (
      Array.isArray(item.detailList) || Array.isArray(item.pageItems)
      || Array.isArray(item.items) || Array.isArray(item.list)
    )) || result;
    const rows = pageObject.detailList || pageObject.pageItems || pageObject.items || pageObject.list || [];
    const total = Number(pageObject.total ?? pageObject.totalCount ?? pageObject.pageInfo?.total ?? result.total ?? rows.length) || 0;
    return { rows: Array.isArray(rows) ? rows : [], total };
  }

  function extractProductIds(rows) {
    const ids = [];
    for (const row of rows) {
      if (row && row.productId != null) ids.push(String(row.productId));
      for (const task of (row && Array.isArray(row.taskList) ? row.taskList : [])) {
        if (task && task.productId != null) ids.push(String(task.productId));
      }
    }
    return Array.from(new Set(ids.filter((id) => /^\d+$/.test(id))));
  }


  function parseCategoryFilter(value) {
    return Array.from(new Set(String(value || '').split(/[,，;；\r\n]+/).map((item) => item.trim()).filter(Boolean)));
  }

  function readLeafCategory(cat) {
    if (!cat || typeof cat !== 'object') return null;
    const id = String(cat.catId ?? '');
    if (!/^[1-9]\d*$/.test(id)) return null;
    const path = [];
    for (let level = 1; level <= 10; level += 1) {
      const levelId = String(cat[`cat${level}`] ?? '');
      const rawName = cat[`cat${level}Name`];
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (levelId === '' || levelId === '0') {
        if (name) return null;
        continue;
      }
      if (!/^[1-9]\d*$/.test(levelId) || !name) return null;
      path.push({ id: levelId, name, level });
    }
    const leaf = path[path.length - 1];
    if (!leaf || leaf.id !== id) return null;
    return { id, name: leaf.name, nodes: path, path: path.map((item) => item.name).join(' > ') };
  }

  // 分类仅来自该 SPU 自己的任务；不继承相邻行、上一页或别的商品的分类。
  function extractCategorizedProducts(rows) {
    const byId = new Map();
    const getEntry = (value) => {
      const id = String(value ?? '');
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
      if (!byId.has(id)) byId.set(id, { productId: id, categories: new Map(), invalid: false });
      return byId.get(id);
    };
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const parent = getEntry(row?.productId);
      const tasks = Array.isArray(row?.taskList) ? row.taskList : [];
      if (!tasks.length && parent) parent.invalid = true;
      for (const task of tasks) {
        const entry = getEntry(task?.productId);
        if (!entry) { if (parent) parent.invalid = true; continue; }
        if (parent && parent.productId !== entry.productId) {
          parent.invalid = true; entry.invalid = true;
        }
        const category = readLeafCategory(task?.cat);
        if (!category) entry.invalid = true;
        else entry.categories.set(`${category.id}\n${category.name}`, category);
      }
    }
    return Array.from(byId.values(), (entry) => ({
      productId: entry.productId,
      category: !entry.invalid && entry.categories.size === 1 ? entry.categories.values().next().value : null,
      categoryIssue: entry.invalid ? '分类缺失或商品归属异常' : (entry.categories.size !== 1 ? '同一 SPU 分类冲突' : ''),
    }));
  }

  function matchesCategory(product, allowed) {
    const category = product?.category;
    return Boolean(category && Array.isArray(allowed) && allowed.length
      && allowed.some((item) => item === category.name || item === category.id));
  }

  function buildCategoryEditRequest(product, media, options, allowed) {
    if (!matchesCategory(product, allowed)) throw new Error(`SPU ${product?.productId || '-'} 不在指定类目内，禁止提交`);
    return buildEditRequest([product.productId], media, options);
  }

  const SEARCH_KEYS = Object.freeze([
    ...Array.from({ length: 10 }, (_, index) => `cat${index + 1}Id`),
    'isFirstAuditPass', 'startCreatedAt', 'endCreatedAt', 'productCode', 'isNeedModelShot',
    'productSkcIdList', 'productIdList', 'taskTypeList', 'languageList', 'taskMergedStatus', 'hasTagCode', 'pageInfo',
  ]);

  function normalizeSearchPayload(value) {
    const body = typeof value === 'string' ? JSON.parse(value) : value;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('未取得网页查询参数');
    const unknown = Object.keys(body).filter((key) => !SEARCH_KEYS.includes(key));
    if (unknown.length) throw new Error('网页查询参数有新字段，请更新脚本后再使用');
    const copied = JSON.parse(JSON.stringify(body));
    const info = copied.pageInfo;
    if (!info || !Number.isSafeInteger(info.pageNo) || info.pageNo < 1
      || !Number.isSafeInteger(info.pageSize) || info.pageSize < 1 || info.pageSize > 200) {
      throw new Error('未取得网页分页参数');
    }
    return copied;
  }

  function searchFingerprint(body) {
    const value = normalizeSearchPayload(body);
    delete value.pageInfo.pageNo;
    return JSON.stringify(SEARCH_KEYS.filter((key) => key in value).map((key) => [key, value[key]]));
  }

  function getSearchCategories(body) {
    return Array.from({ length: 10 }, (_, i) => ({ level: i + 1, id: String(body?.[`cat${i + 1}Id`] ?? '') }))
      .filter((item) => /^[1-9]\d*$/.test(item.id));
  }

  function buildSearchPageRequest(scope, pageNo) {
    const body = normalizeSearchPayload(scope?.body);
    if (!getSearchCategories(body).length) throw new Error('请先在网页选择商品分类并点击查询');
    if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new Error('页码无效');
    body.pageInfo.pageNo = pageNo;
    return body;
  }

  function matchesSearchProduct(product, allowed, scope) {
    const categories = getSearchCategories(scope?.body);
    return Boolean(product?.category && categories.length
      && categories.every((wanted) => product.category.nodes?.some((node) => node.level === wanted.level && node.id === wanted.id))
      && (!allowed.length || matchesCategory(product, allowed)));
  }

  function buildScopedEditRequest(product, media, options, allowed, scope) {
    if (!matchesSearchProduct(product, allowed, scope)) throw new Error(`SPU ${product?.productId || '-'} 不属于本次网页筛选类目，禁止提交`);
    return buildEditRequest([product.productId], media, options);
  }

  // 被动记录网页自己的查询；只记录这个列表接口的 JSON 参数、总数和店铺标识。
  // 脚本分页使用保存的原始 fetch，避免把自己的查询误认成用户更改条件。
  function createPageSearchTracker(env) {
    const nativeFetch = env.fetch;
    const listeners = new Set();
    let sequence = 0;
    let current = { status: 'empty', message: '请先在网页选择商品分类，再点击网页“查询”' };
    const notify = () => { for (const listener of listeners) { try { listener(current); } catch (_) {} } };
    const isTarget = (url, method) => {
      try {
        const parsed = new URL(url, env.location.href);
        return parsed.origin === env.location.origin && parsed.pathname === API.productPage && String(method || 'GET').toUpperCase() === 'POST';
      } catch (_) { return false; }
    };
    const begin = () => {
      const id = ++sequence;
      current = { status: 'pending', message: '正在读取网页查询条件，请等待列表加载完成' };
      notify();
      return id;
    };
    const fail = (id, message) => {
      if (id !== sequence) return;
      current = { status: 'error', message };
      notify();
    };
    const complete = (id, rawBody, data, ok, mallId) => {
      if (id !== sequence) return;
      try {
        const body = normalizeSearchPayload(rawBody);
        if (!ok || data?.success === false || (data?.errorCode != null && ![0, 1000000].includes(Number(data.errorCode)))) throw new Error('网页查询失败，请重新点击查询');
        const result = getResponseResult(data);
        if (!Array.isArray(result?.detailList) || !Number.isFinite(Number(result.total)) || Number(result.total) < 0) throw new Error('网页列表返回不完整，请重新查询');
        if (!mallId) throw new Error('未取得本次网页查询的店铺标识，请刷新后重试');
        if (!getSearchCategories(body).length) throw new Error('未选择商品分类；请先在网页选分类并点击查询');
        const cat = result.detailList[0]?.taskList?.[0]?.cat;
        const categoryLabel = getSearchCategories(body).map((item) =>
          String(cat?.[`cat${item.level}`]) === item.id ? cat[`cat${item.level}Name`] : `类目 ${item.id}`).join(' / ');
        current = { status: 'ready', body, categoryLabel, total: Number(result.total), mallId: String(mallId), key: searchFingerprint(body), capturedAt: Date.now() };
        notify();
      } catch (error) { fail(id, error.message); }
    };
    const wrappedFetch = function (input, init) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const method = init?.method || input?.method || 'GET';
      if (!isTarget(url, method)) return nativeFetch.apply(this, arguments);
      const id = begin();
      let bodyPromise, mallId;
      try {
        bodyPromise = init?.body !== undefined ? Promise.resolve(init.body) : input.clone().text();
        // Attach a rejection handler immediately; never consume the original Request body.
        bodyPromise = bodyPromise.then((value) => ({ value }), () => ({ error: true }));
        mallId = new Headers(init?.headers !== undefined ? init.headers : input?.headers).get('Mallid');
      } catch (_) { bodyPromise = Promise.resolve({ error: true }); }
      let pending;
      try { pending = nativeFetch.apply(this, arguments); }
      catch (error) { fail(id, '网页查询未能发送，请重试'); throw error; }
      Promise.resolve(pending).then(async (response) => {
        const responseCopy = response.clone();
        const raw = await bodyPromise;
        if (raw.error) throw new Error('无法读取网页查询参数');
        complete(id, raw.value, await responseCopy.json(), response.ok, mallId);
      }).catch(() => fail(id, '无法读取网页查询，请再次点击网页“查询”'));
      return pending;
    };
    env.fetch = wrappedFetch;
    const xhrMeta = new WeakMap();
    const proto = env.XMLHttpRequest?.prototype;
    let restoreXhr = () => {};
    if (proto) {
      const nativeOpen = proto.open, nativeSend = proto.send, nativeSetHeader = proto.setRequestHeader;
      proto.open = function (method, url) {
        xhrMeta.set(this, { target: isTarget(url, method), mallId: '' });
        return nativeOpen.apply(this, arguments);
      };
      proto.setRequestHeader = function (name, value) {
        const meta = xhrMeta.get(this);
        if (meta?.target && String(name).toLowerCase() === 'mallid') meta.mallId = String(value);
        return nativeSetHeader.apply(this, arguments);
      };
      proto.send = function (body) {
        const meta = xhrMeta.get(this);
        if (meta?.target) {
          const id = begin();
          this.addEventListener('loadend', () => {
            try {
              const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              complete(id, body, data, this.status >= 200 && this.status < 300, meta.mallId);
            } catch (_) { fail(id, '无法读取网页查询，请再次点击网页“查询”'); }
          }, { once: true });
        }
        return nativeSend.apply(this, arguments);
      };
      const wrappedOpen = proto.open, wrappedSend = proto.send, wrappedHeader = proto.setRequestHeader;
      restoreXhr = () => {
        if (proto.open === wrappedOpen) proto.open = nativeOpen;
        if (proto.send === wrappedSend) proto.send = nativeSend;
        if (proto.setRequestHeader === wrappedHeader) proto.setRequestHeader = nativeSetHeader;
      };
    }
    return {
      fetch: nativeFetch.bind(env),
      getCurrent: () => current,
      getRevision: () => sequence,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      snapshot: () => {
        if (current.status !== 'ready') throw new Error(current.message);
        return JSON.parse(JSON.stringify(current));
      },
      dispose: () => { if (env.fetch === wrappedFetch) env.fetch = nativeFetch; restoreXhr(); listeners.clear(); },
    };
  }


  function makeCsv(rows) {
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [
      ['SPU', '货品分类', '类目ID', '主图视频状态', '详情视频状态', '处理结果'],
      ...rows.map((row) => [
        row.productId,
        row.category?.name || '',
        row.category?.id || '',
        row.mainVideoStatus || '为空',
        row.detailVideoStatus || '未检测',
        row.result || '待更新',
      ]),
    ].map((row) => row.map(escape).join(',')).join('\r\n');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function md5ArrayBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const originalLength = bytes.length;
    const paddedLength = (((originalLength + 8) >>> 6) + 1) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[originalLength] = 0x80;
    const bitLength = originalLength * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const constants = Array.from({ length: 64 }, (_, index) => (
      Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
    ));
    const rotateLeft = (value, amount) => ((value << amount) | (value >>> (32 - amount))) >>> 0;

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
      let a = a0; let b = b0; let c = c0; let d = d0;
      for (let index = 0; index < 64; index += 1) {
        let f; let wordIndex;
        if (index < 16) {
          f = (b & c) | ((~b) & d); wordIndex = index;
        } else if (index < 32) {
          f = (d & b) | ((~d) & c); wordIndex = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d; wordIndex = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | (~d)); wordIndex = (7 * index) % 16;
        }
        const nextD = c;
        const nextC = b;
        const sum = (a + f + constants[index] + words[wordIndex]) >>> 0;
        const nextB = (b + rotateLeft(sum, shifts[index])) >>> 0;
        a = d; b = nextB; c = nextC; d = nextD;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0].map((word) => [0, 8, 16, 24]
      .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildEditRequest,
      buildCategoryEditRequest,
      normalizeSearchPayload, searchFingerprint, getSearchCategories, buildSearchPageRequest,
      matchesSearchProduct, buildScopedEditRequest, createPageSearchTracker,
      parseCategoryFilter,
      readLeafCategory,
      extractCategorizedProducts,
      matchesCategory,
      buildMaterialCreateRequest,
      buildMaterialEditRequest,
      buildMaterialMd5Query,
      buildMaterialPageQuery,
      chunk,
      extractProductIds,
      extractProductPage,
      extractVideoRows,
      findMaterialRecord,
      getUpdateTargets,
      isCompleteMedia,
      isMissingDetailVideo,
      isMissingMainVideo,
      makeCsv,
      md5ArrayBuffer,
      normalizeMedia,
    };
    return;
  }

  const trackerKey = '__temuMainVideoSearchTrackerV151';
  if (window[trackerKey]) return;
  const pageSearch = createPageSearchTracker(window);
  window[trackerKey] = pageSearch;

  function mountApp() {
  if (document.getElementById(APP_ID)) return;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const state = {
    phase: 'idle',
    running: false,
    paused: false,
    stopped: false,
    controller: null,
    selectedFile: null,
    fileMeta: null,
    productIds: [],
    missingRows: [],
    media: null,
    includeDetail: false,
    allowedCategories: [],
    previewOnly: false,
    taskMallId: '',
    mediaMallId: '',
    searchScope: null,
    scopeInvalidated: false,
    syncingSearch: false,
    logs: [],
    stats: { scanned: 0, missing: 0, existing: 0, success: 0, skipped: 0, failed: 0, categoryMatched: 0, categorySkipped: 0, categoryUnknown: 0 },
  };

  const style = document.createElement('style');
  style.textContent = `
    #${APP_ID}, #${APP_ID} * { box-sizing: border-box; letter-spacing: 0; }
    #${APP_ID} { position: fixed; right: 18px; bottom: 20px; z-index: 2147483646; font-family: Arial, "Microsoft YaHei", sans-serif; color: #202124; }
    #${APP_ID} button, #${APP_ID} input { font: inherit; }
    #${APP_ID} .tmvf-launch { min-width: 104px; height: 42px; padding: 0 15px; border: 1px solid #1769e0; border-radius: 6px; background: #1769e0; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 5px 18px rgba(0,0,0,.2); }
    #${APP_ID} .tmvf-panel { position: absolute; right: 0; bottom: 54px; width: 490px; max-width: calc(100vw - 24px); max-height: calc(100vh - 90px); overflow: hidden; border: 1px solid #d5d9df; border-radius: 8px; background: #fff; box-shadow: 0 14px 38px rgba(0,0,0,.24); }
    #${APP_ID} .tmvf-panel[hidden] { display: none; }
    #${APP_ID} .tmvf-header { display: flex; align-items: center; justify-content: space-between; min-height: 50px; padding: 0 15px; border-bottom: 1px solid #e4e7eb; }
    #${APP_ID} .tmvf-title { display: flex; align-items: baseline; gap: 8px; font-size: 15px; }
    #${APP_ID} .tmvf-version { color: #7a8088; font-size: 11px; font-weight: 400; }
    #${APP_ID} .tmvf-icon { width: 32px; height: 32px; padding: 0; border: 0; background: transparent; color: #626870; font-size: 22px; cursor: pointer; }
    #${APP_ID} .tmvf-scroll { max-height: calc(100vh - 210px); overflow: auto; }
    #${APP_ID} .tmvf-body { padding: 14px 15px 12px; }
    #${APP_ID} .tmvf-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 13px; }
    #${APP_ID} .tmvf-step { min-height: 25px; display: flex; align-items: center; justify-content: center; padding: 3px 4px; border: 1px solid #d9dde2; border-radius: 4px; color: #777d85; background: #f8f9fa; font-size: 11px; text-align: center; }
    #${APP_ID} .tmvf-step[data-state="active"] { border-color: #1769e0; color: #1455ad; background: #eef5ff; font-weight: 700; }
    #${APP_ID} .tmvf-step[data-state="done"] { border-color: #18864b; color: #14653b; background: #edf8f2; }
    #${APP_ID} .tmvf-file-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items: center; margin-bottom: 12px; }
    #${APP_ID} .tmvf-file { min-width: 0; min-height: 38px; padding: 8px 10px; border: 1px solid #d7dbe0; border-radius: 5px; background: #f8f9fa; }
    #${APP_ID} .tmvf-file-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }
    #${APP_ID} .tmvf-file-meta { display: block; margin-top: 2px; color: #737980; font-size: 11px; }
    #${APP_ID} .tmvf-category { margin-bottom: 12px; font-size: 12px; }
    #${APP_ID} .tmvf-category label { display: block; margin-bottom: 6px; font-weight: 700; }
    #${APP_ID} .tmvf-category-input { width: 100%; padding: 9px 10px; border: 1px solid #a8b9cf; border-radius: 5px; }
    #${APP_ID} .tmvf-hint { margin-top: 6px; color: #687078; font-size: 11px; line-height: 1.5; }
    #${APP_ID} .tmvf-category-summary { margin: 7px 0 12px; padding: 8px; background: #eef5ff; color: #1455ad; font-size: 11px; line-height: 1.5; }
    #${APP_ID} .tmvf-option { display: flex; align-items: center; gap: 8px; min-height: 34px; margin: -4px 0 10px; color: #3f454c; font-size: 12px; cursor: pointer; }
    #${APP_ID} .tmvf-option input { width: 16px; height: 16px; margin: 0; accent-color: #1769e0; }
    #${APP_ID} .tmvf-option input:disabled + span { color: #8b9096; }
    #${APP_ID} .tmvf-btn { min-height: 36px; padding: 0 12px; border: 1px solid #c7ccd2; border-radius: 5px; background: #fff; color: #30343a; cursor: pointer; }
    #${APP_ID} .tmvf-btn:hover { background: #f4f5f6; }
    #${APP_ID} .tmvf-btn:disabled { cursor: not-allowed; opacity: .5; }
    #${APP_ID} .tmvf-primary { border-color: #1769e0; background: #1769e0; color: #fff; font-weight: 700; }
    #${APP_ID} .tmvf-primary:hover { background: #105bc5; }
    #${APP_ID} .tmvf-danger { border-color: #c73a3a; color: #a62d2d; }
    #${APP_ID} .tmvf-progress-head { display: flex; justify-content: space-between; gap: 10px; min-height: 22px; color: #4b5158; font-size: 12px; }
    #${APP_ID} .tmvf-stage { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
    #${APP_ID} .tmvf-track { height: 10px; overflow: hidden; border-radius: 4px; background: #e7e9ec; }
    #${APP_ID} .tmvf-bar { width: 0; height: 100%; background: #1769e0; transition: width .18s ease; }
    #${APP_ID} .tmvf-current { min-height: 31px; padding-top: 6px; color: #687078; font-size: 11px; overflow-wrap: anywhere; }
    #${APP_ID} .tmvf-stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); margin: 2px 0 12px; border-top: 1px solid #e6e8eb; border-bottom: 1px solid #e6e8eb; }
    #${APP_ID} .tmvf-stat { min-width: 0; padding: 8px 2px; text-align: center; }
    #${APP_ID} .tmvf-stat strong { display: block; font-size: 15px; line-height: 1.2; }
    #${APP_ID} .tmvf-stat span { display: block; margin-top: 2px; color: #777d84; font-size: 10px; }
    #${APP_ID} .tmvf-actions { display: grid; grid-template-columns: 1.35fr 1fr 1fr; gap: 7px; margin-bottom: 11px; }
    #${APP_ID} .tmvf-controls { display: flex; gap: 7px; margin-bottom: 12px; }
    #${APP_ID} .tmvf-controls .tmvf-btn { flex: 1; }
    #${APP_ID} .tmvf-section-head { display: flex; align-items: center; justify-content: space-between; min-height: 30px; font-size: 12px; font-weight: 700; }
    #${APP_ID} .tmvf-table-wrap { max-height: 150px; overflow: auto; border: 1px solid #e0e3e7; border-radius: 5px; }
    #${APP_ID} table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
    #${APP_ID} th, #${APP_ID} td { padding: 6px 7px; border-bottom: 1px solid #eceef0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${APP_ID} th { position: sticky; top: 0; background: #f6f7f8; color: #555b62; }
    #${APP_ID} .tmvf-empty { padding: 18px 10px; color: #858b92; text-align: center; }
    #${APP_ID} .tmvf-log { max-height: 112px; overflow: auto; padding: 7px 9px; border: 1px solid #e0e3e7; border-radius: 5px; background: #f8f9fa; color: #5e646b; font: 11px/1.55 Consolas, "Microsoft YaHei", sans-serif; }
    #${APP_ID} .tmvf-log-line[data-kind="error"] { color: #ac2f2f; }
    #${APP_ID} .tmvf-log-line[data-kind="success"] { color: #167040; }
    @media (max-width: 560px) {
      #${APP_ID} { right: 8px; bottom: 10px; }
      #${APP_ID} .tmvf-panel { width: calc(100vw - 16px); max-width: none; }
      #${APP_ID} .tmvf-stats { grid-template-columns: repeat(3, 1fr); }
      #${APP_ID} .tmvf-actions { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = APP_ID;
  root.innerHTML = `
    <button class="tmvf-launch" type="button" aria-expanded="false">商品视频</button>
    <section class="tmvf-panel" role="dialog" aria-label="商品视频批量更新" hidden>
      <header class="tmvf-header">
        <strong class="tmvf-title">商品主图视频批量更新 <span class="tmvf-version">v${VERSION}</span></strong>
        <button class="tmvf-icon tmvf-close" type="button" title="关闭" aria-label="关闭">&times;</button>
      </header>
      <div class="tmvf-scroll">
        <div class="tmvf-body">
          <div class="tmvf-steps">
            <div class="tmvf-step" data-step="upload">1 上传</div>
            <div class="tmvf-step" data-step="scan">2 读取</div>
            <div class="tmvf-step" data-step="filter">3 检测</div>
            <div class="tmvf-step" data-step="update">4 更新</div>
          </div>
          <div class="tmvf-search-summary tmvf-category-summary" role="status">请先在网页选择商品分类，再点击网页“查询”</div>
          <details class="tmvf-category"><summary style="cursor:pointer;font-size:12px;margin-bottom:8px">额外类目限制（可选）</summary>
            <label for="tmvf-category-input">额外限制末级类目（选填）</label>
            <input id="tmvf-category-input" class="tmvf-category-input" type="text" autocomplete="off" placeholder="通常留空，直接使用网页搜索范围">
            <div class="tmvf-hint">留空即按网页已查询的分类处理。如需进一步缩小范围，可填写完整末级名称或 ID，逗号分隔。</div>
          </details>
          <label class="tmvf-option">
            <input class="tmvf-preview-only" type="checkbox">
            <span>仅预览，不提交（可选，默认关闭）</span>
          </label>
          <div class="tmvf-hint" style="margin-bottom:12px">开始前自动重新查询网页，随后锁定全部条件。每页检测完成后立即补空缺视频，再读取下一页；运行中请勿更改网页筛选。</div>
          <div class="tmvf-file-row">
            <div class="tmvf-file">
              <span class="tmvf-file-name">尚未选择视频</span>
              <span class="tmvf-file-meta">请选择本机 MP4 视频</span>
            </div>
            <button class="tmvf-btn tmvf-pick" type="button">选择视频</button>
            <input class="tmvf-file-input" type="file" accept="video/mp4,video/*" hidden>
          </div>
          <label class="tmvf-option">
            <input class="tmvf-include-detail" type="checkbox">
            <span>同时补详情视频（仅补空项，不覆盖已有视频）</span>
          </label>
          <div class="tmvf-progress-head"><span class="tmvf-stage">等待开始</span><span class="tmvf-percent">0%</span></div>
          <div class="tmvf-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="tmvf-bar"></div></div>
          <div class="tmvf-current">当前 SPU：-</div>
          <div class="tmvf-stats">
            <div class="tmvf-stat"><strong data-stat="scanned">0</strong><span>已检查</span></div>
            <div class="tmvf-stat"><strong data-stat="missing">0</strong><span>待补商品</span></div>
            <div class="tmvf-stat"><strong data-stat="existing">0</strong><span>无需补</span></div>
            <div class="tmvf-stat"><strong data-stat="success">0</strong><span>成功</span></div>
            <div class="tmvf-stat"><strong data-stat="skipped">0</strong><span>跳过</span></div>
            <div class="tmvf-stat"><strong data-stat="failed">0</strong><span>失败</span></div>
          </div>
          <div class="tmvf-category-summary">类目符合 <strong data-stat="categoryMatched">0</strong> · 其他类目 <strong data-stat="categorySkipped">0</strong> · 分类不明/冲突 <strong data-stat="categoryUnknown">0</strong></div>
          <div class="tmvf-actions">
            <button class="tmvf-btn tmvf-upload" type="button" disabled>上传视频</button>
            <button class="tmvf-btn tmvf-primary tmvf-scan" type="button" disabled>请先上传视频</button>
            <button class="tmvf-btn tmvf-export" type="button" disabled>导出清单</button>
          </div>
          <div class="tmvf-controls">
            <button class="tmvf-btn tmvf-pause" type="button" disabled>暂停</button>
            <button class="tmvf-btn tmvf-danger tmvf-stop" type="button" disabled>停止</button>
          </div>
          <div class="tmvf-section-head"><span>待补视频商品</span><span class="tmvf-count">0 个</span></div>
          <div class="tmvf-table-wrap">
            <table><thead><tr><th style="width:25%">SPU</th><th style="width:25%">货品分类</th><th style="width:15%">主图</th><th style="width:15%">详情</th><th>结果</th></tr></thead><tbody class="tmvf-tbody"><tr><td class="tmvf-empty" colspan="5">尚未扫描</td></tr></tbody></table>
          </div>
          <div class="tmvf-section-head"><span>运行日志</span><button class="tmvf-icon tmvf-clear-log" type="button" title="清空日志" aria-label="清空日志">&times;</button></div>
          <div class="tmvf-log" role="log" aria-live="polite"><div class="tmvf-log-line">等待开始</div></div>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  const el = {
    launch: root.querySelector('.tmvf-launch'), panel: root.querySelector('.tmvf-panel'), close: root.querySelector('.tmvf-close'),
    pick: root.querySelector('.tmvf-pick'), fileInput: root.querySelector('.tmvf-file-input'), fileName: root.querySelector('.tmvf-file-name'), fileMeta: root.querySelector('.tmvf-file-meta'), includeDetail: root.querySelector('.tmvf-include-detail'),
    searchSummary: root.querySelector('.tmvf-search-summary'),
    categoryInput: root.querySelector('.tmvf-category-input'), previewOnly: root.querySelector('.tmvf-preview-only'),
    stage: root.querySelector('.tmvf-stage'), percent: root.querySelector('.tmvf-percent'), track: root.querySelector('.tmvf-track'), bar: root.querySelector('.tmvf-bar'), current: root.querySelector('.tmvf-current'),
    scan: root.querySelector('.tmvf-scan'), upload: root.querySelector('.tmvf-upload'), export: root.querySelector('.tmvf-export'), pause: root.querySelector('.tmvf-pause'), stop: root.querySelector('.tmvf-stop'),
    tbody: root.querySelector('.tmvf-tbody'), count: root.querySelector('.tmvf-count'), log: root.querySelector('.tmvf-log'), clearLog: root.querySelector('.tmvf-clear-log'),
  };

  function getMallId() {
    const value = window.mallId || localStorage.getItem('agentseller-mall-info-id');
    if (!value) throw new Error('无法取得当前店铺 Mallid，请刷新页面并确认已登录');
    return String(value);
  }

  function assertApiResponse(json, url) {
    if (!json || typeof json !== 'object') throw new Error(`${url} 返回内容不是有效 JSON`);
    const code = json.errorCode ?? json.error_code;
    const message = json.errorMsg ?? json.error_msg ?? json.message ?? '';
    if (json.success === false) throw new Error(message || `${url} 返回 success=false`);
    if (code != null && ![0, 1000000].includes(Number(code))) {
      throw new Error(message || `${url} 返回错误码 ${code}`);
    }
    return json;
  }

  async function request(url, options = {}, retries = 3) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      checkStopped();
      const headers = new Headers(options.headers || {});
      headers.set('Mallid', getMallId());
      if (options.json !== undefined) headers.set('Content-Type', 'application/json');
      try {
        const response = await pageSearch.fetch(url, {
          method: options.method || 'POST',
          credentials: 'include',
          headers,
          body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
          signal: state.controller && state.controller.signal,
        });
        const text = await response.text();
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch (_) { throw new Error(`HTTP ${response.status}，响应不是 JSON`); }
        if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
        if (!response.ok) throw new Error(firstField(json, ['errorMsg', 'error_msg', 'message']) || `HTTP ${response.status}`);
        return assertApiResponse(json, url);
      } catch (error) {
        if (state.scopeInvalidated) throw new Error('网页搜索范围已变化，已中止后续处理；请重新查询后再开始');
        if (state.stopped || error.name === 'AbortError') throw new Error('任务已停止');
        lastError = error;
        if (attempt === retries || /^HTTP 4(?!29)/.test(error.message)) break;
        await sleep(700 * (attempt + 1));
      }
    }
    throw new Error(`${url} 请求失败：${lastError && lastError.message ? lastError.message : lastError}`);
  }

  function startTask(phase) {
    state.taskMallId = getMallId();
    state.scopeInvalidated = false;
    state.phase = phase;
    state.running = true;
    state.paused = false;
    state.stopped = false;
    state.controller = new AbortController();
    updateButtons();
  }

  function finishTask(phase) {
    state.phase = phase;
    state.running = false;
    state.paused = false;
    state.controller = null;
    updateButtons();
  }

  function checkStopped() {
    if (state.scopeInvalidated) throw new Error('网页搜索范围已变化，已中止后续处理；请重新查询后再开始');
    if (state.stopped) throw new Error('任务已停止');
    if (state.running && state.taskMallId !== getMallId()) throw new Error('店铺已切换，任务中止；请在当前店铺重新上传并扫描');
  }

  async function checkpoint() {
    checkStopped();
    while (state.paused && !state.stopped) await sleep(180);
    checkStopped();
  }

  function setProgress(stage, current, total, currentText = '') {
    const safeTotal = Math.max(0, Number(total) || 0);
    const ratio = safeTotal ? Math.min(1, Math.max(0, Number(current) / safeTotal)) : 0;
    const percentage = Math.round(ratio * 100);
    el.stage.textContent = stage;
    el.percent.textContent = `${percentage}%`;
    el.bar.style.width = `${percentage}%`;
    el.track.setAttribute('aria-valuenow', String(percentage));
    el.current.textContent = currentText || '当前 SPU：-';
  }

  function setSteps(active, done = []) {
    for (const item of root.querySelectorAll('.tmvf-step')) {
      const name = item.dataset.step;
      item.dataset.state = done.includes(name) ? 'done' : (name === active ? 'active' : 'idle');
    }
  }

  function renderStats() {
    for (const [key, value] of Object.entries(state.stats)) {
      const target = root.querySelector(`[data-stat="${key}"]`);
      if (target) target.textContent = String(value);
    }
  }

  function renderRows() {
    el.count.textContent = `${state.missingRows.length} 个`;
    el.export.disabled = state.missingRows.length === 0;
    if (!state.missingRows.length) {
      el.tbody.innerHTML = '<tr><td class="tmvf-empty" colspan="5">没有需要补视频的商品</td></tr>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const row of state.missingRows) {
      const tr = document.createElement('tr');
      for (const value of [row.productId, row.category?.name || '未知', row.mainVideoStatus || '为空', row.detailVideoStatus || '未检测', row.result || '待更新']) {
        const td = document.createElement('td'); td.textContent = value; td.title = value; tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    el.tbody.replaceChildren(fragment);
  }

  function log(message, kind = 'normal') {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    state.logs.push({ now, message: String(message), kind });
    if (state.logs.length > 300) state.logs.shift();
    const line = document.createElement('div');
    line.className = 'tmvf-log-line'; line.dataset.kind = kind; line.textContent = `[${now}] ${message}`;
    el.log.appendChild(line);
    while (el.log.children.length > 300) el.log.firstElementChild.remove();
    el.log.scrollTop = el.log.scrollHeight;
  }

  function updateButtons() {
    const busy = state.running || state.syncingSearch;
    el.pick.disabled = busy;
    el.includeDetail.disabled = busy;
    const hasSearch = pageSearch.getCurrent().status === 'ready' && !searchFormDirty;
    const preview = el.previewOnly.checked;
    el.categoryInput.disabled = busy;
    el.previewOnly.disabled = busy;
    el.scan.disabled = busy || !hasSearch || (!preview && !isCompleteMedia(state.media));
    el.scan.textContent = !hasSearch ? '请先在网页查询' : (preview ? '只扫描预览' : (isCompleteMedia(state.media) ? '按当前搜索边扫边提交' : '请先上传视频'));
    el.upload.disabled = busy || !state.selectedFile || isCompleteMedia(state.media);
    el.export.disabled = state.missingRows.length === 0;
    el.pause.disabled = !busy;
    el.pause.textContent = state.paused ? '继续' : '暂停';
    el.stop.disabled = !busy;
  }

  async function readVideoMeta(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const timer = setTimeout(() => reject(new Error('读取视频信息超时')), 10000);
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        };
        video.onerror = () => { clearTimeout(timer); reject(new Error('无法读取视频信息')); };
        video.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function updateMissingProduct(productId, context) {
    const row = state.missingRows.find((item) => item.productId === String(productId));
    const { pageNo, totalPages, index, total } = context;
    setSteps('update', ['upload', 'scan', 'filter']);
    setProgress(
      `第 ${pageNo}${totalPages ? `/${totalPages}` : ''} 页：立即更新`,
      (pageNo - 1) + 0.45 + (0.55 * index / Math.max(1, total)),
      totalPages || pageNo,
      `当前 SPU：${productId}；本页 ${index + 1}/${total}`,
    );
    try {
      if (!matchesSearchProduct(row, state.allowedCategories, state.searchScope)) throw new Error('网页筛选类目校验未通过，禁止更新');
      const latest = await request(API.queryVideo, { json: { productIds: [Number(productId)] } }, 2);
      const latestRow = extractVideoRows(latest).find((item) => String(item.productId) === String(productId));
      if (!latestRow) throw new Error('更新前复查未返回视频状态');
      const targets = getUpdateTargets(latestRow, state.includeDetail);
      if (!targets.needsUpdate) {
        if (row) row.result = '跳过（已有）';
        state.stats.skipped += 1;
        log(`SPU ${productId} 复查时目标视频均已存在，跳过`);
        return;
      }

      const response = await request(API.editVideo, {
        json: buildScopedEditRequest(row, state.media, targets, state.allowedCategories, state.searchScope),
      }, 2);
      const analyzed = analyzeUpdateResponse(response, [String(productId)]);
      if (analyzed.accepted.includes(String(productId))) {
        const updated = [targets.includeMain ? '主图' : '', targets.includeDetail ? '详情' : ''].filter(Boolean).join('、');
        if (row) row.result = '成功';
        state.stats.success += 1;
        log(`SPU ${productId} ${updated}视频更新成功`, 'success');
      } else {
        if (row) row.result = '失败';
        state.stats.failed += 1;
        log(`SPU ${productId} 更新接口未确认成功`, 'error');
      }
    } catch (error) {
      if (state.scopeInvalidated || state.stopped || error.message === '任务已停止' || state.taskMallId !== getMallId()) throw error;
      if (row) row.result = '失败';
      state.stats.failed += 1;
      log(`SPU ${productId} 更新失败：${error.message}`, 'error');
    } finally {
      renderRows();
      renderStats();
    }
    await sleep(180);
  }

  async function scanProducts() {
    if (state.running || state.syncingSearch) return;
    const allowed = parseCategoryFilter(el.categoryInput.value);
    let scope;
    state.syncingSearch = true; updateButtons();
    try {
      await refreshPageSearch();
      scope = pageSearch.snapshot();
      if (scope.mallId !== getMallId()) throw new Error('店铺已切换，请重新点击网页查询');
      buildSearchPageRequest(scope, 1);
    } catch (error) { log(error.message, 'error'); return; }
    finally { state.syncingSearch = false; updateButtons(); }
    state.searchScope = scope;
    const preview = el.previewOnly.checked;
    if (!preview && !isCompleteMedia(state.media)) {
      log('请先上传视频并等待素材处理完成', 'error');
      return;
    }
    if (!preview && state.mediaMallId !== getMallId()) {
      state.media = null; updateButtons();
      log('视频所属店铺已变化，请在当前店铺重新上传', 'error'); return;
    }
    state.allowedCategories = Object.freeze(allowed.slice());
    state.previewOnly = preview;
    try { startTask('process'); } catch (error) { log(error.message, 'error'); return; }
    state.productIds = [];
    state.missingRows = [];
    state.stats = { scanned: 0, missing: 0, existing: 0, success: 0, skipped: 0, failed: 0, categoryMatched: 0, categorySkipped: 0, categoryUnknown: 0 };
    renderStats(); renderRows();
    setSteps('scan', ['upload']);
    log(`本次${preview ? '只读预览' : '实际更新'}；使用网页查询结果 ${scope.total} 条，每页 ${scope.body.pageInfo.pageSize} 条，预计 ${Math.ceil(scope.total / scope.body.pageInfo.pageSize)} 页；额外类目：${allowed.join('、') || '不限制'}`);
    log(preview ? '仅预览，不提交更新' : '每页检查后立即提交本页缺视频的商品，然后读取下一页');
    log(state.includeDetail
      ? '开始逐页扫描；检查符合类目商品的主图和详情空缺'
      : '开始逐页扫描；检查符合类目商品的主图空缺');
    try {
      const idSet = new Set();
      let pageNo = 1;
      let total = scope.total;
      const pageSize = scope.body.pageInfo.pageSize;
      let totalPages = Math.ceil(total / pageSize);
      while (true) {
        await checkpoint();
        setSteps('scan', ['upload']);
        setProgress(
          totalPages ? `读取商品列表 ${pageNo}/${totalPages} 页` : '读取商品列表',
          Math.max(0, pageNo - 1),
          totalPages || 1,
          `当前页：${pageNo}`,
        );
        const response = await request(API.productPage, { json: buildSearchPageRequest(scope, pageNo) });
        const page = extractProductPage(response);
        if (pageNo > 1 && page.total !== total) throw new Error(`搜索结果数量发生变化，已停止后续处理；已成功提交 ${state.stats.success} 个商品，请重新查询后继续`);
        total = page.total;
        totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
        if (!page.rows.length) break;

        const products = extractCategorizedProducts(page.rows).filter((product) => !idSet.has(product.productId));
        const productById = new Map(products.map((product) => [product.productId, product]));
        const pageIds = [];
        for (const product of products) {
          idSet.add(product.productId);
          if (!product.category) {
            state.stats.categoryUnknown += 1;
            log(`SPU ${product.productId} ${product.categoryIssue}，跳过`);
          } else if (!matchesSearchProduct(product, state.allowedCategories, state.searchScope)) {
            state.stats.categorySkipped += 1;
          } else {
            state.stats.categoryMatched += 1;
            pageIds.push(product.productId);
          }
        }
        state.productIds = Array.from(idSet);
        renderStats();

        setSteps('filter', ['upload', 'scan']);
        const batches = chunk(pageIds, VIDEO_QUERY_BATCH_SIZE);
        const pageMissingIds = [];
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          await checkpoint();
          const ids = batches[batchIndex];
          const pageProgress = (pageNo - 1) + 0.15 + (0.25 * (batchIndex / Math.max(1, batches.length)));
          setProgress(
            `第 ${pageNo}${totalPages ? `/${totalPages}` : ''} 页：检查视频状态`,
            pageProgress,
            totalPages || pageNo,
            `当前 SPU：${ids[0]}；本页批次 ${batchIndex + 1}/${batches.length}`,
          );
          try {
            const videoResponse = await request(API.queryVideo, { json: { productIds: ids.map(Number) } });
            const byId = new Map(extractVideoRows(videoResponse).map((row) => [String(row.productId), row]));
            for (const productId of ids) {
              const row = byId.get(String(productId));
              if (!row) {
                state.stats.failed += 1;
                log(`SPU ${productId} 未返回视频状态，未纳入待更新`, 'error');
                continue;
              }
              state.stats.scanned += 1;
              const targets = getUpdateTargets(row, state.includeDetail);
              if (targets.needsUpdate) {
                state.stats.missing += 1;
                state.missingRows.push({
                  productId: String(productId),
                  category: productById.get(String(productId)).category,
                  mainVideoStatus: isMissingMainVideo(row) ? '为空' : '已有',
                  detailVideoStatus: isMissingDetailVideo(row) ? '为空' : '已有',
                  result: state.previewOnly ? '仅预览' : '待更新',
                });
                pageMissingIds.push(String(productId));
              } else {
                state.stats.existing += 1;
              }
            }
          } catch (error) {
            if (state.scopeInvalidated || state.stopped || error.message === '任务已停止' || state.taskMallId !== getMallId()) throw error;
            state.stats.failed += ids.length;
            log(`第 ${pageNo} 页第 ${batchIndex + 1} 批检查失败：${error.message}`, 'error');
          }
          renderStats();
          renderRows();
          setProgress(
            `第 ${pageNo}${totalPages ? `/${totalPages}` : ''} 页：检查完成`,
            (pageNo - 1) + 0.15 + (0.25 * ((batchIndex + 1) / Math.max(1, batches.length))),
            totalPages || pageNo,
            `累计发现待补视频商品：${state.stats.missing} 个`,
          );
          await sleep(110);
        }

        const successBeforePage = state.stats.success;
        if (!state.previewOnly) {
          for (let index = 0; index < pageMissingIds.length; index += 1) {
            await checkpoint();
            await updateMissingProduct(pageMissingIds[index], {
              pageNo, totalPages, index, total: pageMissingIds.length,
            });
          }
        }
        setProgress(
          `第 ${pageNo}${totalPages ? `/${totalPages}` : ''} 页处理完成`,
          pageNo,
          totalPages || pageNo,
          state.previewOnly ? `本页待补 ${pageMissingIds.length} 个，仅预览` : `本页待补 ${pageMissingIds.length} 个，成功更新 ${state.stats.success - successBeforePage} 个`,
        );
        log(`第 ${pageNo}${totalPages ? `/${totalPages}` : ''} 页完成：检查 ${pageIds.length} 个，待补 ${pageMissingIds.length} 个${state.previewOnly ? '，仅预览' : `，成功更新 ${state.stats.success - successBeforePage} 个`}`);
        const reachedLastPage = (totalPages > 0 && pageNo >= totalPages) || page.rows.length < pageSize;
        if (reachedLastPage) break;
        pageNo += 1;
        await sleep(100);
      }
      if (!state.productIds.length) log('当前搜索结果为空，没有需要处理的商品');
      setProgress(state.previewOnly ? '预览完成（未修改商品）' : '全部处理完成', 1, 1, `成功 ${state.stats.success}，跳过 ${state.stats.skipped}，失败 ${state.stats.failed}`);
      setSteps(null, ['upload', 'scan', 'filter', 'update']);
      log(`类目符合 ${state.stats.categoryMatched}，其他类目 ${state.stats.categorySkipped}，分类不明/冲突 ${state.stats.categoryUnknown}`);
      log(`${state.previewOnly ? '只读预览完成，未修改商品' : '全部完成'}：检查 ${state.stats.scanned}，待补 ${state.stats.missing}，成功 ${state.stats.success}，跳过 ${state.stats.skipped}，失败 ${state.stats.failed}`, state.stats.failed ? 'error' : 'success');
      finishTask('complete');
    } catch (error) {
      const stopped = state.stopped;
      setProgress(stopped ? '已停止' : '处理失败', 0, 1, stopped ? `已成功更新 ${state.stats.success} 个商品` : error.message);
      log(stopped ? `任务已停止；已成功更新 ${state.stats.success} 个商品` : error.message, stopped ? 'normal' : 'error');
      finishTask(stopped ? 'stopped' : 'error');
    }
    renderRows(); renderStats(); updateButtons();
  }

  async function getUploadSignature() {
    const response = await request(API.signature, { json: { bucket_tag: 'goods-video-tag' } });
    const result = getResponseResult(response);
    const sign = typeof result === 'string' ? result : firstField(response, ['signature', 'upload_sign', 'uploadSign', 'sign']);
    if (!sign) throw new Error('上传签名响应中没有 signature/sign');
    return String(sign);
  }

  async function uploadSmallVideo(file, sign, onProgress) {
    const body = new FormData();
    body.append('sign', sign);
    body.append('create_media', 'true');
    body.append('video', file, file.name);
    onProgress(0, file.size);
    const response = await request(`${API.uploadSmall}?tag_name=goods-video-tag&scene_id=agent-seller`, { body }, 1);
    onProgress(file.size, file.size);
    return response;
  }

  async function uploadLargeVideo(file, sign, onProgress) {
    const init = await request(API.uploadInit, {
      json: { content_type: file.type || 'video/mp4', create_media: true, sign },
    }, 1);
    const uploadSign = String(firstField(init, ['sign', 'upload_sign', 'uploadSign']) || sign);
    const parts = Math.ceil(file.size / UPLOAD_PART_SIZE);
    let uploaded = 0;
    for (let index = 0; index < parts; index += 1) {
      await checkpoint();
      const start = index * UPLOAD_PART_SIZE;
      const part = file.slice(start, Math.min(file.size, start + UPLOAD_PART_SIZE));
      const body = new FormData();
      body.append('sign', uploadSign);
      body.append('part_num', String(index + 1));
      body.append('part_file', part, `${file.name}.part${index + 1}`);
      await request(API.uploadPart, { body }, 2);
      uploaded += part.size;
      onProgress(uploaded, file.size, index + 1, parts);
    }
    return request(API.uploadComplete, {
      json: { sign: uploadSign, large_file_size: file.size },
    }, 2);
  }

  async function queryMaterialByMd5(md5) {
    return request(API.materialQuery, { json: buildMaterialMd5Query(md5) }, 1);
  }

  async function prepareMaterialRecord(file, md5) {
    setProgress('检查素材是否已存在', 0, 1, `MD5：${md5}`);
    const queried = await queryMaterialByMd5(md5);
    const existing = findMaterialRecord(queried, md5);
    if (existing && existing.id != null) {
      const status = Number(existing.materialStatus ?? existing.uploadStatus);
      if (status === MATERIAL_STATUS.Available) {
        log(`素材已存在，直接复用素材 ID ${existing.id}`);
        return { id: Number(existing.id), reuse: true };
      }
      log(`素材记录 ${existing.id} 已存在但未就绪，将继续完成上传`);
      return { id: Number(existing.id), reuse: false };
    }

    setProgress('创建素材记录', 0, 1, normalizeMaterialName(file.name));
    const created = await request(API.materialCreate, {
      json: buildMaterialCreateRequest(file.name, md5),
    }, 1);
    const record = findMaterialRecord(created, md5);
    if (!record || record.id == null) throw new Error('素材创建成功响应中没有素材 ID');
    const status = Number(record.materialStatus ?? record.uploadStatus);
    log(`素材记录已创建：ID ${record.id}`);
    return { id: Number(record.id), reuse: status === MATERIAL_STATUS.Available };
  }

  async function waitForMaterial(materialId, seedMedia = {}) {
    let media = normalizeMedia(seedMedia);

    const startedAt = Date.now();
    let pollCount = 0;
    while (Date.now() - startedAt < POLL_TIMEOUT) {
      await checkpoint();
      pollCount += 1;
      setProgress('等待素材处理', Date.now() - startedAt, POLL_TIMEOUT, `素材 ID ${materialId}；第 ${pollCount} 次查询；状态：${media.uploadStatus || '处理中'}`);
      const queried = await request(API.materialPage, { json: buildMaterialPageQuery(materialId) }, 1);
      media = normalizeMedia(queried, media);
      const status = Number(media.uploadStatus);
      if ([MATERIAL_STATUS.TransferFail, MATERIAL_STATUS.Fail].includes(status)) {
        const reason = firstField(queried, ['failReason', 'errorMsg', 'error_msg']) || '素材解析失败';
        throw new Error(String(reason));
      }
      if ((status === MATERIAL_STATUS.Available || /available|success|finish|complete/i.test(media.uploadStatus)) && isCompleteMedia(media)) return media;
      await sleep(POLL_INTERVAL);
    }
    throw new Error(`素材处理超时；已取得 vid=${Boolean(media.vid)}，视频地址=${Boolean(media.videoUrl)}，封面=${Boolean(media.coverUrl)}`);
  }

  async function uploadSelectedVideo() {
    if (state.running || !state.selectedFile) return;
    try { startTask('upload'); } catch (error) { log(error.message, 'error'); return; }
    setSteps('upload');
    log(`开始上传 ${state.selectedFile.name}（${formatBytes(state.selectedFile.size)}）`);
    try {
      const buffer = await state.selectedFile.arrayBuffer();
      const md5 = md5ArrayBuffer(buffer);
      log(`文件 MD5：${md5}`);
      const materialRecord = await prepareMaterialRecord(state.selectedFile, md5);
      let seedMedia = state.fileMeta || {};
      if (!materialRecord.reuse) {
        setProgress('获取上传签名', 0, 1, state.selectedFile.name);
        const sign = await getUploadSignature();
        const onProgress = (done, total, part, partTotal) => {
          const detail = part ? `分片 ${part}/${partTotal}；${formatBytes(done)} / ${formatBytes(total)}` : `${formatBytes(done)} / ${formatBytes(total)}`;
          setProgress('上传视频', done, total, detail);
        };
        const uploaded = state.selectedFile.size > LARGE_FILE_THRESHOLD
          ? await uploadLargeVideo(state.selectedFile, sign, onProgress)
          : await uploadSmallVideo(state.selectedFile, sign, onProgress);
        seedMedia = normalizeMedia(uploaded, state.fileMeta || {});
        if (!seedMedia.vid || !seedMedia.videoUrl) throw new Error('视频上传响应缺少 vid 或视频地址');
        log(`上传完成，正在登记素材 ID ${materialRecord.id}`);
        await request(API.materialEdit, {
          json: buildMaterialEditRequest(materialRecord.id, state.selectedFile.name, seedMedia.videoUrl),
        }, 1);
      }
      state.media = await waitForMaterial(materialRecord.id, seedMedia);
      checkStopped();
      state.mediaMallId = state.taskMallId;
      if (!isCompleteMedia(state.media)) throw new Error('素材信息不完整，禁止更新商品');
      setProgress('视频已就绪', 1, 1, `vid：${state.media.vid}`);
      setSteps(null, ['upload']);
      log(`视频素材可用：vid=${state.media.vid}`, 'success');
      finishTask('ready');
    } catch (error) {
      const stopped = state.stopped;
      setProgress(stopped ? '已停止' : '上传失败', 0, 1, error.message);
      log(error.message, 'error');
      finishTask(stopped ? 'stopped' : 'error');
    }
    updateButtons();
  }

  function analyzeUpdateResponse(response, ids) {
    const objects = collectObjects(getResponseResult(response));
    const statusRows = objects.filter((item) => item.productId != null && (
      'success' in item || 'result' in item || 'errorMsg' in item || 'error_msg' in item
    ));
    if (!statusRows.length) return { accepted: ids.slice(), rejected: [] };
    const map = new Map(statusRows.map((item) => [String(item.productId), item]));
    const accepted = []; const rejected = [];
    for (const id of ids) {
      const row = map.get(String(id));
      if (!row || row.success === false || row.result === false || row.errorMsg || row.error_msg) rejected.push(String(id));
      else accepted.push(String(id));
    }
    return { accepted, rejected };
  }

  let searchFormDirty = false;
  function renderSearchSummary() {
    const search = pageSearch.getCurrent();
    if (searchFormDirty) { el.searchSummary.textContent = '网页筛选项已修改，请先点击网页“查询”'; return; }
    if (search.status !== 'ready') { el.searchSummary.textContent = search.message; return; }
    const size = search.body.pageInfo.pageSize;
    el.searchSummary.textContent = `已同步网页查询：${search.total} 条，每页 ${size} 条，共 ${Math.ceil(search.total / size)} 页。分类：${search.categoryLabel}。状态、货号、语言等查询条件一并保留。`;
  }
  function invalidateRunningScope() {
    if (state.running && state.phase === 'process') {
      state.scopeInvalidated = true;
      if (state.controller) state.controller.abort();
    }
  }
  pageSearch.subscribe((current) => {
    searchFormDirty = false;
    if (state.running && state.phase === 'process'
      && (current.status !== 'ready' || current.key !== state.searchScope?.key || current.mallId !== state.taskMallId)) invalidateRunningScope();
    renderSearchSummary(); updateButtons();
  });
  // 网页筛选控件变动后必须重新查询；脚本面板自己的控件不影响网页范围。
  const markSearchFormDirty = (event) => {
    if (root.contains(event.target)) return;
    if (event.target?.closest?.('form')) {
      searchFormDirty = true;
      invalidateRunningScope(); renderSearchSummary(); updateButtons();
    }
  };
  document.addEventListener('input', markSearchFormDirty, true);
  document.addEventListener('change', markSearchFormDirty, true);
  renderSearchSummary();

  async function refreshPageSearch() {
    const form = Array.from(document.querySelectorAll('form')).find((item) => !root.contains(item) && item.textContent.includes('商品分类'));
    const query = form && Array.from(form.querySelectorAll('button')).find((item) => item.textContent.trim() === '查询');
    if (!query || query.disabled) throw new Error('未找到可用的网页查询按钮，请在图片/视频更新任务页面手动查询后重试');
    const before = pageSearch.getRevision();
    query.click();
    const timeoutAt = Date.now() + 15000;
    while (Date.now() < timeoutAt) {
      if (pageSearch.getRevision() > before && pageSearch.getCurrent().status !== 'pending') {
        pageSearch.snapshot(); return;
      }
      await sleep(100);
    }
    throw new Error('未捕获到网页查询结果，请重新点击网页查询后重试');
  }

  el.launch.addEventListener('click', () => {
    const opening = el.panel.hidden;
    el.panel.hidden = !opening;
    el.launch.setAttribute('aria-expanded', String(opening));
  });
  el.close.addEventListener('click', () => { el.panel.hidden = true; el.launch.setAttribute('aria-expanded', 'false'); });
  el.pick.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', async () => {
    const file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    state.media = null; state.mediaMallId = '';
    try {
      if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') throw new Error('请选择 MP4 视频');
      const meta = await readVideoMeta(file);
      state.selectedFile = file;
      state.fileMeta = meta;
      state.media = null;
      el.fileName.textContent = file.name;
      el.fileMeta.textContent = `${formatBytes(file.size)} · ${meta.width}×${meta.height} · ${meta.duration.toFixed(1)} 秒`;
      log(`已选择视频：${file.name}`);
    } catch (error) {
      state.selectedFile = null; state.fileMeta = null;
      el.fileName.textContent = '视频不可用'; el.fileMeta.textContent = error.message;
      log(error.message, 'error');
    }
    updateButtons();
  });
  el.includeDetail.addEventListener('change', () => {
    state.includeDetail = el.includeDetail.checked;
    log(state.includeDetail ? '已开启：同时补空缺的详情视频' : '已关闭：只补主图视频');
  });
  el.categoryInput.addEventListener('input', updateButtons);
  el.previewOnly.addEventListener('change', () => {
    log(el.previewOnly.checked ? '已切换为只读预览，不修改商品' : '已切换为实际更新模式；开始后按网页搜索结果逐页补视频');
    updateButtons();
  });
  el.scan.addEventListener('click', scanProducts);
  el.upload.addEventListener('click', uploadSelectedVideo);
  el.export.addEventListener('click', () => {
    const blob = new Blob(['\ufeff', makeCsv(state.missingRows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `TEMU待补视频商品-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log(`已导出 ${state.missingRows.length} 个商品`);
  });
  el.pause.addEventListener('click', () => {
    if (!state.running) return;
    state.paused = !state.paused;
    el.pause.textContent = state.paused ? '继续' : '暂停';
    log(state.paused ? '已暂停，将在当前请求结束后生效' : '继续运行');
  });
  el.stop.addEventListener('click', () => {
    if (!state.running) return;
    state.stopped = true; state.paused = false;
    if (state.controller) state.controller.abort();
    log('正在停止任务');
  });
  el.clearLog.addEventListener('click', () => { state.logs = []; el.log.innerHTML = '<div class="tmvf-log-line">日志已清空</div>'; });

  updateButtons();
  console.info(`[商品主图视频批量更新] v${VERSION} 已加载`);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountApp, { once: true });
  else mountApp();
}());

