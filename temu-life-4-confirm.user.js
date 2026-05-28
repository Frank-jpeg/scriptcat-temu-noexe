// ==UserScript==
// @name         上新生命周期-4-确认商品信息 自改版可视化业务日志
// @namespace    https://www.goldabcd.com/
// @description  确认商品信息（自改版，无需下载器EXE，带可视化配置、接口日志和业务明细）
// @author       TonyTonyYang
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.0528.1
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/jianpanlan0-svg/scriptcat-temu-noexe/main/temu-life-4-confirm.user.js
// @downloadURL  https://raw.githubusercontent.com/jianpanlan0-svg/scriptcat-temu-noexe/main/temu-life-4-confirm.user.js
// ==/UserScript==

const NOEXE_STORAGE_KEY = "goldabcd_noexe_config_v1";
const NOEXE_UI_VERSION = "2026.0528.1";
const NOEXE_DEFAULT_CONFIG = {
    "version": 1,
    "malls": [],
    "priceReviewConfig": {
        "normal": {},
        "disney": {},
        "sanrio": {},
        "priceMultiple": {}
    }
};const NOEXE_PRICE_GROUPS = [
    { key: "normal", label: "普货" },
    { key: "disney", label: "迪士尼" },
    { key: "sanrio", label: "三丽欧" }
];
const NOEXE_UI_HOST_ID = "goldabcd-noexe-config-host";
const NOEXE_UI_OPEN_EVENT = "goldabcd-noexe-open-config";
const NOEXE_LOG_OPEN_EVENT = "goldabcd-noexe-open-log";
const NOEXE_LOG_EVENT = "goldabcd-noexe-log-event";
const NOEXE_SCRIPT_NAME = "上新生命周期-4-确认商品信息 自改版可视化";
const NOEXE_LOG_SCRIPT_FILTERS = [
    { key: "all", label: "全部脚本", match: "" },
    { key: "price", label: "1 提交核价", match: "上新生命周期-1-提交核价" },
    { key: "jit", label: "2 开通JIT", match: "上新生命周期-2-开通JIT" },
    { key: "stock", label: "3 增加库存", match: "上新生命周期-3-增加库存" },
    { key: "confirm", label: "4 确认商品信息", match: "上新生命周期-4-确认商品信息" }
];
const NOEXE_LOG_KEEP_PER_SCRIPT = 1000;
const NOEXE_LOG_RENDER_LIMIT = 120;
const NOEXE_LOG_MESSAGE_PREVIEW_LENGTH = 600;
const NOEXE_LOG_RENDER_DEBOUNCE_MS = 300;
let noExeUiContext = null;
const noExeOriginalConsoleLog = console.log.bind(console);
let noExeLogCounter = 0;
let noExeLogRenderTimer = null;
let noExeLogState = {
    stats: { total: 0, success: 0, fail: 0, apiError: 0, inFlight: 0, detail: 0 },
    active: {},
    filter: "all",
    entries: []
};

async function getSkey(mallId) {
    const config = await loadNoExeConfig();
    const mall = (config.malls || []).find(function(item) {
        return String(item.mallId) === String(mallId);
    });

    if (!mall) {
        noExeBusinessLog("当前店铺未配置，默认按全托运行；半托店铺请先在修改配置里添加当前店铺并打开半托开关", mallId);
    }

    return {
        isSemiHosted: !!(mall && mall.isSemiHosted)
    };
}

async function getNoExeNamedConfig(theName) {
    const config = await loadNoExeConfig();
    if (theName === "阶梯核价设置") return cloneNoExe(config.priceReviewConfig);
    return null;
}

async function loadNoExeConfig() {
    let config = await getNoExeValue(NOEXE_STORAGE_KEY, null);
    if (typeof config === "string" && config) {
        try {
            config = JSON.parse(config);
        } catch (e) {
            noExeBusinessLog("自改版配置解析失败，使用内置配置", e);
            config = null;
        }
    }

    if (!config || !Array.isArray(config.malls) || !config.priceReviewConfig) {
        config = cloneNoExe(NOEXE_DEFAULT_CONFIG);
        await setNoExeValue(NOEXE_STORAGE_KEY, JSON.stringify(config));
    }

    return normalizeNoExeConfig(config);
}

function normalizeNoExeConfig(config) {
    config = config && typeof config === "object" ? config : {};
    if (!Array.isArray(config.malls)) config.malls = [];
    if (!config.priceReviewConfig || typeof config.priceReviewConfig !== "object") config.priceReviewConfig = {};
    NOEXE_PRICE_GROUPS.forEach(function(group) {
        if (!config.priceReviewConfig[group.key] || typeof config.priceReviewConfig[group.key] !== "object" || Array.isArray(config.priceReviewConfig[group.key])) {
            config.priceReviewConfig[group.key] = {};
        }
        Object.keys(config.priceReviewConfig[group.key]).forEach(function(specName) {
            const prices = config.priceReviewConfig[group.key][specName];
            config.priceReviewConfig[group.key][specName] = Array.isArray(prices) ? prices.map(function(price) {
                return Number(price);
            }).filter(function(price) {
                return Number.isFinite(price);
            }) : [];
        });
    });
    if (!config.priceReviewConfig.priceMultiple || typeof config.priceReviewConfig.priceMultiple !== "object" || Array.isArray(config.priceReviewConfig.priceMultiple)) {
        config.priceReviewConfig.priceMultiple = {};
    }
    return config;
}

async function getNoExeValue(key, fallbackValue) {
    try {
        if (typeof GM_getValue === "function") {
            const value = GM_getValue(key, fallbackValue);
            return value && typeof value.then === "function" ? await value : value;
        }
        if (typeof GM !== "undefined" && GM.getValue) {
            return await GM.getValue(key, fallbackValue);
        }
    } catch (e) {
        noExeBusinessLog("读取自改版配置失败，改用 localStorage", e);
    }

    const raw = localStorage.getItem(key);
    return raw === null ? fallbackValue : raw;
}

async function setNoExeValue(key, value) {
    try {
        if (typeof GM_setValue === "function") {
            const result = GM_setValue(key, value);
            if (result && typeof result.then === "function") await result;
            return;
        }
        if (typeof GM !== "undefined" && GM.setValue) {
            await GM.setValue(key, value);
            return;
        }
    } catch (e) {
        noExeBusinessLog("保存自改版配置失败，改用 localStorage", e);
    }
    localStorage.setItem(key, value);
}

async function saveNoExeConfig(config, shouldRender) {
    noExeUiContext.config = normalizeNoExeConfig(config);
    await setNoExeValue(NOEXE_STORAGE_KEY, JSON.stringify(noExeUiContext.config));
    noExeUiContext.state.status = "已保存 " + new Date().toLocaleTimeString();
    if (shouldRender !== false) noExeRenderPanel();
    else noExeSetStatus(noExeUiContext.state.status);
}

function cloneNoExe(value) {
    return JSON.parse(JSON.stringify(value));
}

function registerNoExeConfigMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;

    GM_registerMenuCommand("自改版：打开可视化配置", openNoExeConfigPanel);
    GM_registerMenuCommand("自改版：打开运行日志", noExeOpenLogPanel);
    GM_registerMenuCommand("自改版：导出配置JSON", async function() {
        const config = await loadNoExeConfig();
        await copyNoExeText(JSON.stringify(config, null, 2));
    });
    GM_registerMenuCommand("自改版：重置内置配置", async function() {
        if (!confirm("确定要重置为空白内置配置？当前修改会被清空。")) return;
        await setNoExeValue(NOEXE_STORAGE_KEY, JSON.stringify(cloneNoExe(NOEXE_DEFAULT_CONFIG)));
        alert("已重置为空白内置配置，刷新页面后生效");
    });
}

