// ==UserScript==
// @name         Temu 商品信息抓取下载 GitHub更新版
// @namespace    https://bbs.tampermonkey.net.cn/
// @version      4.29.1
// @description  批量抓取 Temu 商品（支持多币种价格/销量筛选、生成销量TXT统计、中文/英文销量识别、JPG/PNG可选、原始字节下载、自动跳过推荐区、并发下载、自定义间隔）
// @author       Gemini
// @match        https://www.temu.com/*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/jianpanlan0-svg/scriptcat-temu-noexe/main/temu-product-scraper.user.js
// @updateURL    https://raw.githubusercontent.com/jianpanlan0-svg/scriptcat-temu-noexe/main/temu-product-scraper.user.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '4.29.1';
    const STORAGE_KEY = 'TEMU_SCRAPED_SHOPS_STORAGE';
    const IMAGE_FORMAT_KEY = 'TEMU_IMAGE_FORMAT';
    const BACKUP_TIME_KEY = 'TEMU_SCRAPED_SHOPS_LAST_BACKUP_TIME';
    const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

    // 获取店铺名称
    function getShopName() {
        const selectors = [
            'h1.PX7EseE2._2DshZJ_y',
            'h1[class*="shopName"]',
            'h1[class*="Title"]',
            '.shop-header h1',
            '.shop-name-title',
            'div[class*="shop-name"]',
            'h1'
        ];

        for (let s of selectors) {
            const elements = document.querySelectorAll(s);
            for (let el of elements) {
                const rawText = el.innerText || el.textContent || '';
                const text = rawText.split('\n')[0].trim();
                if (text && text.length > 0 && text.length < 60 &&
                    !['Home', 'Items', 'Reviews', '首页', '所有商品', '评价'].includes(text)) {
                    return text;
                }
            }
        }

        const sellInfo = Array.from(document.querySelectorAll('div, span, p')).find(el =>
            (el.innerText || el.textContent || '').includes('Started to sell') ||
            (el.innerText || el.textContent || '').includes('入驻时间')
        );
        if (sellInfo) {
            const container = sellInfo.closest('div');
            if (container && container.parentElement) {
                const title = container.parentElement.querySelector('h1, div[class*="name"]');
                if (title) return (title.innerText || title.textContent || '').split('\n')[0].trim();
            }
        }

        return '未知店铺';
    }

    function safeGetShopName() {
        try {
            return getShopName();
        } catch (error) {
            return '未知店铺';
        }
    }

    function normalizeImageFormat(format) {
        return String(format || '').toLowerCase() === 'png' ? 'png' : 'jpg';
    }

    function getSavedImageFormat() {
        return normalizeImageFormat(GM_getValue(IMAGE_FORMAT_KEY, 'jpg'));
    }

    function getSelectedImageFormat() {
        const select = document.getElementById('image-format-select') || formatSelect;
        return normalizeImageFormat(select ? select.value : getSavedImageFormat());
    }

    // 获取已抓取店铺列表
    function getScrapedShops() {
        const data = GM_getValue(STORAGE_KEY, []);
        return Array.isArray(data) ? data : [];
    }

    function normalizeShopNameForCompare(name) {
        return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isScrapedShopName(name) {
        const target = normalizeShopNameForCompare(name);
        if (!target || target === normalizeShopNameForCompare('未知店铺')) return false;
        return getScrapedShops().some(item => normalizeShopNameForCompare(item) === target);
    }

    function formatBackupTimestamp(date = new Date()) {
        const pad = value => String(value).padStart(2, '0');
        return [
            date.getFullYear(),
            pad(date.getMonth() + 1),
            pad(date.getDate())
        ].join('') + '_' + [
            pad(date.getHours()),
            pad(date.getMinutes()),
            pad(date.getSeconds())
        ].join('');
    }

    function backupScrapedShopsToLocal(isManual = false) {
        const list = getScrapedShops().map(name => String(name || '').trim()).filter(Boolean);
        if (list.length === 0) {
            if (isManual) updateStatusText('没有已抓取店铺可备份');
            return false;
        }

        const blob = new Blob([list.join('\n')], { type: 'text/plain;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        const fileName = `TEMU已抓取店铺备份/TEMU已抓取店铺_${formatBackupTimestamp()}_${list.length}个.txt`;
        GM_download({
            url: blobUrl,
            name: fileName,
            saveAs: false,
            onload: () => {
                URL.revokeObjectURL(blobUrl);
                GM_setValue(BACKUP_TIME_KEY, Date.now());
                if (isManual) updateStatusText(`已备份已抓店铺\n共 ${list.length} 个`);
            },
            onerror: (error) => {
                URL.revokeObjectURL(blobUrl);
                if (isManual) updateStatusText(`备份失败\n${getDownloadErrorText(error)}`);
            },
            ontimeout: () => {
                URL.revokeObjectURL(blobUrl);
                if (isManual) updateStatusText('备份超时');
            }
        });
        return true;
    }

    function autoBackupScrapedShops() {
        if (getScrapedShops().length === 0) return;
        const lastBackupTime = parseInt(GM_getValue(BACKUP_TIME_KEY, 0), 10) || 0;
        if (Date.now() - lastBackupTime >= BACKUP_INTERVAL_MS) {
            backupScrapedShopsToLocal(false);
        }
    }

    // 记录新店铺
    function saveShopName(name) {
        if (!name || name === '未知店铺') return;
        let list = getScrapedShops();
        if (!list.includes(name)) {
            list.push(name);
            GM_setValue(STORAGE_KEY, list);
        }
    }

    // --- UI 构建 ---
    const container = document.createElement('div');
    container.id = 'temu-scraper-container';
    container.style.cssText = `position: fixed; top: 150px; right: 0; z-index: 10000; display: flex; align-items: flex-start; transition: transform 0.3s ease; transform: translateX(250px);`;

    const handle = document.createElement('div');
    handle.innerText = '抓取器';
    handle.style.cssText = `background: #fb7701; color: white; padding: 15px 8px; border-radius: 8px 0 0 8px; cursor: pointer; font-weight: bold; writing-mode: vertical-lr; box-shadow: -2px 0 8px rgba(0,0,0,0.1); font-size: 14px; letter-spacing: 2px;`;

    const panel = document.createElement('div');
    panel.style.cssText = `background: #fff; border-left: 2px solid #fb7701; border-bottom: 2px solid #fb7701; padding: 15px; width: 250px; box-shadow: -4px 4px 12px rgba(0,0,0,0.15); border-radius: 0 0 0 12px; font-family: sans-serif;`;

    const titleDiv = document.createElement('div');
    titleDiv.innerText = `Temu 抓取器 v${SCRIPT_VERSION}`;
    titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 12px; color: #fb7701; text-align: center; font-size: 16px;';
    panel.appendChild(titleDiv);

    // 销量筛选
    const filterDiv = document.createElement('div');
    filterDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: #333; padding: 0 5px;';
    filterDiv.innerHTML = `<span>最小销量:</span><input type="number" id="min-sales-input" value="10" min="0" style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; text-align: center;">`;
    panel.appendChild(filterDiv);

    const priceFilterDiv = document.createElement('div');
    priceFilterDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: #333; padding: 0 5px;';
    priceFilterDiv.innerHTML = `<span>最小价格:</span><input type="number" id="min-price-input" value="7" min="0" step="0.01" style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; text-align: center;">`;
    panel.appendChild(priceFilterDiv);

    // 下载间隔
    const intervalDiv = document.createElement('div');
    intervalDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: #333; padding: 0 5px;';
    intervalDiv.innerHTML = `<span>下载间隔(ms):</span><input type="number" id="download-interval-input" value="1000" min="200" step="100" style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; text-align: center;">`;
    panel.appendChild(intervalDiv);

    const concurrencyDiv = document.createElement('div');
    concurrencyDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: #333; padding: 0 5px;';
    concurrencyDiv.innerHTML = `<span>并发数:</span><input type="number" id="download-concurrency-input" value="2" min="1" max="10" step="1" style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; text-align: center;">`;
    panel.appendChild(concurrencyDiv);

    const formatDiv = document.createElement('div');
    formatDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: #333; padding: 0 5px;';
    formatDiv.innerHTML = `<span>图片格式:</span><select id="image-format-select" style="width: 74px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; text-align: center;"><option value="jpg">JPG</option><option value="png">PNG</option></select>`;
    panel.appendChild(formatDiv);
    const formatSelect = formatDiv.querySelector('#image-format-select');
    formatSelect.value = getSavedImageFormat();

    // 新增：导出销量TXT选项
    const txtOptionDiv = document.createElement('div');
    txtOptionDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 13px; color: #333; padding: 0 5px;';
    txtOptionDiv.innerHTML = `<span>生成销量TXT统计:</span><input type="checkbox" id="save-txt-checkbox" style="width: 18px; height: 18px; cursor: pointer;">`;
    panel.appendChild(txtOptionDiv);

    const testBtn = document.createElement('button');
    testBtn.innerText = '测试下载第1个';
    testBtn.style.cssText = 'background: #eee; color: #333; border: 1px solid #ccc; width: 100%; padding: 8px; border-radius: 4px; cursor: pointer; margin-bottom: 8px; font-size: 13px;';

    const batchBtn = document.createElement('button');
    batchBtn.innerText = '批量下载符合条件商品';
    batchBtn.style.cssText = 'background: #fb7701; color: white; border: none; width: 100%; padding: 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; margin-bottom: 8px;';

    const resetBtn = document.createElement('button');
    resetBtn.innerText = '🔄 清理状态 / 刷新店名';
    resetBtn.style.cssText = 'background: #f8f9fa; color: #666; border: 1px solid #ddd; width: 100%; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-bottom: 8px;';

    const viewListBtn = document.createElement('button');
    viewListBtn.innerText = '📋 管理/备份已抓取店铺';
    viewListBtn.style.cssText = 'background: #fff; color: #666; border: 1px solid #ddd; width: 100%; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 12px;';

    const status = document.createElement('div');
    status.style.cssText = 'margin-top: 10px; font-size: 12px; color: #666; min-height: 40px; white-space: pre-wrap; line-height: 1.4;';

    function updateStatusText(msg = '') {
        const currentShop = safeGetShopName();
        status.innerText = `当前店铺: ${currentShop}\n输出格式: ${getSelectedImageFormat().toUpperCase()}\n${msg || '等待操作...'}`;
    }
    updateStatusText();

    panel.appendChild(testBtn);
    panel.appendChild(batchBtn);
    panel.appendChild(resetBtn);
    panel.appendChild(viewListBtn);
    panel.appendChild(status);
    container.appendChild(handle);
    container.appendChild(panel);

    const DUPLICATE_TOAST_ID = 'temu-duplicate-shop-toast';
    let lastDuplicateToastShop = '';
    let duplicateToastTimer = null;

    function showDuplicateShopToast(shopName) {
        if (!document.body) return;
        const oldToast = document.getElementById(DUPLICATE_TOAST_ID);
        if (oldToast) oldToast.remove();
        if (duplicateToastTimer) clearTimeout(duplicateToastTimer);

        const toast = document.createElement('div');
        toast.id = DUPLICATE_TOAST_ID;
        toast.style.cssText = [
            'position: fixed',
            'top: 90px',
            'left: 50%',
            'z-index: 10005',
            'width: 360px',
            'max-width: calc(100vw - 40px)',
            'background: rgba(255,255,255,0.98)',
            'border: 1px solid rgba(255,77,79,0.22)',
            'border-left: 6px solid #ff4d4f',
            'border-radius: 10px',
            'box-shadow: 0 12px 32px rgba(0,0,0,0.18)',
            'padding: 16px 44px 16px 18px',
            'font-family: sans-serif',
            'font-size: 15px',
            'line-height: 1.55',
            'color: #333',
            'opacity: 0',
            'transform: translate(-50%, -10px)',
            'transition: opacity 0.2s ease, transform 0.2s ease',
            'pointer-events: auto'
        ].join(';');

        const title = document.createElement('div');
        title.textContent = '这个店铺之前抓取过';
        title.style.cssText = 'font-weight: bold; color: #ff4d4f; margin-bottom: 5px; font-size: 16px;';

        const detail = document.createElement('div');
        detail.textContent = shopName;
        detail.style.cssText = 'color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'position:absolute; top:9px; right:12px; border:none; background:transparent; color:#999; font-size:22px; line-height:22px; cursor:pointer; padding:0;';

        const hideToast = () => {
            if (duplicateToastTimer) clearTimeout(duplicateToastTimer);
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -10px)';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 220);
        };

        closeBtn.onclick = hideToast;
        toast.appendChild(title);
        toast.appendChild(detail);
        toast.appendChild(closeBtn);
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translate(-50%, 0)';
        });
        duplicateToastTimer = setTimeout(hideToast, 4500);
    }

    function checkDuplicateShopToast() {
        const shopName = safeGetShopName();
        const shopKey = normalizeShopNameForCompare(shopName);
        if (!isScrapedShopName(shopName) || shopKey === lastDuplicateToastShop) return;
        lastDuplicateToastShop = shopKey;
        showDuplicateShopToast(shopName);
    }

    function startDuplicateShopWatcher() {
        let lastUrl = location.href;
        setTimeout(checkDuplicateShopToast, 1200);
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastDuplicateToastShop = '';
            }
            checkDuplicateShopToast();
        }, 1500);
    }

    function appendPanelWhenReady() {
        if (document.body) {
            document.body.appendChild(container);
            startDuplicateShopWatcher();
            autoBackupScrapedShops();
            return;
        }
        setTimeout(appendPanelWhenReady, 100);
    }
    appendPanelWhenReady();

    let isOpen = false;
    handle.onclick = () => {
        isOpen = !isOpen;
        container.style.transform = isOpen ? 'translateX(0)' : 'translateX(250px)';
        handle.innerText = isOpen ? '收回' : '抓取器';
        if (isOpen) updateStatusText();
    };

    resetBtn.onclick = () => { updateStatusText('已重置状态'); };
    formatSelect.onchange = (event) => {
        GM_setValue(IMAGE_FORMAT_KEY, normalizeImageFormat(event.target.value));
        updateStatusText('已切换图片格式');
    };

    // --- 逻辑函数 ---
    function sanitize(name) { return name.replace(/[\\/:*?"<>|]/g, '_').trim().substring(0, 200); }

    function parseSales(text) {
        if (!text) return 0;
        const normalized = String(text).replace(/,/g, '').replace(/\s+/g, '').replace(/\+/g, '');
        const match = normalized.match(/([\d.]+)([万kKmM]?)/);
        if (match) {
            let num = parseFloat(match[1]);
            if (!Number.isFinite(num)) return 0;
            const unit = match[2];
            if (unit === '万') num *= 10000;
            else if (unit.toLowerCase() === 'k') num *= 1000;
            else if (unit.toLowerCase() === 'm') num *= 1000000;
            return num;
        }
        return 0;
    }

    function extractSalesCount(text) {
        if (!text) return 0;
        const normalized = String(text).replace(/\s+/g, ' ');
        const salesPatterns = [
            /(?:已售|销量)\s*([\d,.]+(?:\.\d+)?\s*[万kKmM]?\+?)/i,
            /([\d,.]+(?:\.\d+)?\s*[万kKmM]?\+?)\s*(?:已售|销量)/i,
            /sold\s*([\d,.]+(?:\.\d+)?\s*[kKmM]?\+?)/i,
            /([\d,.]+(?:\.\d+)?\s*[kKmM]?\+?)\s*sold/i
        ];

        for (const pattern of salesPatterns) {
            const match = normalized.match(pattern);
            if (match) return parseSales(match[1]);
        }

        return 0;
    }

    function parsePriceNumber(text) {
        if (text == null) return NaN;
        const raw = String(text).replace(/\s+/g, '');
        const compact = raw.replace(/[^\d,.\-]/g, '');
        if (!compact) return NaN;

        const lastCommaIndex = compact.lastIndexOf(',');
        const lastDotIndex = compact.lastIndexOf('.');
        let normalized = compact;

        if (lastCommaIndex >= 0 && lastDotIndex >= 0) {
            if (lastCommaIndex > lastDotIndex) {
                normalized = compact.replace(/\./g, '').replace(',', '.');
            } else {
                normalized = compact.replace(/,/g, '');
            }
        } else if (lastCommaIndex >= 0) {
            const commaCount = (compact.match(/,/g) || []).length;
            if (commaCount === 1 && /\d,\d{1,2}$/.test(compact)) {
                normalized = compact.replace(',', '.');
            } else {
                normalized = compact.replace(/,/g, '');
            }
        } else if (lastDotIndex >= 0) {
            const dotCount = (compact.match(/\./g) || []).length;
            if (dotCount > 1) {
                const lastDot = compact.lastIndexOf('.');
                normalized = compact.slice(0, lastDot).replace(/\./g, '') + compact.slice(lastDot);
            }
        }

        const value = parseFloat(normalized);
        return Number.isFinite(value) ? value : NaN;
    }

    function extractCurrentPrice(container) {
        if (!container) return NaN;

        const priceNode = container.querySelector('[data-type="price"]');
        if (priceNode) {
            const accessibilityText = Array.from(priceNode.querySelectorAll('span'))
                .map(el => (el.innerText || el.textContent || '').trim())
                .find(text => /\$\s*\d|\b\d+\.\d+\b/.test(text));
            const directPrice = parsePriceNumber(accessibilityText || priceNode.innerText || priceNode.textContent || '');
            if (Number.isFinite(directPrice)) return directPrice;
        }

        const priceBlock = container.querySelector('div._3WBDHjhZ');
        if (priceBlock) {
            const clonedBlock = priceBlock.cloneNode(true);
            clonedBlock.querySelectorAll('[data-type="frontMarketPrice"]').forEach(el => el.remove());
            const blockPrice = parsePriceNumber(clonedBlock.innerText || clonedBlock.textContent || '');
            if (Number.isFinite(blockPrice)) return blockPrice;
        }

        const currentPriceNode = container.querySelector('div._382YgpSF');
        const fallbackPrice = parsePriceNumber(currentPriceNode ? (currentPriceNode.innerText || currentPriceNode.textContent || '') : '');
        return Number.isFinite(fallbackPrice) ? fallbackPrice : NaN;
    }

    function getBestUrlFromSrcset(srcset) {
        if (!srcset) return '';
        const candidates = srcset.split(',').map(part => {
            const tokens = part.trim().split(/\s+/);
            const url = tokens[0];
            const descriptor = tokens[1] || '';
            const widthMatch = descriptor.match(/(\d+)w/i);
            const densityMatch = descriptor.match(/([\d.]+)x/i);
            let score = getUrlScore(url);
            if (widthMatch) score = parseInt(widthMatch[1], 10);
            else if (densityMatch) score = parseFloat(densityMatch[1]) * 1000;
            return { url, score };
        }).filter(item => item.url && !item.url.startsWith('data:'));

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] ? candidates[0].url : '';
    }

    function getUrlScore(url) {
        if (!url) return 0;
        const text = String(url);
        const scores = [];
        const patterns = [
            /\/w\/(\d+)/ig,
            /\/h\/(\d+)/ig,
            /[?&](?:w|width)=(\d+)/ig,
            /[?&](?:h|height)=(\d+)/ig
        ];
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                scores.push(parseInt(match[1], 10));
            }
        });
        return scores.length ? Math.max(...scores) : 0;
    }

    function normalizeImageUrl(url) {
        if (!url) return '';
        let normalized = String(url).trim().replace(/&amp;/g, '&');
        if (normalized.startsWith('//')) normalized = 'https:' + normalized;
        if (!/^https?:\/\//i.test(normalized) || normalized.startsWith('data:')) return '';
        return normalized;
    }

    function toOriginalImageUrl(url) {
        const normalized = normalizeImageUrl(url);
        if (!normalized) return '';
        try {
            const parsed = new URL(normalized);
            return `${parsed.origin}${parsed.pathname}`;
        } catch (error) {
            return normalized.split('?')[0];
        }
    }

    function toPngImageUrl(url) {
        const originalUrl = toOriginalImageUrl(url);
        if (!originalUrl) return '';
        return `${originalUrl}?imageView2/2/w/1300/q/90/format/png`;
    }

    function getImageExtension(url) {
        const lowerUrl = String(url || '').toLowerCase();
        const formatMatch = lowerUrl.match(/(?:\/format\/|[?&]format=)(avif|webp|png|jpe?g)/i);
        if (formatMatch) return formatMatch[1].replace('jpeg', 'jpg');

        const pathMatch = lowerUrl.split('?')[0].match(/\.(avif|webp|png|jpe?g)$/i);
        if (pathMatch) return pathMatch[1].replace('jpeg', 'jpg');

        return 'jpg';
    }

    function getPrimaryImageElement(container) {
        const selectors = [
            'img[data-js-main-img="true"]',
            'a[aria-label*="item picture" i] img',
            'a[href*="-g-"] img',
            'a[href*="/g-"] img',
            'img[src*="kwcdn.com"]',
            'img[srcset*="kwcdn.com"]',
            'img'
        ];

        for (const selector of selectors) {
            const images = Array.from(container.querySelectorAll(selector));
            const matched = images.find(img => {
                const width = img.clientWidth || img.naturalWidth || 0;
                const height = img.clientHeight || img.naturalHeight || 0;
                return width >= 120 && height >= 120;
            });
            if (matched) return matched;
        }

        return null;
    }

    function getBestImageUrl(container, imageFormat) {
        const primaryImage = getPrimaryImageElement(container);
        if (!primaryImage) return '';

        const rawCandidates = [];
        rawCandidates.push(
            primaryImage.currentSrc,
            primaryImage.getAttribute('data-src'),
            primaryImage.getAttribute('src'),
            getBestUrlFromSrcset(primaryImage.getAttribute('srcset')),
            getBestUrlFromSrcset(primaryImage.getAttribute('data-srcset'))
        );

        const picture = primaryImage.closest('picture');
        if (picture) {
            picture.querySelectorAll('source').forEach(source => {
                rawCandidates.push(
                    getBestUrlFromSrcset(source.getAttribute('srcset')),
                    getBestUrlFromSrcset(source.getAttribute('data-srcset'))
                );
            });
        }

        const transformUrl = normalizeImageFormat(imageFormat) === 'png' ? toPngImageUrl : toOriginalImageUrl;
        const uniqueUrls = Array.from(new Set(rawCandidates.map(transformUrl).filter(Boolean)));
        const temuUrls = uniqueUrls.filter(url => /kwcdn\.com|temu/i.test(url));
        const candidates = temuUrls.length ? temuUrls : uniqueUrls;
        return candidates[0] || '';
    }

    function getAbsoluteTop(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') return Infinity;
        const rect = element.getBoundingClientRect();
        return rect.top + window.scrollY;
    }

    function getRecommendationBoundaryTop() {
        const boundaryKeywords = [
            'Top picks for you',
            'You may also like',
            'Recommended for you',
            'More to consider',
            '猜你喜欢',
            '为你推荐',
            '相关推荐',
            '精选推荐'
        ];

        let boundaryTop = Infinity;
        const candidates = document.querySelectorAll('h1, h2, h3, h4, div, span, p');
        candidates.forEach(el => {
            const rawText = (el.innerText || el.textContent || '').trim();
            if (!rawText || rawText.length > 80) return;
            const matched = boundaryKeywords.some(keyword => rawText.toLowerCase().includes(keyword.toLowerCase()));
            if (!matched) return;

            const top = getAbsoluteTop(el);
            if (Number.isFinite(top) && top > 0 && top < boundaryTop) {
                boundaryTop = top;
            }
        });

        return boundaryTop;
    }

    function getItems(minSales = 1, minPrice = 0, imageFormat = getSelectedImageFormat()) {
        const results = [];
        const boundaryTop = getRecommendationBoundaryTop();
        const titleElements = document.querySelectorAll('span._2D9RBAXL');
        titleElements.forEach(el => {
            const title = el.innerText.trim();
            let fallbackContainer = el.parentElement;
            for (let i = 0; i < 5 && fallbackContainer; i++) {
                fallbackContainer = fallbackContainer.parentElement;
            }
            let container = el.closest('div[role="group"]') || el.closest('div[role="link"]') || fallbackContainer;
            if (!container) return;
            const containerTop = getAbsoluteTop(container);
            if (containerTop >= boundaryTop - 10) return;
            const containerText = container.innerText;
            const salesCount = extractSalesCount(containerText);
            if (salesCount < minSales) return;
            const currentPrice = extractCurrentPrice(container);
            if (Number.isFinite(currentPrice) && currentPrice < minPrice) return;
            if (!Number.isFinite(currentPrice) && minPrice > 0) return;

            const url = getBestImageUrl(container, imageFormat);
            if (url && title) {
                results.push({ title: sanitize(title), url: url, ext: normalizeImageFormat(imageFormat), sales: salesCount, price: currentPrice });
            }
        });
        return { items: results };
    }

    function getShopFolderName(shopName) {
        const folderName = sanitize(shopName || safeGetShopName() || '未知店铺');
        return folderName || '未知店铺';
    }

    function getDownloadErrorText(error) {
        if (!error) return '下载失败';
        if (typeof error === 'string') return error;
        return error.error || error.details || error.message || `下载失败${error.status ? ` (${error.status})` : ''}`;
    }

    function parseResponseHeaders(rawHeaders) {
        const headers = {};
        String(rawHeaders || '').split(/\r?\n/).forEach(line => {
            const index = line.indexOf(':');
            if (index <= 0) return;
            const key = line.slice(0, index).trim().toLowerCase();
            const value = line.slice(index + 1).trim();
            if (key) headers[key] = value;
        });
        return headers;
    }

    function getExtensionFromContentType(contentType) {
        const normalized = String(contentType || '').toLowerCase();
        if (normalized.includes('png')) return 'png';
        if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
        if (normalized.includes('webp')) return 'webp';
        if (normalized.includes('avif')) return 'avif';
        return '';
    }

    function requestImageBinary(item, onSuccess, onFailure) {
        const expectedType = normalizeImageFormat(item.ext) === 'png' ? 'image/png' : 'image/jpeg';
        GM_xmlhttpRequest({
            method: 'GET',
            url: item.url,
            responseType: 'arraybuffer',
            timeout: 45000,
            headers: {
                'Accept': `${expectedType},image/*,*/*;q=0.8`,
                'Cache-Control': 'no-cache'
            },
            onload: (response) => {
                if (!response || response.status < 200 || response.status >= 300) {
                    onFailure({ status: response ? response.status : 0, message: `请求失败 (${response ? response.status : 0})` });
                    return;
                }

                const arrayBuffer = response.response;
                const byteLength = arrayBuffer && typeof arrayBuffer.byteLength === 'number' ? arrayBuffer.byteLength : 0;
                if (!byteLength) {
                    onFailure('图片数据为空');
                    return;
                }

                const headers = parseResponseHeaders(response.responseHeaders);
                const contentType = headers['content-type'] || expectedType;
                const detectedExt = getExtensionFromContentType(contentType) || normalizeImageFormat(item.ext);
                const blob = new Blob([arrayBuffer], { type: contentType });
                onSuccess({ blob, detectedExt, contentType, byteLength });
            },
            onerror: (error) => onFailure(error),
            ontimeout: () => onFailure('请求超时')
        });
    }

    function saveBlobWithGmDownload(blob, fileName, onload, onerror, ontimeout) {
        const blobUrl = URL.createObjectURL(blob);
        GM_download({
            url: blobUrl,
            name: fileName,
            saveAs: false,
            timeout: 30000,
            onload: () => {
                URL.revokeObjectURL(blobUrl);
                onload();
            },
            onerror: (error) => {
                URL.revokeObjectURL(blobUrl);
                onerror(error);
            },
            ontimeout: () => {
                URL.revokeObjectURL(blobUrl);
                ontimeout();
            }
        });
    }

    function updateDownloadSummary(stats, shopFolderName) {
        if (!stats || stats.success + stats.failed < stats.total) return;
        if (stats.failed > 0) {
            updateStatusText(`下载完成，有失败项\n成功 ${stats.success}/${stats.total} 张，失败 ${stats.failed} 张\n文件夹: ${shopFolderName}`);
        } else {
            updateStatusText(`下载全部完成！\n共保存 ${stats.success} 张高清图片\n文件夹: ${shopFolderName}`);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
    }

    function downloadItem(item, index, total, shopName = safeGetShopName(), stats = null, onComplete = null) {
        const shopFolderName = getShopFolderName(shopName);
        const complete = () => {
            if (typeof onComplete === 'function') onComplete();
        };
        requestImageBinary(item, ({ blob, detectedExt }) => {
            const finalExt = detectedExt || item.ext || getImageExtension(item.url);
            const fileName = `${shopFolderName}/${item.title}.${finalExt}`;
            saveBlobWithGmDownload(blob, fileName, () => {
                if (stats) stats.success++;
                const doneCount = stats ? stats.success + stats.failed : index + 1;
                const formatNote = finalExt !== normalizeImageFormat(item.ext) ? `\n格式回退: ${finalExt.toUpperCase()}` : '';
                updateStatusText(`[成功] ${doneCount}/${total}\n${item.title.substring(0,10)}...${formatNote}`);
                if (!stats && index + 1 === total) updateStatusText(`下载全部完成！\n共保存 ${total} 张高清图片\n文件夹: ${shopFolderName}`);
                updateDownloadSummary(stats, shopFolderName);
                complete();
            }, (error) => {
                if (stats) stats.failed++;
                const doneCount = stats ? stats.success + stats.failed : index + 1;
                updateStatusText(`[失败] ${doneCount}/${total}\n${item.title.substring(0,10)}...\n保存失败: ${getDownloadErrorText(error)}`);
                updateDownloadSummary(stats, shopFolderName);
                complete();
            }, () => {
                if (stats) stats.failed++;
                const doneCount = stats ? stats.success + stats.failed : index + 1;
                updateStatusText(`[超时] ${doneCount}/${total}\n${item.title.substring(0,10)}...\n保存超时`);
                updateDownloadSummary(stats, shopFolderName);
                complete();
            });
        }, (error) => {
            if (stats) stats.failed++;
            const doneCount = stats ? stats.success + stats.failed : index + 1;
            updateStatusText(`[失败] ${doneCount}/${total}\n${item.title.substring(0,10)}...\n抓图失败: ${getDownloadErrorText(error)}`);
            updateDownloadSummary(stats, shopFolderName);
            complete();
        });
    }

    async function startConcurrentDownloads(items, shopName, downloadInterval, concurrency, stats) {
        const workerCount = Math.min(items.length, Math.max(1, Math.min(10, parseInt(concurrency, 10) || 1)));
        let nextIndex = 0;

        const worker = async (workerIndex) => {
            if (workerIndex > 0 && downloadInterval > 0) {
                await sleep(workerIndex * downloadInterval);
            }

            while (true) {
                const currentIndex = nextIndex++;
                if (currentIndex >= items.length) return;

                await new Promise(resolve => {
                    downloadItem(items[currentIndex], currentIndex, items.length, shopName, stats, resolve);
                });

                if (downloadInterval > 0) {
                    await sleep(downloadInterval);
                }
            }
        };

        updateStatusText(`开始下载...\n共 ${items.length} 张\n并发: ${workerCount}\n间隔: ${downloadInterval}ms`);
        await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index)));
    }

    // --- 按钮逻辑 ---
    viewListBtn.onclick = showListModal;

    testBtn.onclick = () => {
        const minSalesThreshold = parseInt(document.getElementById('min-sales-input').value) || 0;
        const minPriceThreshold = parseFloat(document.getElementById('min-price-input').value) || 0;
        const imageFormat = getSelectedImageFormat();
        const { items } = getItems(minSalesThreshold, minPriceThreshold, imageFormat);
        const shopName = safeGetShopName();
        if (items.length > 0) {
            updateStatusText(`测试高清下载中...`);
            downloadItem(items[0], 0, 1, shopName, { success: 0, failed: 0, total: 1 });
        } else { updateStatusText(`未找到满足条件的商品\n销量≥${minSalesThreshold}，价格≥${minPriceThreshold}`); }
    };

    batchBtn.onclick = () => {
        const minSalesThreshold = parseInt(document.getElementById('min-sales-input').value) || 0;
        const minPriceThreshold = parseFloat(document.getElementById('min-price-input').value) || 0;
        const downloadInterval = parseInt(document.getElementById('download-interval-input').value) || 1000;
        const downloadConcurrency = parseInt(document.getElementById('download-concurrency-input').value, 10) || 1;
        const isSaveTxt = document.getElementById('save-txt-checkbox').checked;
        const imageFormat = getSelectedImageFormat();
        const { items } = getItems(minSalesThreshold, minPriceThreshold, imageFormat);
        const shopName = safeGetShopName();
        const shopFolderName = getShopFolderName(shopName);

        if (items.length === 0) { updateStatusText(`未找到商品`); return; }

        const isDuplicate = isScrapedShopName(shopName);

        showConfirmModal(items.length, shopName, isDuplicate, minSalesThreshold, minPriceThreshold, async () => {
            lastDuplicateToastShop = normalizeShopNameForCompare(shopName);
            saveShopName(shopName);

            // 如果勾选了保存TXT
            if (isSaveTxt) {
                const txtLines = [`店铺: ${shopName}`, `统计时间: ${new Date().toLocaleString()}`, `筛选条件: 销量 >= ${minSalesThreshold}，价格 >= ${minPriceThreshold}`, `商品总数: ${items.length}`, `---------------------------`];
                items.forEach(item => {
                    txtLines.push(`标题: ${item.title}`);
                    txtLines.push(`销量: ${item.sales}`);
                    txtLines.push(`价格: ${Number.isFinite(item.price) ? item.price.toFixed(2) : '未识别'}`);
                    txtLines.push(`---------------------------`);
                });
                const blob = new Blob([txtLines.join('\n')], { type: 'text/plain' });
                const blobUrl = URL.createObjectURL(blob);
                GM_download({
                    url: blobUrl,
                    name: `${shopFolderName}/${shopFolderName}_销量统计.txt`,
                    onload: () => URL.revokeObjectURL(blobUrl),
                    onerror: (error) => {
                        URL.revokeObjectURL(blobUrl);
                        updateStatusText(`销量TXT下载失败\n${getDownloadErrorText(error)}`);
                    },
                    ontimeout: () => {
                        URL.revokeObjectURL(blobUrl);
                        updateStatusText('销量TXT下载超时');
                    }
                });
            }

            // 开始下载图片
            const downloadStats = { success: 0, failed: 0, total: items.length };
            await startConcurrentDownloads(items, shopName, downloadInterval, downloadConcurrency, downloadStats);
        });
    };

    // --- 弹窗逻辑 (精简) ---
    function showListModal() {
        const list = getScrapedShops();
        const modal = document.createElement('div');
        modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10002; display: flex; align-items: center; justify-content: center;`;
        const dialog = document.createElement('div');
        dialog.style.cssText = `background: #fff; padding: 25px; border-radius: 12px; width: 420px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); position: relative; font-family: sans-serif;`;
        const plainTextContent = list.join('\n');
        dialog.innerHTML = `<h3 style="margin-top:0; color:#fb7701; border-bottom:2px solid #fb7701; padding-bottom:10px; display:flex; justify-content:space-between; align-items:center;"><span>已抓取清单 (${list.length})</span><span id="modal-close-x" style="cursor:pointer; color:#999; font-size:24px;">&times;</span></h3><textarea id="config-text" style="width:100%; height:220px; border:1px solid #ddd; border-radius:6px; padding:10px; font-size:13px; line-height:1.5;">${plainTextContent}</textarea><div style="display:flex; gap:8px; margin-top:10px;"><button id="copy-config" style="flex:1; padding:8px; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer;">全部复制</button><button id="import-config" style="flex:1; padding:8px; background:#2196F3; color:white; border:none; border-radius:4px; cursor:pointer;">保存导入</button></div><div style="display:flex; gap:10px; margin-top:25px;"><button id="modal-clear" style="flex:1; padding:10px; border:1px solid #ff4d4f; color:#ff4d4f; background:#fff; border-radius:4px; cursor:pointer;">清空记录</button><button id="modal-close" style="flex:1; padding:10px; border:none; background:#fb7701; color:#fff; border-radius:4px; cursor:pointer; font-weight:bold;">完成</button></div>`;
        modal.appendChild(dialog); document.body.appendChild(modal);
        const textarea = document.getElementById('config-text');
        const backupBtn = document.createElement('button');
        backupBtn.id = 'backup-config';
        backupBtn.innerText = '下载备份TXT';
        backupBtn.style.cssText = 'flex:1; padding:8px; background:#fb7701; color:white; border:none; border-radius:4px; cursor:pointer;';
        document.getElementById('copy-config').parentElement.appendChild(backupBtn);
        document.getElementById('modal-close').onclick = () => document.body.removeChild(modal);
        document.getElementById('modal-close-x').onclick = () => document.body.removeChild(modal);
        document.getElementById('copy-config').onclick = () => { textarea.select(); document.execCommand('copy'); alert('复制成功'); };
        document.getElementById('backup-config').onclick = () => backupScrapedShopsToLocal(true);
        document.getElementById('import-config').onclick = () => { const newList = textarea.value.split('\n').map(s => s.trim()).filter(s => s !== ""); GM_setValue(STORAGE_KEY, newList); location.reload(); };
        document.getElementById('modal-clear').onclick = () => { if (confirm('确定要清空吗？')) { GM_setValue(STORAGE_KEY, []); location.reload(); }};
    }

    function showConfirmModal(count, shopName, isDuplicate, minSales, minPrice, onConfirm) {
        const modal = document.createElement('div');
        modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center;`;
        const dialog = document.createElement('div');
        dialog.style.cssText = `background: #fff; padding: 25px; border-radius: 12px; width: 320px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: ${isDuplicate ? '3px solid #ff4d4f' : 'none'};`;
        const titleColor = isDuplicate ? '#ff4d4f' : '#fb7701';
        dialog.innerHTML = `<h3 style="margin-top:0; color:${titleColor};">下载确认</h3><p style="font-size:14px; color:#333; margin:15px 0;">店铺: <b>${shopName}</b><br>${isDuplicate ? '<b style="color:#ff4d4f;">⚠️ 之前已抓取过此店铺！</b><br>' : ''}满足 销量≥<b>${minSales}</b> 且 价格≥<b>${minPrice}</b> 商品: <b>${count}</b> 个。<br><br>确认开始高清下载吗？</p><div style="display:flex; gap:10px; justify-content:center;"><button id="c-cancel" style="padding:8px 20px; border:1px solid #ccc; background:#fff; cursor:pointer;">取消</button><button id="c-ok" style="padding:8px 20px; border:none; background:${titleColor}; color:#fff; cursor:pointer; font-weight:bold;">确定</button></div>`;
        modal.appendChild(dialog); document.body.appendChild(modal);
        document.getElementById('c-cancel').onclick = () => document.body.removeChild(modal);
        document.getElementById('c-ok').onclick = () => { document.body.removeChild(modal); onConfirm(); };
    }
})();