function ensureNoExeConfigButton() {
    const existingHost = document.getElementById(NOEXE_UI_HOST_ID);
    if (existingHost) {
        if (existingHost.dataset.noexeUiVersion === NOEXE_UI_VERSION) return;
        existingHost.remove();
    }

    const host = document.createElement("div");
    host.id = NOEXE_UI_HOST_ID;
    host.dataset.noexeUiVersion = NOEXE_UI_VERSION;
    (document.documentElement || document.body).appendChild(host);

    const root = host.attachShadow({ mode: "open" });
    noExeUiContext = {
        root,
        config: null,
        state: {
            tab: "prices",
            group: "normal",
            search: "",
            importText: "",
            status: "未修改"
        }
    };

    root.innerHTML = `
        <style>
            :host { all: initial; }
            *, *::before, *::after { box-sizing: border-box; }
            .noexe-fab {
                position: fixed;
                left: 440px;
                top: 180px;
                z-index: 2147483646;
                border: 0;
                border-radius: 8px;
                background: #ff6a00;
                color: #fff;
                padding: 10px 14px;
                font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                box-shadow: 0 8px 22px rgba(0,0,0,.18);
                cursor: pointer;
            }
            .noexe-mask {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                background: rgba(15,23,42,.24);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
                color: #1f2937;
            }
            .noexe-mask[hidden] { display: none; }
            .noexe-panel {
                position: absolute;
                top: 0;
                right: 0;
                width: min(920px, calc(100vw - 28px));
                height: 100vh;
                background: #fff;
                box-shadow: -12px 0 34px rgba(15,23,42,.22);
                display: flex;
                flex-direction: column;
            }
            .noexe-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 18px 12px;
                border-bottom: 1px solid #e5e7eb;
            }
            .noexe-title { font-size: 17px; font-weight: 700; }
            .noexe-subtitle { margin-top: 3px; font-size: 12px; color: #6b7280; }
            .noexe-icon-btn {
                width: 34px;
                height: 34px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #fff;
                color: #374151;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
            }
            .noexe-tabs {
                display: flex;
                gap: 8px;
                padding: 12px 18px;
                border-bottom: 1px solid #eef0f3;
            }
            .noexe-tab, .noexe-segment, .noexe-btn, .noexe-danger-btn {
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #fff;
                color: #374151;
                padding: 8px 11px;
                font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                cursor: pointer;
            }
            .noexe-tab.is-active, .noexe-segment.is-active {
                background: #fff3eb;
                border-color: #ff6a00;
                color: #c2410c;
            }
            .noexe-body {
                flex: 1;
                overflow: auto;
                padding: 16px 18px 18px;
                background: #f8fafc;
            }
            .noexe-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 12px 18px;
                border-top: 1px solid #e5e7eb;
                background: #fff;
            }
            .noexe-status { font-size: 12px; color: #15803d; }
            .noexe-toolbar {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 10px;
                margin-bottom: 12px;
            }
            .noexe-btn {
                background: #111827;
                border-color: #111827;
                color: #fff;
            }
            .noexe-btn.secondary {
                background: #fff;
                border-color: #d1d5db;
                color: #374151;
            }
            .noexe-danger-btn {
                border-color: #fecaca;
                background: #fff;
                color: #b91c1c;
            }
            .noexe-note { color: #6b7280; font-size: 12px; line-height: 1.5; }
            .noexe-table {
                width: 100%;
                border-collapse: collapse;
                background: #fff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                overflow: hidden;
            }
            .noexe-table th, .noexe-table td {
                border-bottom: 1px solid #eef0f3;
                padding: 9px;
                text-align: left;
                font-size: 13px;
                vertical-align: middle;
            }
            .noexe-table th {
                color: #6b7280;
                background: #fafafa;
                font-weight: 700;
            }
            .noexe-input, .noexe-select, .noexe-textarea {
                width: 100%;
                min-height: 34px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #fff;
                color: #111827;
                padding: 7px 9px;
                font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            }
            .noexe-input:focus, .noexe-textarea:focus {
                outline: none;
                border-color: #ff6a00;
                box-shadow: 0 0 0 3px rgba(255,106,0,.14);
            }
            .noexe-input.is-error { border-color: #dc2626; background: #fff7f7; }
            .noexe-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
            .noexe-switch input { display: none; }
            .noexe-track {
                width: 38px;
                height: 22px;
                border-radius: 999px;
                background: #d1d5db;
                position: relative;
                transition: background .16s ease;
            }
            .noexe-track::after {
                content: "";
                position: absolute;
                top: 3px;
                left: 3px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #fff;
                transition: transform .16s ease;
                box-shadow: 0 1px 3px rgba(0,0,0,.18);
            }
            .noexe-switch input:checked + .noexe-track { background: #16a34a; }
            .noexe-switch input:checked + .noexe-track::after { transform: translateX(16px); }
            .noexe-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(278px, 1fr));
                gap: 12px;
            }
            .noexe-card {
                background: #fff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: 12px;
            }
            .noexe-card-head {
                display: grid;
                grid-template-columns: 1fr auto;
                gap: 8px;
                align-items: center;
                margin-bottom: 10px;
            }
            .noexe-price-list {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
                gap: 8px;
            }
            .noexe-price-item {
                display: grid;
                grid-template-columns: 24px 1fr 26px;
                align-items: center;
                gap: 4px;
            }
            .noexe-round {
                color: #6b7280;
                font-size: 12px;
                text-align: right;
            }
            .noexe-mini {
                height: 30px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #fff;
                color: #374151;
                cursor: pointer;
            }
            .noexe-empty {
                padding: 28px;
                text-align: center;
                color: #6b7280;
                border: 1px dashed #cbd5e1;
                border-radius: 8px;
                background: #fff;
            }
            .noexe-textarea {
                min-height: 170px;
                resize: vertical;
                font-family: Consolas, "SFMono-Regular", monospace;
            }
            .noexe-section-title {
                margin: 14px 0 8px;
                color: #374151;
                font-size: 13px;
                font-weight: 700;
            }

            .noexe-log-fab {
                position: fixed;
                left: 440px;
                top: 220px;
                z-index: 2147483646;
                border: 0;
                border-radius: 8px;
                background: #111827;
                color: #fff;
                padding: 10px 14px;
                font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                box-shadow: 0 8px 22px rgba(0,0,0,.18);
                cursor: pointer;
            }
            .noexe-log-fab.has-error {
                background: #b91c1c;
            }
            .noexe-log-mask {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                background: rgba(15,23,42,.24);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
                color: #1f2937;
            }
            .noexe-log-mask[hidden] { display: none; }
            .noexe-stat-grid {
                display: grid;
                grid-template-columns: repeat(6, minmax(92px, 1fr));
                gap: 10px;
                margin-bottom: 12px;
            }
            .noexe-stat {
                background: #fff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: 10px;
            }
            .noexe-stat-label {
                color: #6b7280;
                font-size: 12px;
            }
            .noexe-stat-value {
                margin-top: 5px;
                color: #111827;
                font-size: 22px;
                font-weight: 800;
            }
            .noexe-log-list {
                display: grid;
                gap: 8px;
            }
            .noexe-log-item {
                background: #fff;
                border: 1px solid #e5e7eb;
                border-left: 4px solid #64748b;
                border-radius: 8px;
                padding: 10px 12px;
            }
            .noexe-log-item.success { border-left-color: #16a34a; }
            .noexe-log-item.fail { border-left-color: #f97316; }
            .noexe-log-item.error { border-left-color: #dc2626; }
            .noexe-log-item.detail { border-left-color: #2563eb; }
            .noexe-log-item.detail-error { border-left-color: #b91c1c; background: #fff7f7; }
            .noexe-log-line {
                display: flex;
                justify-content: space-between;
                gap: 10px;
                color: #111827;
                font-size: 13px;
                font-weight: 700;
            }
            .noexe-log-meta {
                margin-top: 5px;
                color: #6b7280;
                font-size: 12px;
                line-height: 1.45;
                word-break: break-all;
            }
            .noexe-log-message {
                margin-top: 6px;
                color: #374151;
                font-size: 12px;
                line-height: 1.45;
                word-break: break-word;
                white-space: pre-wrap;
                font-family: Consolas, "SFMono-Regular", "Microsoft YaHei", monospace;
            }

            @media (max-width: 640px) {
                .noexe-panel { width: 100vw; }
                .noexe-body { padding: 12px; }
                .noexe-table { min-width: 680px; }
                .noexe-table-wrap { overflow-x: auto; }
            }
        </style>
        <button class="noexe-fab" type="button">修改配置</button>
        <button class="noexe-log-fab" type="button">运行日志</button>
        <div class="noexe-mask" hidden>
            <aside class="noexe-panel">
                <div class="noexe-panel-content"></div>
            </aside>
        </div>
        <div class="noexe-log-mask" hidden>
            <aside class="noexe-panel">
                <div class="noexe-log-content"></div>
            </aside>
        </div>
    `;

    root.querySelector(".noexe-fab").addEventListener("click", noExeOpenUi);
    root.querySelector(".noexe-log-fab").addEventListener("click", noExeOpenLogPanel);
    root.querySelector(".noexe-mask").addEventListener("click", function(event) {
        if (event.target.classList.contains("noexe-mask")) noExeCloseUi();
    });
    root.querySelector(".noexe-log-mask").addEventListener("click", function(event) {
        if (event.target.classList.contains("noexe-log-mask")) noExeCloseLogPanel();
    });
    root.addEventListener("click", noExeHandleClick);
    root.addEventListener("click", noExeHandleLogClick);
    root.addEventListener("change", noExeHandleChange);
    root.addEventListener("input", noExeHandleInput);
    window.addEventListener(NOEXE_UI_OPEN_EVENT, noExeOpenUi);
    window.addEventListener(NOEXE_LOG_OPEN_EVENT, noExeOpenLogPanel);
    window.addEventListener(NOEXE_LOG_EVENT, noExeReceiveLogEvent);
}

async function openNoExeConfigPanel() {
    ensureNoExeConfigButton();
    window.dispatchEvent(new CustomEvent(NOEXE_UI_OPEN_EVENT));
}

async function noExeOpenUi() {
    ensureNoExeConfigButton();
    if (!noExeUiContext) return;
    noExeUiContext.config = await loadNoExeConfig();
    noExeUiContext.root.querySelector(".noexe-mask").hidden = false;
    noExeRenderPanel();
}

function noExeCloseUi() {
    if (!noExeUiContext) return;
    noExeUiContext.root.querySelector(".noexe-mask").hidden = true;
}

function noExeRenderPanel() {
    const context = noExeUiContext;
    const config = normalizeNoExeConfig(context.config || cloneNoExe(NOEXE_DEFAULT_CONFIG));
    context.config = config;
    const bodyHtml = context.state.tab === "malls"
        ? renderNoExeMalls(config)
        : context.state.tab === "prices"
            ? renderNoExePrices(config)
            : renderNoExeAdvanced(config);

    context.root.querySelector(".noexe-panel-content").innerHTML = `
        <div class="noexe-head">
            <div>
                <div class="noexe-title">自改版配置</div>
                <div class="noexe-subtitle">配置保存在脚本存储里，不依赖下载器 EXE</div>
            </div>
            <button class="noexe-icon-btn" type="button" data-action="close">×</button>
        </div>
        <div class="noexe-tabs">
            ${renderNoExeTab("prices", "阶梯核价")}
            ${renderNoExeTab("advanced", "导入导出")}
            ${renderNoExeTab("malls", "店铺")}
        </div>
        <div class="noexe-body">${bodyHtml}</div>
        <div class="noexe-footer">
            <span class="noexe-status">${escapeNoExe(context.state.status || "未修改")}</span>
            <button class="noexe-btn secondary" type="button" data-action="close">关闭</button>
        </div>
    `;
}

function renderNoExeTab(tab, label) {
    return `<button class="noexe-tab ${noExeUiContext.state.tab === tab ? "is-active" : ""}" type="button" data-action="switch-tab" data-tab="${tab}">${label}</button>`;
}

function renderNoExeMalls(config) {
    const currentMallId = localStorage.getItem("agentseller-mall-info-id") || "";
    const duplicates = getNoExeDuplicateMallIds(config.malls);
    const rows = config.malls.map(function(mall, index) {
        const mallId = mall.mallId === undefined || mall.mallId === null ? "" : String(mall.mallId);
        const multiple = config.priceReviewConfig.priceMultiple && config.priceReviewConfig.priceMultiple[mallId] !== undefined
            ? config.priceReviewConfig.priceMultiple[mallId]
            : "";
        return `
            <tr>
                <td><input class="noexe-input ${duplicates.has(mallId) ? "is-error" : ""}" data-change="mall-id" data-index="${index}" value="${escapeNoExeAttr(mallId)}" placeholder="mallId"></td>
                <td><input class="noexe-input" data-change="mall-name" data-index="${index}" value="${escapeNoExeAttr(mall.mallName || "")}" placeholder="店铺名"></td>
                <td>
                    <label class="noexe-switch">
                        <input type="checkbox" data-change="mall-semi" data-index="${index}" ${mall.isSemiHosted ? "checked" : ""}>
                        <span class="noexe-track"></span>
                        <span>${mall.isSemiHosted ? "半托" : "全托"}</span>
                    </label>
                </td>
                <td><input class="noexe-input" data-change="mall-multiple" data-index="${index}" value="${escapeNoExeAttr(multiple)}" placeholder="默认 1.0"></td>
                <td><button class="noexe-danger-btn" type="button" data-action="delete-mall" data-index="${index}">删除</button></td>
            </tr>
        `;
    }).join("");

    return `
        <div class="noexe-toolbar">
            <button class="noexe-btn" type="button" data-action="add-current-mall">添加当前店铺</button>
            <button class="noexe-btn secondary" type="button" data-action="add-mall">新增空店铺</button>
            <span class="noexe-note">当前页面 mallId：${escapeNoExe(currentMallId || "未读取到")}</span>
        </div>
        <div class="noexe-table-wrap">
            <table class="noexe-table">
                <thead>
                    <tr>
                        <th style="width: 210px;">mallId</th>
                        <th>店铺名</th>
                        <th style="width: 150px;">类型</th>
                        <th style="width: 150px;">价格倍率</th>
                        <th style="width: 90px;">操作</th>
                    </tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="5"><div class="noexe-empty">还没有店铺配置</div></td></tr>`}</tbody>
            </table>
        </div>
        <div class="noexe-note" style="margin-top:10px;">价格倍率留空表示 1.0；mallId 重复会标红。</div>
    `;
}

function renderNoExePrices(config) {
    const state = noExeUiContext.state;
    const groupKey = state.group || "normal";
    const group = config.priceReviewConfig[groupKey] || {};
    const search = (state.search || "").trim().toLowerCase();
    const entries = Object.entries(group).filter(function(entry) {
        return !search || entry[0].toLowerCase().indexOf(search) >= 0;
    });

    return `
        <div class="noexe-toolbar">
            ${NOEXE_PRICE_GROUPS.map(function(groupInfo) {
                return `<button class="noexe-segment ${groupKey === groupInfo.key ? "is-active" : ""}" type="button" data-action="switch-group" data-group="${groupInfo.key}">${groupInfo.label}</button>`;
            }).join("")}
            <button class="noexe-btn" type="button" data-action="add-spec">新增规格</button>
        </div>
        <div class="noexe-toolbar">
            <label style="width:170px;">
                <span class="noexe-note">最大核价次数</span>
                <input class="noexe-input" type="number" min="1" step="1" data-change="max-try" value="${escapeNoExeAttr(config.priceReviewConfig.maxTryCount || "")}" placeholder="默认 10">
            </label>
            <label style="flex:1; min-width:220px;">
                <span class="noexe-note">搜索规格</span>
                <input class="noexe-input" data-input="price-search" value="${escapeNoExeAttr(state.search || "")}" placeholder="输入颜色、尺码或关键词">
            </label>
            <span class="noexe-note">报价单位：分；每个数字是一轮报价。</span>
        </div>
        ${entries.length ? `<div class="noexe-grid">${entries.map(function(entry) {
            return renderNoExeSpecCard(entry[0], entry[1]);
        }).join("")}</div>` : `<div class="noexe-empty">当前分组没有规格，或搜索无结果。</div>`}
    `;
}

function renderNoExeSpecCard(specName, prices) {
    const key = encodeURIComponent(specName);
    const priceInputs = (prices || []).map(function(price, index) {
        return `
            <div class="noexe-price-item">
                <span class="noexe-round">${index + 1}</span>
                <input class="noexe-input" type="number" step="1" data-change="price" data-key="${key}" data-index="${index}" value="${escapeNoExeAttr(price)}">
                <button class="noexe-mini" type="button" data-action="delete-price" data-key="${key}" data-index="${index}">×</button>
            </div>
        `;
    }).join("");

    return `
        <article class="noexe-card">
            <div class="noexe-card-head">
                <input class="noexe-input" data-change="spec-name" data-key="${key}" value="${escapeNoExeAttr(specName)}" placeholder="规格名">
                <button class="noexe-danger-btn" type="button" data-action="delete-spec" data-key="${key}">删除</button>
            </div>
            <div class="noexe-price-list">
                ${priceInputs}
                <button class="noexe-mini" type="button" data-action="add-price" data-key="${key}">+ 一轮</button>
            </div>
        </article>
    `;
}

function renderNoExeAdvanced(config) {
    const exportText = JSON.stringify(config, null, 2);
    return `
        <div class="noexe-section-title">导出配置</div>
        <textarea class="noexe-textarea" readonly>${escapeNoExe(exportText)}</textarea>
        <div class="noexe-toolbar" style="margin-top:10px;">
            <button class="noexe-btn" type="button" data-action="copy-export">复制 JSON</button>
        </div>

        <div class="noexe-section-title">导入配置</div>
        <textarea class="noexe-textarea" data-input="import-json" placeholder="把导出的 JSON 粘贴到这里">${escapeNoExe(noExeUiContext.state.importText || "")}</textarea>
        <div class="noexe-toolbar" style="margin-top:10px;">
            <button class="noexe-btn" type="button" data-action="import-overwrite">覆盖导入</button>
            <button class="noexe-btn secondary" type="button" data-action="import-merge">合并导入</button>
        </div>

        <div class="noexe-section-title">危险操作</div>
        <button class="noexe-danger-btn" type="button" data-action="reset-default">重置为脚本内置配置</button>
    `;
}

async function noExeHandleClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !noExeUiContext) return;
    const action = button.dataset.action;
    const config = noExeUiContext.config;

    if (action === "close") return noExeCloseUi();
    if (action === "switch-tab") {
        noExeUiContext.state.tab = button.dataset.tab;
        noExeRenderPanel();
        return;
    }
    if (action === "switch-group") {
        noExeUiContext.state.group = button.dataset.group;
        noExeUiContext.state.search = "";
        noExeRenderPanel();
        return;
    }
    if (action === "add-mall") {
        config.malls.push({ mallId: "", mallName: "", isSemiHosted: false });
        await saveNoExeConfig(config);
        return;
    }
    if (action === "add-current-mall") {
        const currentMallId = localStorage.getItem("agentseller-mall-info-id") || "";
        if (!currentMallId) return alert("当前页面没有读取到 mallId");
        if (config.malls.some(function(mall) { return String(mall.mallId) === String(currentMallId); })) {
            return alert("当前店铺已经在配置里");
        }
        config.malls.push({ mallId: Number(currentMallId), mallName: "当前店铺", isSemiHosted: false });
        await saveNoExeConfig(config);
        return;
    }
    if (action === "delete-mall") {
        const index = Number(button.dataset.index);
        const mall = config.malls[index];
        if (!mall || !confirm("确定删除这个店铺配置？")) return;
        if (config.priceReviewConfig.priceMultiple) delete config.priceReviewConfig.priceMultiple[String(mall.mallId)];
        config.malls.splice(index, 1);
        await saveNoExeConfig(config);
        return;
    }
    if (action === "add-spec") {
        const group = config.priceReviewConfig[noExeUiContext.state.group] || {};
        const name = getNoExeUniqueSpecName(group, "新规格");
        group[name] = [0];
        config.priceReviewConfig[noExeUiContext.state.group] = group;
        noExeUiContext.state.search = "";
        await saveNoExeConfig(config);
        return;
    }
    if (action === "delete-spec") {
        const group = config.priceReviewConfig[noExeUiContext.state.group] || {};
        const key = decodeURIComponent(button.dataset.key);
        if (!confirm("确定删除规格：" + key + "？")) return;
        delete group[key];
        await saveNoExeConfig(config);
        return;
    }
    if (action === "add-price") {
        const group = config.priceReviewConfig[noExeUiContext.state.group] || {};
        const key = decodeURIComponent(button.dataset.key);
        const prices = Array.isArray(group[key]) ? group[key] : [];
        prices.push(prices.length ? prices[prices.length - 1] : 0);
        group[key] = prices;
        await saveNoExeConfig(config);
        return;
    }
    if (action === "delete-price") {
        const group = config.priceReviewConfig[noExeUiContext.state.group] || {};
        const key = decodeURIComponent(button.dataset.key);
        const index = Number(button.dataset.index);
        if (!Array.isArray(group[key])) return;
        group[key].splice(index, 1);
        await saveNoExeConfig(config);
        return;
    }
    if (action === "copy-export") {
        await copyNoExeText(JSON.stringify(config, null, 2));
        noExeUiContext.state.status = "已复制 JSON";
        noExeSetStatus(noExeUiContext.state.status);
        return;
    }
    if (action === "import-overwrite" || action === "import-merge") {
        await importNoExeConfig(action === "import-merge");
        return;
    }
    if (action === "reset-default") {
        if (!confirm("确定重置为脚本内置配置？当前修改会被覆盖。")) return;
        noExeUiContext.config = cloneNoExe(NOEXE_DEFAULT_CONFIG);
        noExeUiContext.state.importText = "";
        await saveNoExeConfig(noExeUiContext.config);
    }
}

function noExeHandleInput(event) {
    const input = event.target.closest("[data-input]");
    if (!input || !noExeUiContext) return;
    if (input.dataset.input === "import-json") {
        noExeUiContext.state.importText = input.value;
        return;
    }
    if (input.dataset.input === "price-search") {
        noExeUiContext.state.search = input.value;
        clearTimeout(noExeUiContext.searchTimer);
        noExeUiContext.searchTimer = setTimeout(noExeRenderPanel, 180);
    }
}

async function noExeHandleChange(event) {
    const input = event.target.closest("[data-change]");
    if (!input || !noExeUiContext) return;
    const config = noExeUiContext.config;
    const change = input.dataset.change;

    if (change.indexOf("mall-") === 0) {
        const index = Number(input.dataset.index);
        const mall = config.malls[index];
        if (!mall) return;

        if (change === "mall-id") {
            const oldId = String(mall.mallId || "");
            const newId = input.value.trim();
            if (newId && config.malls.some(function(item, itemIndex) {
                return itemIndex !== index && String(item.mallId) === newId;
            })) {
                alert("mallId 不能重复");
                noExeRenderPanel();
                return;
            }
            mall.mallId = /^\\d+$/.test(newId) ? Number(newId) : newId;
            if (oldId && oldId !== newId && config.priceReviewConfig.priceMultiple && config.priceReviewConfig.priceMultiple[oldId] !== undefined) {
                config.priceReviewConfig.priceMultiple[newId] = config.priceReviewConfig.priceMultiple[oldId];
                delete config.priceReviewConfig.priceMultiple[oldId];
            }
        }
        if (change === "mall-name") mall.mallName = input.value.trim();
        if (change === "mall-semi") mall.isSemiHosted = input.checked;
        if (change === "mall-multiple") {
            const mallId = String(mall.mallId || "");
            if (!mallId) return alert("请先填写 mallId");
            const value = input.value.trim();
            if (!value) delete config.priceReviewConfig.priceMultiple[mallId];
            else {
                const numberValue = Number(value);
                if (!Number.isFinite(numberValue) || numberValue <= 0) {
                    alert("价格倍率必须是大于 0 的数字");
                    noExeRenderPanel();
                    return;
                }
                config.priceReviewConfig.priceMultiple[mallId] = numberValue;
            }
        }
        await saveNoExeConfig(config);
        return;
    }

    if (change === "max-try") {
        const value = Number(input.value);
        if (!input.value.trim()) delete config.priceReviewConfig.maxTryCount;
        else if (Number.isInteger(value) && value > 0) config.priceReviewConfig.maxTryCount = value;
        else {
            alert("最大核价次数必须是正整数");
            noExeRenderPanel();
            return;
        }
        await saveNoExeConfig(config);
        return;
    }

    const group = config.priceReviewConfig[noExeUiContext.state.group] || {};
    if (change === "spec-name") {
        const oldKey = decodeURIComponent(input.dataset.key);
        const newKey = input.value.trim();
        if (!newKey) {
            alert("规格名不能为空");
            noExeRenderPanel();
            return;
        }
        if (newKey !== oldKey && Object.prototype.hasOwnProperty.call(group, newKey)) {
            alert("规格名已经存在");
            noExeRenderPanel();
            return;
        }
        renameNoExeSpec(group, oldKey, newKey);
        await saveNoExeConfig(config);
        return;
    }

    if (change === "price") {
        const key = decodeURIComponent(input.dataset.key);
        const index = Number(input.dataset.index);
        const value = Number(input.value);
        if (!Number.isFinite(value) || !Number.isInteger(value)) {
            alert("报价必须是整数，单位是分");
            noExeRenderPanel();
            return;
        }
        if (!Array.isArray(group[key])) group[key] = [];
        group[key][index] = value;
        await saveNoExeConfig(config, false);
    }
}

async function importNoExeConfig(shouldMerge) {
    const text = (noExeUiContext.state.importText || "").trim();
    if (!text) return alert("请先粘贴配置 JSON");
    try {
        const imported = normalizeNoExeConfig(JSON.parse(text));
        noExeUiContext.config = shouldMerge ? mergeNoExeConfig(noExeUiContext.config, imported) : imported;
        noExeUiContext.state.importText = "";
        await saveNoExeConfig(noExeUiContext.config);
    } catch (e) {
        alert("导入失败：" + e.message);
    }
}

function mergeNoExeConfig(base, imported) {
    const next = normalizeNoExeConfig(cloneNoExe(base || NOEXE_DEFAULT_CONFIG));
    imported.malls.forEach(function(importedMall) {
        const index = next.malls.findIndex(function(mall) {
            return String(mall.mallId) === String(importedMall.mallId);
        });
        if (index >= 0) next.malls[index] = importedMall;
        else next.malls.push(importedMall);
    });
    NOEXE_PRICE_GROUPS.forEach(function(group) {
        next.priceReviewConfig[group.key] = Object.assign({}, next.priceReviewConfig[group.key] || {}, imported.priceReviewConfig[group.key] || {});
    });
    next.priceReviewConfig.priceMultiple = Object.assign({}, next.priceReviewConfig.priceMultiple || {}, imported.priceReviewConfig.priceMultiple || {});
    if (imported.priceReviewConfig.maxTryCount) next.priceReviewConfig.maxTryCount = imported.priceReviewConfig.maxTryCount;
    return normalizeNoExeConfig(next);
}

function renameNoExeSpec(group, oldKey, newKey) {
    const next = {};
    Object.keys(group).forEach(function(key) {
        next[key === oldKey ? newKey : key] = group[key];
    });
    Object.keys(group).forEach(function(key) { delete group[key]; });
    Object.assign(group, next);
}

function getNoExeUniqueSpecName(group, baseName) {
    let name = baseName;
    let index = 2;
    while (Object.prototype.hasOwnProperty.call(group, name)) {
        name = baseName + index;
        index += 1;
    }
    return name;
}

function getNoExeDuplicateMallIds(malls) {
    const seen = new Set();
    const duplicates = new Set();
    malls.forEach(function(mall) {
        const mallId = String(mall.mallId || "");
        if (!mallId) return;
        if (seen.has(mallId)) duplicates.add(mallId);
        seen.add(mallId);
    });
    return duplicates;
}

function noExeSetStatus(text) {
    if (!noExeUiContext) return;
    const status = noExeUiContext.root.querySelector(".noexe-status");
    if (status) status.textContent = text;
}

async function copyNoExeText(text) {
    try {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text, "text");
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch (e) {
        noExeBusinessLog("复制配置失败，使用弹窗兜底", e);
    }
    prompt("复制配置 JSON", text);
}

function escapeNoExe(value) {
    return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, function(char) {
        return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char];
    });
}

function escapeNoExeAttr(value) {
    return escapeNoExe(value).replace(/`/g, "&#96;");
}


function noExeLogStart(url) {
    const id = Date.now() + "-" + (++noExeLogCounter) + "-" + Math.random().toString(16).slice(2);
    const now = Date.now();
    noExeEmitLog({
        phase: "start",
        id,
        url,
        endpoint: noExeEndpointName(url),
        endpointTitle: noExeEndpointTitle(url),
        time: now
    });
    return {
        id,
        url,
        startedAt: typeof performance !== "undefined" ? performance.now() : now
    };
}

function noExeLogFinish(token, type, message, data) {
    const now = Date.now();
    const endedAt = typeof performance !== "undefined" ? performance.now() : now;
    noExeEmitLog({
        phase: "finish",
        id: token.id,
        url: token.url,
        endpoint: noExeEndpointName(token.url),
        endpointTitle: noExeEndpointTitle(token.url),
        type,
        message: message || "",
        time: now,
        duration: Math.max(0, Math.round(endedAt - token.startedAt)),
        data
    });
}

function noExeEmitLog(detail) {
    try {
        window.dispatchEvent(new CustomEvent(NOEXE_LOG_EVENT, {
            detail: Object.assign({
                scriptName: NOEXE_SCRIPT_NAME
            }, detail)
        }));
    } catch (e) {
        noExeBusinessLog("运行日志写入失败", e);
    }
}

function noExeTrimLogEntries() {
    const keepCountByScript = {};
    noExeLogState.entries = noExeLogState.entries.filter(function(entry) {
        const scriptName = entry.scriptName || "未知脚本";
        keepCountByScript[scriptName] = keepCountByScript[scriptName] || 0;
        if (keepCountByScript[scriptName] >= NOEXE_LOG_KEEP_PER_SCRIPT) return false;
        keepCountByScript[scriptName] += 1;
        return true;
    });
}

function noExeScheduleLogRender() {
    if (!noExeIsLogPanelOpen()) return;
    if (noExeLogRenderTimer) return;
    noExeLogRenderTimer = setTimeout(function() {
        noExeLogRenderTimer = null;
        if (noExeIsLogPanelOpen()) noExeRenderLogPanel();
    }, NOEXE_LOG_RENDER_DEBOUNCE_MS);
}

function noExeShortLogMessage(message) {
    const text = String(message || "");
    if (text.length <= NOEXE_LOG_MESSAGE_PREVIEW_LENGTH) return text;
    return text.slice(0, NOEXE_LOG_MESSAGE_PREVIEW_LENGTH) + "\n...已截断显示，复制日志可查看完整内容";
}

function noExeReceiveLogEvent(event) {
    if (!noExeLogState || !event || !event.detail) return;
    const detail = event.detail;
    if (detail.phase === "detail") {
        noExeLogState.stats.detail += 1;
        noExeLogState.entries.unshift({
            time: detail.time || Date.now(),
            type: detail.type || "detail",
            scriptName: detail.scriptName || "",
            endpoint: detail.endpoint || "业务明细",
            endpointTitle: detail.endpointTitle || "业务明细",
            message: detail.message || "",
            duration: detail.duration || 0,
            source: detail.source || ""
        });
        noExeTrimLogEntries();
        noExeScheduleLogRender();
        return;
    }

    if (detail.phase === "start") {
        noExeLogState.stats.total += 1;
        noExeLogState.stats.inFlight += 1;
        noExeLogState.active[detail.id] = detail;
        noExeUpdateLogBadge();
        noExeScheduleLogRender();
        return;
    }

    if (detail.phase !== "finish") return;
    if (noExeLogState.stats.inFlight > 0) noExeLogState.stats.inFlight -= 1;
    delete noExeLogState.active[detail.id];

    if (detail.type === "success") noExeLogState.stats.success += 1;
    else if (detail.type === "fail") noExeLogState.stats.fail += 1;
    else noExeLogState.stats.apiError += 1;

    noExeLogState.entries.unshift({
        time: detail.time || Date.now(),
        type: detail.type || "error",
        scriptName: detail.scriptName || "",
        endpoint: detail.endpoint || noExeEndpointName(detail.url || ""),
        endpointTitle: detail.endpointTitle || noExeEndpointTitle(detail.url || ""),
        message: detail.message || "",
        duration: detail.duration || 0,
        source: detail.source || ""
    });
    noExeTrimLogEntries();
    noExeUpdateLogBadge();
    noExeScheduleLogRender();
}

function noExeEndpointName(url) {
    try {
        const parsed = new URL(url, location.href);
        return parsed.pathname;
    } catch (e) {
        return String(url || "");
    }
}

function noExeEndpointTitle(url) {
    const path = noExeEndpointName(url);
    if (path.indexOf("/searchForChainSupplier") >= 0) return "查询全托待确认商品信息";
    if (path.indexOf("/searchForSemiSupplier") >= 0) return "查询半托待确认商品信息";
    if (path.indexOf("/batch/info/query") >= 0) return "查询半托核价订单详情";
    if (path.indexOf("/bargain-no-bom/batch") >= 0) return "提交半托核价";
    if (path.indexOf("/re-price-review/click") >= 0) return "提交全托核价确认";
    if (path.indexOf("/batchOpenJit") >= 0) return "批量开通 JIT";
    if (path.indexOf("/goods/batchSupplierConfirm") >= 0) return "批量确认商品信息";
    if (path.indexOf("/audit/edit/task/product/pageQuery") >= 0) return "查询标题修改任务";
    if (path.indexOf("/audit/edit/task/product/batchAdd") >= 0) return "创建标题修改任务";
    if (path.indexOf("/product/edit/task/reply") >= 0) return "提交标题修改";
    if (path.indexOf("/product/skc/pageQuery") >= 0) return "查询库存商品列表";
    if (path.indexOf("/queryBtgProductStockInfo") >= 0) return "查询半托库存";
    if (path.indexOf("/updateMmsBtgProductSalesStock") >= 0) return "更新半托库存";
    if (path.indexOf("/updateMmsSkuSalesStock") >= 0) return "更新全托库存";
    return "TEMU 接口请求";
}

function noExeIsLogPanelOpen() {
    return !!(noExeUiContext && noExeUiContext.root && noExeUiContext.root.querySelector(".noexe-log-mask") && !noExeUiContext.root.querySelector(".noexe-log-mask").hidden);
}

function noExeOpenLogPanel() {
    ensureNoExeConfigButton();
    if (!noExeUiContext) {
        window.dispatchEvent(new CustomEvent(NOEXE_LOG_OPEN_EVENT));
        return;
    }
    noExeUiContext.root.querySelector(".noexe-log-mask").hidden = false;
    noExeRenderLogPanel();
}

function noExeCloseLogPanel() {
    if (!noExeUiContext) return;
    const mask = noExeUiContext.root.querySelector(".noexe-log-mask");
    if (mask) mask.hidden = true;
}

function noExeGetLogFilter(filterKey) {
    return NOEXE_LOG_SCRIPT_FILTERS.find(function(item) {
        return item.key === filterKey;
    }) || NOEXE_LOG_SCRIPT_FILTERS[0];
}

function noExeEntryMatchesLogFilter(entry, filterKey) {
    const filter = noExeGetLogFilter(filterKey || noExeLogState.filter || "all");
    if (!filter.match) return true;
    return String(entry && entry.scriptName || "").indexOf(filter.match) >= 0;
}

function noExeGetFilteredLogEntries() {
    const filterKey = noExeLogState.filter || "all";
    return noExeLogState.entries.filter(function(entry) {
        return noExeEntryMatchesLogFilter(entry, filterKey);
    });
}

function noExeGetFilteredActiveLogs() {
    const filterKey = noExeLogState.filter || "all";
    return Object.values(noExeLogState.active).filter(function(entry) {
        return noExeEntryMatchesLogFilter(entry, filterKey);
    });
}

function noExeGetLogStatsForFilter(entries, activeList) {
    if ((noExeLogState.filter || "all") === "all") {
        return Object.assign({}, noExeLogState.stats, {
            inFlight: noExeLogState.stats.inFlight || activeList.length
        });
    }

    const stats = { total: activeList.length, success: 0, fail: 0, apiError: 0, inFlight: activeList.length, detail: 0 };
    entries.forEach(function(entry) {
        if (entry.type === "success") {
            stats.success += 1;
            stats.total += 1;
        } else if (entry.type === "fail") {
            stats.fail += 1;
            stats.total += 1;
        } else if (entry.type === "detail" || entry.type === "detail-error") {
            stats.detail += 1;
        } else {
            stats.apiError += 1;
            stats.total += 1;
        }
    });
    return stats;
}

function noExeRenderLogFilters() {
    const current = noExeLogState.filter || "all";
    return NOEXE_LOG_SCRIPT_FILTERS.map(function(item) {
        const count = item.key === "all" ? noExeLogState.entries.length : noExeLogState.entries.filter(function(entry) {
            return noExeEntryMatchesLogFilter(entry, item.key);
        }).length;
        return `<button class="noexe-segment ${item.key === current ? "is-active" : ""}" type="button" data-log-filter="${escapeNoExeAttr(item.key)}">${escapeNoExe(item.label)}${count ? " " + escapeNoExe(count) : ""}</button>`;
    }).join("");
}
function noExeRenderLogPanel() {
    if (!noExeUiContext) return;
    const allEntries = noExeGetFilteredLogEntries();
    const entries = allEntries.slice(0, NOEXE_LOG_RENDER_LIMIT);
    const activeList = noExeGetFilteredActiveLogs();
    const stats = noExeGetLogStatsForFilter(allEntries, activeList);
    const selectedFilter = noExeGetLogFilter(noExeLogState.filter || "all");
    const limitNote = allEntries.length > entries.length ? `当前只显示最近 ${entries.length}/${allEntries.length} 条，复制日志包含当前筛选全部日志。` : `当前显示 ${entries.length}/${allEntries.length} 条。`;
    const content = noExeUiContext.root.querySelector(".noexe-log-content");
    if (!content) return;

    content.innerHTML = `
        <div class="noexe-head">
            <div>
                <div class="noexe-title">运行日志</div>
                <div class="noexe-subtitle">当前筛选：${escapeNoExe(selectedFilter.label)}；请求成功只代表 TEMU 接口正常返回，不等于整批任务全部完成</div>
            </div>
            <button class="noexe-icon-btn" type="button" data-log-action="close">×</button>
        </div>
        <div class="noexe-body">
            <div class="noexe-stat-grid">
                ${noExeRenderStat("处理数量", stats.total)}
                ${noExeRenderStat("请求成功", stats.success)}
                ${noExeRenderStat("业务失败", stats.fail)}
                ${noExeRenderStat("接口异常", stats.apiError)}
                ${noExeRenderStat("业务明细", stats.detail || 0)}
                ${noExeRenderStat("进行中", stats.inFlight || activeList.length)}
            </div>
            <div class="noexe-toolbar">
                ${noExeRenderLogFilters()}
            </div>
            <div class="noexe-toolbar">
                <button class="noexe-btn" type="button" data-log-action="copy">复制当前筛选日志</button>
                <button class="noexe-btn secondary" type="button" data-log-action="clear">清空日志</button>
                <span class="noexe-note">${escapeNoExe(limitNote)} 请求成功=接口正常返回；业务失败=返回 success=false；接口异常=网络/HTTP/JSON 异常；业务明细=脚本控制台明细输出，尽量按控制台原内容保留。</span>
            </div>
            ${entries.length ? `<div class="noexe-log-list">${entries.map(noExeRenderLogEntry).join("")}</div>` : `<div class="noexe-empty">当前筛选还没有运行日志。</div>`}
        </div>
        <div class="noexe-footer">
            <span class="noexe-status">最后更新：${escapeNoExe(new Date().toLocaleTimeString())}</span>
            <button class="noexe-btn secondary" type="button" data-log-action="close">关闭</button>
        </div>
    `;
}
function noExeRenderStat(label, value) {
    return `
        <div class="noexe-stat">
            <div class="noexe-stat-label">${escapeNoExe(label)}</div>
            <div class="noexe-stat-value">${escapeNoExe(value)}</div>
        </div>
    `;
}

function noExeRenderLogEntry(entry) {
    const label = entry.type === "success" ? "请求成功" : entry.type === "fail" ? "业务失败" : entry.type === "detail" ? "业务明细" : entry.type === "detail-error" ? "业务异常" : "接口异常";
    const message = noExeShortLogMessage(entry.message);
    return `
        <div class="noexe-log-item ${escapeNoExeAttr(entry.type)}">
            <div class="noexe-log-line">
                <span>${escapeNoExe(label)} · ${escapeNoExe(entry.endpointTitle || entry.endpoint)} · ${escapeNoExe(entry.scriptName)}</span>
                <span>${escapeNoExe(new Date(entry.time).toLocaleTimeString())} / ${escapeNoExe(entry.duration)}ms</span>
            </div>
            <div class="noexe-log-meta">${escapeNoExe(entry.endpoint)}${entry.source ? ` · ${escapeNoExe(entry.source)}` : ""}</div>
            ${message ? `<div class="noexe-log-message">${escapeNoExe(message)}</div>` : ""}
        </div>
    `;
}

function noExeHandleLogClick(event) {
    const filterButton = event.target.closest("[data-log-filter]");
    if (filterButton) {
        noExeLogState.filter = filterButton.dataset.logFilter || "all";
        noExeRenderLogPanel();
        return;
    }

    const button = event.target.closest("[data-log-action]");
    if (!button) return;
    const action = button.dataset.logAction;
    if (action === "close") return noExeCloseLogPanel();
    if (action === "copy") {
        copyNoExeText(noExeBuildLogText());
        return;
    }
    if (action === "clear") {
        noExeLogState.stats = { total: 0, success: 0, fail: 0, apiError: 0, inFlight: 0, detail: 0 };
        noExeLogState.active = {};
        noExeLogState.entries = [];
        noExeUpdateLogBadge();
        noExeRenderLogPanel();
    }
}
function noExeBuildLogText() {
    const entries = noExeGetFilteredLogEntries();
    const activeList = noExeGetFilteredActiveLogs();
    const stats = noExeGetLogStatsForFilter(entries, activeList);
    const selectedFilter = noExeGetLogFilter(noExeLogState.filter || "all");
    const header = `筛选:${selectedFilter.label} 处理数量:${stats.total} 请求成功:${stats.success} 业务失败:${stats.fail} 接口异常:${stats.apiError} 业务明细:${stats.detail || 0} 进行中:${stats.inFlight}`;
    const lines = entries.map(function(entry) {
        const label = entry.type === "success" ? "请求成功" : entry.type === "fail" ? "业务失败" : entry.type === "detail" ? "业务明细" : entry.type === "detail-error" ? "业务异常" : "接口异常";
        return `[${new Date(entry.time).toLocaleString()}] [${label}] [${entry.scriptName}] [${entry.endpointTitle || entry.endpoint}] ${entry.endpoint} ${entry.duration}ms ${entry.message || ""}`;
    });
    return [header].concat(lines).join("\n");
}
function noExeUpdateLogBadge() {
    if (!noExeUiContext || !noExeUiContext.root) return;
    const button = noExeUiContext.root.querySelector(".noexe-log-fab");
    if (!button) return;
    const badCount = noExeLogState.stats.fail + noExeLogState.stats.apiError;
    const inFlight = noExeLogState.stats.inFlight;
    button.textContent = badCount ? `运行日志 ${badCount}` : inFlight ? `运行日志 · ${inFlight}` : "运行日志";
    button.classList.toggle("has-error", badCount > 0);
}

function noExeResultMessage(data) {
    if (!data || typeof data !== "object") return "";
    return data.errorMsg || data.msg || data.message || data.error || data.resultMsg || "";
}

function noExeRequestSummary(data) {
    if (!data || typeof data !== "object") return "";
    const parts = [];
    if (data.page !== undefined) parts.push("page=" + data.page);
    if (data.pageSize !== undefined) parts.push("pageSize=" + data.pageSize);
    if (Array.isArray(data.orderIds)) parts.push("orderIds=" + data.orderIds.length);
    if (Array.isArray(data.itemRequests)) parts.push("itemRequests=" + data.itemRequests.length);
    if (Array.isArray(data.productSkcSubSellModeReqList)) parts.push("SKC=" + data.productSkcSubSellModeReqList.length);
    if (Array.isArray(data.supplierConfirmReqList)) parts.push("确认商品=" + data.supplierConfirmReqList.length);
    if (Array.isArray(data.productIdList)) parts.push("商品=" + data.productIdList.length);
    if (Array.isArray(data.bizIds)) parts.push("业务ID=" + data.bizIds.length);
    if (Array.isArray(data.productEditItems)) parts.push("修改项=" + data.productEditItems.length);
    if (Array.isArray(data.productSkuIdList)) parts.push("SKU=" + data.productSkuIdList.length);
    if (Array.isArray(data.skuStockChangeList)) parts.push("实物库存SKU=" + data.skuStockChangeList.length);
    if (Array.isArray(data.skuVirtualStockChangeList)) parts.push("虚拟库存SKU=" + data.skuVirtualStockChangeList.length);
    return parts.length ? "请求：" + parts.join("，") : "";
}

function noExeResponseSummary(result) {
    if (!result || typeof result !== "object") return "";
    const parts = [];
    if (result.success !== undefined) parts.push("success=" + result.success);
    const target = result.result && typeof result.result === "object" ? result.result : result;
    ["total", "totalCount", "count"].forEach(function(key) {
        if (target[key] !== undefined) parts.push(key + "=" + target[key]);
    });
    [
        ["dataList", "dataList"],
        ["pageItems", "pageItems"],
        ["priceReviewItemList", "核价订单"],
        ["productStockList", "库存SKU"],
        ["addFailedList", "创建失败"],
        ["supplierConfirmResultList", "确认结果"]
    ].forEach(function(item) {
        const value = target[item[0]];
        if (Array.isArray(value)) parts.push(item[1] + "=" + value.length);
    });
    const msg = noExeResultMessage(result);
    if (msg) parts.push("消息=" + msg);
    return parts.length ? "返回：" + parts.join("，") : "";
}

function noExeLogMessageFor(url, status, requestData, result, fallbackMessage) {
    const parts = [noExeEndpointTitle(url), "HTTP " + status, noExeRequestSummary(requestData), noExeResponseSummary(result), fallbackMessage || ""];
    return parts.filter(Boolean).join("；");
}

function noExeBusinessLog() {
    noExeOriginalConsoleLog.apply(console, arguments);
    try {
        noExeCaptureBusinessLog(Array.prototype.slice.call(arguments));
    } catch (e) {
        noExeOriginalConsoleLog("业务明细日志捕获失败", e);
    }
}

function noExeCaptureBusinessLog(args) {
    const text = noExeFormatBusinessLogArgs(args);
    if (!text || !noExeShouldCaptureBusinessLog(text)) return;

    noExeEmitLog({
        phase: "detail",
        type: noExeBusinessLogType(text),
        endpointTitle: noExeBusinessLogTitle(text),
        endpoint: "业务明细",
        message: text,
        source: noExeGetBusinessLogSource(),
        time: Date.now(),
        duration: 0
    });
}

function noExeFormatBusinessLogArgs(args) {
    return args.map(function(item) {
        if (item === undefined) return "undefined";
        if (item === null) return "null";
        if (typeof item === "string") return item;
        if (typeof item === "number" || typeof item === "boolean") return String(item);
        if (item instanceof Error) return item.stack || item.message || String(item);
        try {
            return JSON.stringify(item, null, 2);
        } catch (e) {
            return String(item);
        }
    }).join(" ").trim();
}

function noExeGetBusinessLogSource() {
    try {
        const stack = new Error().stack || "";
        const lines = stack.split("\n").map(function(line) {
            return line.trim();
        }).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("noExeGetBusinessLogSource") >= 0) continue;
            if (lines[i].indexOf("noExeCaptureBusinessLog") >= 0) continue;
            if (lines[i].indexOf("noExeBusinessLog") >= 0) continue;
            if (lines[i].indexOf("Error") === 0) continue;
            return lines[i].replace(/^at\s+/, "");
        }
    } catch (e) {}
    return "";
}

function noExeShouldCaptureBusinessLog(text) {
    if (/^自改版配置解析失败|^读取自改版配置失败|^保存自改版配置失败|^复制配置失败|^运行日志写入失败|^业务明细日志捕获失败/.test(text)) return false;
    return true;
}
function noExeBusinessLogType(text) {
    if (/失败|错误|不可|不支持|缺少|太低|异常|error|success=false|作废/i.test(text)) return "detail-error";
    return "detail";
}

function noExeBusinessLogTitle(text) {
    if (text.indexOf("缺少价格设置") >= 0) return "缺少价格设置";
    if (text.indexOf("核价太低SKU") >= 0) return "核价太低";
    if (text.indexOf("核价排队中") >= 0) return "核价排队";
    if (text.indexOf("标题") >= 0) return "标题修改";
    if (text.indexOf("确认商品信息") >= 0 || text.indexOf("商品信息") >= 0) return "确认商品信息";
    if (text.indexOf("库存") >= 0) return "库存明细";
    if (text.indexOf("JIT") >= 0) return "JIT 明细";
    if (text.indexOf("半托管") >= 0) return "店铺类型提示";
    return "业务明细";
}

async function postTemu(url, data) {
    const logToken = noExeLogStart(url);
    let logFinished = false;
    function finishLog(type, message) {
        if (logFinished) return;
        logFinished = true;
        noExeLogFinish(logToken, type, message);
    }

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/json",
                "mallid": mallId
            },
            body: JSON.stringify(data)
        });

        let result;
        try {
            result = await res.json();
        } catch (e) {
            finishLog("error", noExeEndpointTitle(url) + "；HTTP " + res.status + "；响应 JSON 解析失败：" + e.message);
            throw e;
        }

        const message = noExeLogMessageFor(url, res.status, data, result, "");
        if (!res.ok) {
            finishLog("error", message);
        } else if (result && result.success === false) {
            finishLog("fail", message || "接口返回 success=false");
        } else {
            finishLog("success", message);
        }
        return result;
    } catch (e) {
        finishLog("error", noExeEndpointTitle(url) + "；" + (e && e.message ? e.message : String(e)));
        throw e;
    }
}

registerNoExeConfigMenu();
ensureNoExeConfigButton();

(async function () {
    'use strict';
    const mallId = localStorage.getItem('agentseller-mall-info-id');
    window.mallId = mallId;

    if (!mallId) {
        noExeBusinessLog('没有读取到当前店铺 mallId，确认商品信息已停止');
        return;
    }

    const skeyInfo = await getSkey(mallId);
    if (!skeyInfo) {
        noExeBusinessLog('没有找到自改版店铺配置，确认商品信息已停止', mallId);
        return;
    }

    const isSemiHosted = skeyInfo.isSemiHosted;
    noExeBusinessLog('确认商品信息启动，店铺', mallId, isSemiHosted ? '半托管' : '全托管');

    // 创建按钮元素
    let button = document.createElement('button');
    button.textContent = '4、确认商品信息';
    button.style = 'z-index:9999;position: absolute;top: 300px;left: 260px;background-color: pink;border: 0px;cursor: pointer;padding:10px;';

    // 将按钮添加到容器中
    document.body.appendChild(button);

    const TOPCOUNT = 5000;
    let pageSize = 100;
    let isReturn = true;

    let count = 0;
    let page = 1;
    let total = 100;

    let supplierConfirmReqList = [];

    setTimeout(function () {
        button.click();
    }, 5000);

    let intervalId;
    button.addEventListener('click', async function () {
        page = 1;
        total = 100;
        count = 0;
        supplierConfirmReqList = [];

        button.textContent = '4、确认商品信息(0/0/0)';
        noExeBusinessLog('确认商品信息开始扫描');

        if (!intervalId) {
            intervalId = setInterval(timerFun, 1000 * 1.5);
            await timerFun();
        }
    });

    async function timerFun() {
        if (!(isReturn && total > pageSize * (page - 1) && pageSize * (page - 1) < TOPCOUNT)) return;

        isReturn = false;
        try {
            let searchBody = {
                removeStatus: 0,
                supplierTodoTypeList: [6],
                pageNum: page,
                pageSize: pageSize
            };
            let serverData;
            if (isSemiHosted) {
                serverData = await postTemu('https://agentseller.temu.com/api/kiana/mms/robin/searchForSemiSupplier', searchBody);
            } else {
                serverData = await postTemu('https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier', searchBody);
            }

            if (!serverData || !serverData.success) {
                noExeBusinessLog('确认商品信息查询失败', serverData && (serverData.errorMsg || serverData.msg || serverData.message));
                return;
            }

            const result = serverData.result || {};
            const dataList = Array.isArray(result.dataList) ? result.dataList : [];
            total = Number(result.total || 0);
            page++;

            count += dataList.length;
            button.textContent = '4、确认商品信息(0/' + count + '/' + total + ')';
            noExeBusinessLog('确认商品信息查询到商品', '本页', dataList.length, '累计', count, '总数', total);

            for (let i = 0; i < dataList.length; i++) {
                let data = dataList[i];

                supplierConfirmReqList.push({
                    goodsId: data.goodsId
                });

                let productId = data.productId;
                let productName = data.productName || '';
                let isStatus2Exist = false;
                let isStatus3Exist = false;
                let skcCount = 1;

                const skcList = Array.isArray(data.skcList) ? data.skcList : [];
                for (let j = 0; j < skcList.length; j++) {
                    let skc = skcList[j];
                    const reviewList = Array.isArray(skc.supplierPriceReviewInfoList) ? skc.supplierPriceReviewInfoList : [];

                    for (let k = 0; k < reviewList.length; k++) {
                        let supplierPriceReview = reviewList[k];
                        const skuList = Array.isArray(supplierPriceReview.productSkuList) ? supplierPriceReview.productSkuList : [];
                        const propertyList = skuList[0] && Array.isArray(skuList[0].productPropertyList) ? skuList[0].productPropertyList : [];
                        let specification = getPropertyFromList(propertyList);

                        if (supplierPriceReview.status == 2) {
                            isStatus2Exist = true;
                            if (specification.indexOf('2pc') > 0) {
                                skcCount = 2;
                            }
                        }
                        if (supplierPriceReview.status == 3) {
                            isStatus3Exist = true;
                            if (specification.indexOf('2pc') > 0) {
                                skcCount = 2;
                            }
                        }
                    }
                }

                if ((productName.indexOf('1pc') > 0 && productName.indexOf('2pc') > 0) || productName.indexOf('1/2pc') > 0) {
                    // 多 SKU 核价后有的通过、有的不通过时，标题需要与保留 SKU 保持一致。
                    if (isStatus2Exist && isStatus3Exist) {
                        const oldProductName = productName;
                        if (skcCount == 2) {
                            productName = productName.replace('1pc或2pc', '2pc');
                            productName = productName.replace('1/2pc', '2pc');
                        } else {
                            productName = productName.replace('1pc或2pc', '1pc');
                            productName = productName.replace('1/2pc', '1pc');
                        }

                        try {
                            noExeBusinessLog('标题需要更新', productId, oldProductName, '=>', productName);
                            await updateTitle(productId, productName, '标题有误');
                        } catch (e) {
                            noExeBusinessLog('标题更新失败', productId, e);
                        }
                    }
                }
            }

            if (supplierConfirmReqList.length > 0 && (total <= pageSize * (page - 1) || pageSize * (page - 1) >= TOPCOUNT)) {
                for (let x = 0; x < supplierConfirmReqList.length; x += 50) {
                    let subSupplierConfirmReqList = supplierConfirmReqList.slice(x, x + 50);

                    button.textContent = '4、确认商品信息(' + (x + subSupplierConfirmReqList.length) + '/' + count + '/' + total + ')';
                    noExeBusinessLog('批量确认商品信息', '进度', x + subSupplierConfirmReqList.length + '/' + count, '本批', subSupplierConfirmReqList.length);

                    let body2 = { supplierConfirmReqList: subSupplierConfirmReqList };
                    let redata2 = await postTemu('https://agentseller.temu.com/bg-brando-mms/goods/batchSupplierConfirm', body2);
                    if (!redata2 || !redata2.success) {
                        noExeBusinessLog('批量确认商品信息失败', redata2 && (redata2.errorMsg || redata2.msg || redata2.message));
                    } else {
                        noExeBusinessLog('批量确认商品信息成功', '本批', subSupplierConfirmReqList.length);
                    }
                }

                setTimeout(function () {
                    page = 1;
                    total = 100;
                    count = 0;
                    supplierConfirmReqList = [];
                }, 1000 * 60 * 3);
            }
        } catch (e) {
            noExeBusinessLog('确认商品信息执行异常', e);
        } finally {
            isReturn = true;
        }
    }

    async function updateTitle(productId, productName, reason) {
        reason = reason || '标题有误';
        let pageQueryBody = {
            page: 1,
            pageSize: 10,
            productIdList: [productId],
            editTaskAggStatuses: [2, 5, 7, 8]
        };
        let pageQueryBodyData = await postTemu('https://agentseller.temu.com/lich-mms/audit/edit/task/product/pageQuery', pageQueryBody);
        if (!pageQueryBodyData || !pageQueryBodyData.success) {
            noExeBusinessLog('查询标题修改进行中任务失败', productId, pageQueryBodyData && (pageQueryBodyData.errorMsg || pageQueryBodyData.msg || pageQueryBodyData.message));
            return;
        }
        if (pageQueryBodyData.result && pageQueryBodyData.result.total > 0) {
            noExeBusinessLog('标题修改已有进行中申请，跳过', productId);
            return;
        }

        pageQueryBody = {
            page: 1,
            pageSize: 10,
            productIdList: [productId],
            editTaskAggStatuses: [1]
        };
        pageQueryBodyData = await postTemu('https://agentseller.temu.com/lich-mms/audit/edit/task/product/pageQuery', pageQueryBody);
        if (!pageQueryBodyData || !pageQueryBodyData.success) {
            noExeBusinessLog('查询标题待修改任务失败', productId, pageQueryBodyData && (pageQueryBodyData.errorMsg || pageQueryBodyData.msg || pageQueryBodyData.message));
            return;
        }
        if (pageQueryBodyData.result && pageQueryBodyData.result.total > 0) {
            noExeBusinessLog('标题已有待修改任务，直接提交标题', productId);

            let taskUid = pageQueryBodyData.result.pageItems[0].taskUid;
            let bodyReply = {
                productId: productId,
                taskUid: taskUid,
                taskVersion: 0,
                refuseEdit: false,
                productName: productName
            };
            let replyServerData = await postTemu('https://agentseller.temu.com/visage-agent-seller/product/edit/task/reply', bodyReply);
            if (!replyServerData || !replyServerData.success) {
                noExeBusinessLog('提交标题修改失败', productId, replyServerData && (replyServerData.errorMsg || replyServerData.msg || replyServerData.message));
            } else {
                noExeBusinessLog('提交标题修改成功', productId);
            }

            return;
        }

        let bodyBatchAdd = {
            bizIdType: 1,
            bizIds: [productId],
            productEditItems: [{
                editItem: 1,
                editAdvice: reason
            }]
        };
        let batchAddServerData = await postTemu('https://agentseller.temu.com/lich-mms/audit/edit/task/product/batchAdd', bodyBatchAdd);
        if (!batchAddServerData || !batchAddServerData.success) {
            noExeBusinessLog('创建标题修改任务失败', productId, batchAddServerData && (batchAddServerData.errorMsg || batchAddServerData.msg || batchAddServerData.message));
            return;
        }

        const result = batchAddServerData.result || {};
        const addFailedList = Array.isArray(result.addFailedList) ? result.addFailedList : [];
        if (addFailedList.length > 0) {
            noExeBusinessLog('创建标题修改任务失败', productId, addFailedList[0].failedReason || addFailedList[0].reason || '未知原因');
            return;
        }

        const successMap = result.successBizId2TaskUidMap || {};
        for (let [key, value] of Object.entries(successMap)) {
            let bodyReply = {
                productId: productId,
                taskUid: value,
                taskVersion: 0,
                refuseEdit: false,
                productName: productName
            };
            let replyServerData = await postTemu('https://agentseller.temu.com/visage-agent-seller/product/edit/task/reply', bodyReply);
            if (!replyServerData || !replyServerData.success) {
                noExeBusinessLog('提交标题修改失败', productId, replyServerData && (replyServerData.errorMsg || replyServerData.msg || replyServerData.message));
            } else {
                noExeBusinessLog('提交标题修改成功', productId, 'taskUid', value);
            }
        }
    }

    function getPropertyFromList(productPropertyList) {
        let specification = ['', '', '', ''];
        productPropertyList = Array.isArray(productPropertyList) ? productPropertyList : [];

        for (let i = 0; i < productPropertyList.length; i++) {
            if (productPropertyList[i].name == '颜色') {
                specification[0] = productPropertyList[i].value;
            } else if (productPropertyList[i].name == '型号') {
                specification[1] = productPropertyList[i].value;
            } else if (productPropertyList[i].name == '尺码') {
                specification[2] = productPropertyList[i].value;
            } else if (productPropertyList[i].name == '风格') {
                specification[3] = productPropertyList[i].value;
            }
        }
        return specification.filter(function(item) {
            return item && String(item).trim();
        }).join('-');
    }
})();

