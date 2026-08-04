// ==UserScript==
// @name         上新生命周期-6-自动实拍图 自改版可视化业务日志
// @namespace    https://www.goldabcd.com/
// @description  自动实拍图（自改版，无需下载器EXE，仅处理待传图状态1，按模板SPU类目自动提交）
// @author       TonyTonyYang
// @match        https://agentseller.temu.com/newon/product-select*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temulife6-%E8%87%AA%E5%8A%A8%E5%AE%9E%E6%8B%8D%E5%9B%BE.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temulife6-%E8%87%AA%E5%8A%A8%E5%AE%9E%E6%8B%8D%E5%9B%BE.user.js
// @version      2026.0804.1
// ==/UserScript==

const AUTO_REAL_PHOTO_CONFIG_KEY = "goldabcd_noexe_auto_real_photo_config_v1";
const AUTO_REAL_PHOTO_BACKUP_KEY = "goldabcd_noexe_auto_real_photo_config_v1_local_backup";
const AUTO_REAL_PHOTO_DEFAULT_TEMPLATE = "默认模板";
const AUTO_REAL_PHOTO_TASK_NAME = "自动商品实拍图-自改版-";
const AUTO_REAL_PHOTO_SCRIPT_NAME = "上新生命周期-6-自动实拍图 自改版可视化业务日志";
const AUTO_REAL_PHOTO_LOG_EVENT = "goldabcd-noexe-log-event";
const AUTO_REAL_PHOTO_FIRST_SCAN_DELAY_MS = 1000 * 60;
const AUTO_REAL_PHOTO_SCAN_INTERVAL_MS = 1000 * 60 * 15;
const AUTO_REAL_PHOTO_SUBMIT_INTERVAL_MS = 1000 * 2.5;
const AUTO_REAL_PHOTO_PAGE_SIZE = 50;
const AUTO_REAL_PHOTO_MAX_SCAN_COUNT = 5000;
const AUTO_REAL_PHOTO_BUTTON_TEXT = "6、自动实拍图";
const AUTO_REAL_PHOTO_DEFAULT_CONFIG = {
    version: 1,
    enabled: false,
    templateSpuMap: {
        "默认模板": ""
    },
    mallTemplateSpuMap: {}
};

const autoRealPhotoOriginalConsoleLog = console.log.bind(console);
let autoRealPhotoLogCounter = 0;
let autoRealPhotoButtonStats = {
    active: false,
    done: 0,
    pending: 0,
    total: 0
};

registerAutoRealPhotoMenus();

async function loadAutoRealPhotoConfig() {
    let raw = await getAutoRealPhotoStoredValue(AUTO_REAL_PHOTO_CONFIG_KEY, null);
    let config = raw;
    if (typeof raw === "string" && raw.trim()) {
        try {
            config = JSON.parse(raw);
        } catch (e) {
            autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "配置 JSON 解析失败，使用默认配置", e);
            config = null;
        }
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        config = cloneAutoRealPhoto(AUTO_REAL_PHOTO_DEFAULT_CONFIG);
        await saveAutoRealPhotoConfig(config);
    }
    return normalizeAutoRealPhotoConfig(config);
}

async function saveAutoRealPhotoConfig(config) {
    const normalized = normalizeAutoRealPhotoConfig(config);
    await setAutoRealPhotoStoredValue(AUTO_REAL_PHOTO_CONFIG_KEY, JSON.stringify(normalized));
    return normalized;
}

function normalizeAutoRealPhotoConfig(config) {
    const normalized = config && typeof config === "object" && !Array.isArray(config)
        ? cloneAutoRealPhoto(config)
        : cloneAutoRealPhoto(AUTO_REAL_PHOTO_DEFAULT_CONFIG);
    normalized.version = 1;
    normalized.enabled = !!normalized.enabled;
    normalized.templateSpuMap = normalizeAutoRealPhotoTemplateSpuMap(normalized.templateSpuMap || normalized.templates || {});
    normalized.mallTemplateSpuMap = normalizeAutoRealPhotoMallTemplateSpuMap(normalized.mallTemplateSpuMap || {});
    if (!Object.prototype.hasOwnProperty.call(normalized.templateSpuMap, AUTO_REAL_PHOTO_DEFAULT_TEMPLATE)) {
        normalized.templateSpuMap[AUTO_REAL_PHOTO_DEFAULT_TEMPLATE] = "";
    }
    return normalized;
}

function normalizeAutoRealPhotoMallTemplateSpuMap(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.keys(value).forEach(function(mallId) {
        const normalizedMap = normalizeAutoRealPhotoTemplateSpuMap(value[mallId]);
        if (hasAutoRealPhotoTemplateSpu(normalizedMap)) result[String(mallId)] = normalizedMap;
    });
    return result;
}

function normalizeAutoRealPhotoTemplateSpuMap(value) {
    let map = value;
    if (typeof map === "string" && map.trim()) {
        try {
            map = JSON.parse(map);
        } catch (e) {
            autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "模板SPU配置 JSON 解析失败", e);
            map = {};
        }
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
    const normalized = {};
    Object.keys(map).forEach(function(name) {
        if (name === "version" || name === "enabled" || name === "templateSpuMap" || name === "mallTemplateSpuMap") return;
        normalized[normalizeAutoRealPhotoTemplateName(name)] = String(map[name] == null ? "" : map[name]).trim();
    });
    if (!Object.prototype.hasOwnProperty.call(normalized, AUTO_REAL_PHOTO_DEFAULT_TEMPLATE)) {
        normalized[AUTO_REAL_PHOTO_DEFAULT_TEMPLATE] = "";
    }
    return normalized;
}

function normalizeAutoRealPhotoTemplateName(name) {
    return String(name == null ? "" : name).trim() || AUTO_REAL_PHOTO_DEFAULT_TEMPLATE;
}

function hasAutoRealPhotoTemplateSpu(templateSpuMap) {
    return Object.keys(templateSpuMap || {}).some(function(key) {
        return String(templateSpuMap[key] || "").trim();
    });
}

function getEffectiveAutoRealPhotoTemplateSpuMap(config, mallId) {
    const mallMap = config.mallTemplateSpuMap && config.mallTemplateSpuMap[String(mallId)];
    if (hasAutoRealPhotoTemplateSpu(mallMap)) return normalizeAutoRealPhotoTemplateSpuMap(mallMap);
    return normalizeAutoRealPhotoTemplateSpuMap(config.templateSpuMap);
}

function autoRealPhotoJsonToMap(value) {
    const objectValue = normalizeAutoRealPhotoTemplateSpuMap(value);
    const map = new Map();
    Object.keys(objectValue).forEach(function(name) {
        const spuId = String(objectValue[name] || "").trim();
        if (spuId) map.set(name, spuId);
    });
    return map;
}

async function getAutoRealPhotoStoredValue(key, fallbackValue) {
    try {
        if (typeof GM_getValue === "function") {
            const value = GM_getValue(key, fallbackValue);
            const resolved = value && typeof value.then === "function" ? await value : value;
            if (resolved !== undefined && resolved !== null && String(resolved).trim() !== "") return resolved;
        }
    } catch (e) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "读取 ScriptCat 配置失败，改用 localStorage", e);
    }
    try {
        const value = localStorage.getItem(key);
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
        const backupValue = localStorage.getItem(AUTO_REAL_PHOTO_BACKUP_KEY);
        if (backupValue !== undefined && backupValue !== null && String(backupValue).trim() !== "") return backupValue;
    } catch (e) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "读取 localStorage 配置失败", e);
    }
    return fallbackValue;
}

async function setAutoRealPhotoStoredValue(key, value) {
    try {
        localStorage.setItem(key, value);
        localStorage.setItem(AUTO_REAL_PHOTO_BACKUP_KEY, value);
    } catch (e) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "保存 localStorage 配置失败", e);
    }
    try {
        if (typeof GM_setValue === "function") {
            const result = GM_setValue(key, value);
            if (result && typeof result.then === "function") await result;
        }
    } catch (e) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "保存 ScriptCat 配置失败", e);
    }
}

function registerAutoRealPhotoMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("自动实拍图：启用/停用", async function() {
        const config = await loadAutoRealPhotoConfig();
        config.enabled = !config.enabled;
        await saveAutoRealPhotoConfig(config);
        alert(config.enabled ? "已启用自动实拍图，刷新页面后生效" : "已停用自动实拍图，刷新页面后生效");
    });
    GM_registerMenuCommand("自动实拍图：新增/修改当前店铺模板SPU", openAutoRealPhotoTemplatePrompt);
    GM_registerMenuCommand("自动实拍图：导出配置JSON", async function() {
        const config = await loadAutoRealPhotoConfig();
        await copyAutoRealPhotoText(JSON.stringify(config, null, 2));
        alert("已复制自动实拍图配置 JSON");
    });
    GM_registerMenuCommand("自动实拍图：重置当前店铺模板", async function() {
        const mallId = getCurrentAutoRealPhotoMallId();
        if (!mallId) {
            alert("当前页面没有读取到 mallId");
            return;
        }
        if (!confirm("确认重置当前店铺实拍图模板SPU配置？")) return;
        const config = await loadAutoRealPhotoConfig();
        delete config.mallTemplateSpuMap[String(mallId)];
        await saveAutoRealPhotoConfig(config);
        alert("已重置当前店铺模板，刷新页面后生效");
    });
}

async function openAutoRealPhotoTemplatePrompt() {
    const mallId = getCurrentAutoRealPhotoMallId();
    if (!mallId) {
        alert("当前页面没有读取到 mallId");
        return;
    }
    const config = await loadAutoRealPhotoConfig();
    const currentMap = getEffectiveAutoRealPhotoTemplateSpuMap(config, mallId);
    const currentName = Object.keys(currentMap).find(function(name) {
        return String(currentMap[name] || "").trim();
    }) || AUTO_REAL_PHOTO_DEFAULT_TEMPLATE;
    const nextName = prompt("请输入模板名称（仅用于备注；实际按模板SPU的TEMU类目ID匹配）。", currentName);
    if (nextName == null) return;
    const templateName = normalizeAutoRealPhotoTemplateName(nextName);
    const currentSpu = String(currentMap[templateName] || currentMap[currentName] || "").trim();
    const nextSpu = prompt("请输入已有实拍图的参考模板SPU，只填SPU数字。", currentSpu);
    if (nextSpu == null) return;
    const spuId = String(nextSpu || "").trim();
    if (!spuId) {
        alert("没有填写模板SPU");
        return;
    }
    const mallMap = normalizeAutoRealPhotoTemplateSpuMap(config.mallTemplateSpuMap[String(mallId)] || {});
    mallMap[templateName] = spuId;
    config.mallTemplateSpuMap[String(mallId)] = mallMap;
    await saveAutoRealPhotoConfig(config);
    alert("已保存当前店铺模板：" + templateName + " -> " + spuId + "，刷新页面后生效");
}

function showAutoRealPhotoSetupButton(message, mallId, mallName, config) {
    let button = document.getElementById("auto-real-photo-noexe-button");
    if (!button) {
        button = document.createElement("button");
        button.id = "auto-real-photo-noexe-button";
        button.style = "z-index:9999;position:absolute;top:380px;left:260px;background-color:pink;border:0px;cursor:pointer;padding:10px;";
        button.title = "点击配置/启停自动实拍图";
        document.body.appendChild(button);
    }
    renderAutoRealPhotoButtonText();
    button.onclick = async function() {
        const existingPanel = document.getElementById("auto-real-photo-noexe-setup");
        if (existingPanel) {
            existingPanel.remove();
            return;
        }
        const latestConfig = await loadAutoRealPhotoConfig();
        renderAutoRealPhotoSetupPanel(message, mallId || getCurrentAutoRealPhotoMallId(), mallName, latestConfig || config);
    };
}

function renderAutoRealPhotoSetupPanel(message, mallId, mallName, config) {
    const existingPanel = document.getElementById("auto-real-photo-noexe-setup");
    if (existingPanel) existingPanel.remove();

    const panel = document.createElement("div");
    panel.id = "auto-real-photo-noexe-setup";
    panel.style = "z-index:9999;position:absolute;top:422px;left:260px;width:360px;background:#fff;color:#111;border:1px solid #ff8fb3;border-radius:6px;padding:10px;font-size:13px;line-height:1.45;box-shadow:0 6px 18px rgba(0,0,0,.15);";

    const title = document.createElement("div");
    title.textContent = AUTO_REAL_PHOTO_BUTTON_TEXT;
    title.style = "font-weight:700;margin-bottom:6px;padding-right:50px;";
    panel.appendChild(title);

    const closeButton = document.createElement("button");
    closeButton.textContent = "关闭";
    closeButton.style = "position:absolute;top:8px;right:8px;background:#f3f4f6;color:#111;border:1px solid #ddd;border-radius:4px;padding:2px 8px;cursor:pointer;";
    closeButton.onclick = function() {
        panel.remove();
    };
    panel.appendChild(closeButton);

    const messageDiv = document.createElement("div");
    messageDiv.textContent = message || "先配置当前店铺已有实拍图的模板SPU，再启用自动实拍图。";
    messageDiv.style = "margin-bottom:6px;";
    panel.appendChild(messageDiv);

    const mallDiv = document.createElement("div");
    mallDiv.textContent = "当前店铺：" + (mallName || mallId || "未识别");
    mallDiv.style = "font-size:12px;margin-bottom:6px;color:#555;";
    panel.appendChild(mallDiv);

    const templateMap = getEffectiveAutoRealPhotoTemplateSpuMap(config || AUTO_REAL_PHOTO_DEFAULT_CONFIG, mallId);
    const existingName = Object.keys(templateMap).find(function(key) {
        return String(templateMap[key] || "").trim();
    }) || "";

    const nameInput = document.createElement("input");
    nameInput.placeholder = "模板名称（仅备注，例如 帽子）";
    nameInput.value = existingName;
    nameInput.style = "width:100%;height:30px;box-sizing:border-box;margin:4px 0;padding:5px 8px;border:1px solid #bbb;border-radius:4px;";
    panel.appendChild(nameInput);

    const spuInput = document.createElement("input");
    spuInput.placeholder = "已有实拍图的模板SPU，只填数字";
    const existingSpu = Object.keys(templateMap).map(function(key) {
        return templateMap[key];
    }).find(function(spuId) {
        return String(spuId || "").trim();
    });
    spuInput.value = existingSpu || "";
    spuInput.style = "width:100%;height:30px;box-sizing:border-box;margin:4px 0 6px 0;padding:5px 8px;border:1px solid #bbb;border-radius:4px;";
    panel.appendChild(spuInput);

    const matchHint = document.createElement("div");
    matchHint.textContent = "只处理待传图状态1；名称只做备注，实际按模板SPU的TEMU类目ID(cat_id)匹配。";
    matchHint.style = "font-size:12px;color:#555;margin-bottom:8px;";
    panel.appendChild(matchHint);

    const buttonRow = document.createElement("div");
    buttonRow.style = "display:flex;gap:8px;align-items:center;";

    const saveButton = document.createElement("button");
    saveButton.textContent = "保存模板";
    saveButton.style = "height:28px;background:pink;color:#111;border:0;border-radius:4px;padding:0 10px;cursor:pointer;";
    saveButton.onclick = async function() {
        const targetMallId = mallId || getCurrentAutoRealPhotoMallId();
        const templateName = normalizeAutoRealPhotoTemplateName(nameInput.value);
        const spuId = String(spuInput.value || "").trim();
        if (!targetMallId) {
            alert("当前页面没有读取到 mallId");
            return;
        }
        if (!spuId) {
            alert("请先填写模板SPU");
            return;
        }
        const nextConfig = await loadAutoRealPhotoConfig();
        const mallMap = normalizeAutoRealPhotoTemplateSpuMap(nextConfig.mallTemplateSpuMap[String(targetMallId)] || {});
        mallMap[templateName] = spuId;
        nextConfig.mallTemplateSpuMap[String(targetMallId)] = mallMap;
        await saveAutoRealPhotoConfig(nextConfig);
        alert("已保存模板，刷新页面后生效");
    };

    const enableButton = document.createElement("button");
    enableButton.textContent = config && config.enabled ? "停用自动实拍图" : "启用自动实拍图";
    enableButton.style = "height:28px;background:pink;color:#111;border:0;border-radius:4px;padding:0 10px;cursor:pointer;";
    enableButton.onclick = async function() {
        const nextConfig = await loadAutoRealPhotoConfig();
        nextConfig.enabled = !nextConfig.enabled;
        await saveAutoRealPhotoConfig(nextConfig);
        alert(nextConfig.enabled ? "已启用自动实拍图，刷新页面后生效" : "已停用自动实拍图，刷新页面后生效");
    };

    buttonRow.appendChild(saveButton);
    buttonRow.appendChild(enableButton);
    panel.appendChild(buttonRow);
    document.body.appendChild(panel);
}

function setAutoRealPhotoButtonStats(nextStats) {
    autoRealPhotoButtonStats = Object.assign({}, autoRealPhotoButtonStats, nextStats || {});
    autoRealPhotoButtonStats.done = Math.max(0, Number(autoRealPhotoButtonStats.done) || 0);
    autoRealPhotoButtonStats.pending = Math.max(0, Number(autoRealPhotoButtonStats.pending) || 0);
    autoRealPhotoButtonStats.total = Math.max(0, Number(autoRealPhotoButtonStats.total) || 0);
    renderAutoRealPhotoButtonText();
}

function resetAutoRealPhotoButtonStats(active) {
    setAutoRealPhotoButtonStats({
        active: !!active,
        done: 0,
        pending: 0,
        total: 0
    });
}

function incrementAutoRealPhotoDone(pending) {
    setAutoRealPhotoButtonStats({
        active: true,
        done: autoRealPhotoButtonStats.done + 1,
        pending
    });
}

function renderAutoRealPhotoButtonText() {
    const button = document.getElementById("auto-real-photo-noexe-button");
    if (!button) return;
    const stats = autoRealPhotoButtonStats;
    const hasNumbers = stats.active || stats.done > 0 || stats.pending > 0 || stats.total > 0;
    button.textContent = AUTO_REAL_PHOTO_BUTTON_TEXT + (hasNumbers ? "(" + stats.done + "/" + stats.pending + "/" + stats.total + ")" : "");
}

function getAutoRealPhotoTotalCount(result) {
    if (!result || typeof result !== "object") return 0;
    const keys = ["total", "totalCount", "total_count", "count"];
    for (let i = 0; i < keys.length; i++) {
        const value = Number(result[keys[i]]);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
}

async function copyAutoRealPhotoText(text) {
    try {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text);
            return;
        }
    } catch (e) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "GM_setClipboard 失败", e);
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        prompt("复制配置 JSON", text);
    }
}

async function postAutoRealPhotoTemu(url, data, requestMallId) {
    const mallId = String(requestMallId || getCurrentAutoRealPhotoMallId() || "");
    const logToken = autoRealPhotoLogStart(url, mallId);
    let logFinished = false;
    function finishLog(type, message) {
        if (logFinished) return;
        logFinished = true;
        autoRealPhotoLogFinish(logToken, type, message);
    }

    try {
        const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: {
                accept: "*/*",
                "content-type": "application/json",
                mallid: mallId
            },
            body: JSON.stringify(data || {})
        });
        let result;
        try {
            result = await res.json();
        } catch (e) {
            finishLog("error", autoRealPhotoEndpointTitle(url) + "；店铺=" + mallId + "；HTTP " + res.status + "；响应 JSON 解析失败：" + e.message);
            throw new Error("TEMU接口响应不是JSON：" + url + " HTTP " + res.status);
        }
        const message = autoRealPhotoLogMessageFor(url, res.status, data, result, mallId, "");
        if (!res.ok) {
            finishLog("error", message);
        } else if (result && result.success === false) {
            finishLog("fail", message || "接口返回 success=false");
        } else {
            finishLog("success", message);
        }
        return result;
    } catch (e) {
        finishLog("error", autoRealPhotoEndpointTitle(url) + "；店铺=" + mallId + "；" + (e && e.message ? e.message : String(e)));
        throw e;
    }
}

function autoRealPhotoLogStart(url, mallId) {
    const id = Date.now() + "-" + (++autoRealPhotoLogCounter) + "-" + Math.random().toString(16).slice(2);
    const now = Date.now();
    autoRealPhotoEmitLog({
        phase: "start",
        id,
        url,
        endpoint: autoRealPhotoEndpointName(url),
        endpointTitle: autoRealPhotoEndpointTitle(url),
        source: "mallId=" + mallId,
        time: now
    });
    return {
        id,
        url,
        mallId,
        startedAt: typeof performance !== "undefined" ? performance.now() : now
    };
}

function autoRealPhotoLogFinish(token, type, message) {
    const now = Date.now();
    const endedAt = typeof performance !== "undefined" ? performance.now() : now;
    autoRealPhotoEmitLog({
        phase: "finish",
        id: token.id,
        url: token.url,
        endpoint: autoRealPhotoEndpointName(token.url),
        endpointTitle: autoRealPhotoEndpointTitle(token.url),
        type,
        message: message || "",
        source: "mallId=" + token.mallId,
        time: now,
        duration: Math.max(0, Math.round(endedAt - token.startedAt))
    });
}

function autoRealPhotoEmitLog(detail) {
    try {
        window.dispatchEvent(new CustomEvent(AUTO_REAL_PHOTO_LOG_EVENT, {
            detail: Object.assign({
                scriptName: AUTO_REAL_PHOTO_SCRIPT_NAME
            }, detail)
        }));
    } catch (e) {
        autoRealPhotoOriginalConsoleLog(AUTO_REAL_PHOTO_TASK_NAME, "运行日志写入失败", e);
    }
}

function autoRealPhotoEndpointName(url) {
    try {
        return new URL(url, location.href).pathname;
    } catch (e) {
        return String(url || "");
    }
}

function autoRealPhotoEndpointTitle(url) {
    const path = autoRealPhotoEndpointName(url);
    if (path.indexOf("/api/seller/auth/userInfo") >= 0) return "读取店铺列表";
    if (path.indexOf("/api/flash/real_picture/list") >= 0) return "查询实拍图商品列表";
    if (path.indexOf("/searchForChainSupplier") >= 0) return "查询模板SPU类目";
    if (path.indexOf("/compliance_property/page_query") >= 0) return "查询商品合规状态";
    if (path.indexOf("/real_picture/pre_verification") >= 0) return "实拍图预校验";
    if (path.indexOf("/real_picture/upload_new") >= 0) return "提交实拍图";
    return "自动实拍图接口";
}

function autoRealPhotoResultMessage(data) {
    if (!data || typeof data !== "object") return "";
    return data.error_msg || data.errorMsg || data.msg || data.message || data.error || "";
}

function autoRealPhotoRequestSummary(data) {
    if (!data || typeof data !== "object") return "";
    const parts = [];
    if (data.page !== undefined) parts.push("page=" + data.page);
    if (data.page_num !== undefined) parts.push("page=" + data.page_num);
    if (data.page_size !== undefined) parts.push("pageSize=" + data.page_size);
    if (Array.isArray(data.spu_id_list)) parts.push("SPU=" + data.spu_id_list.join(","));
    if (Array.isArray(data.productSpuIdList)) parts.push("模板SPU=" + data.productSpuIdList.join(","));
    if (Array.isArray(data.check_type_status_list)) parts.push("实拍状态=" + data.check_type_status_list.join(","));
    if (Array.isArray(data.goods_status_list)) parts.push("商品状态=" + data.goods_status_list.join(","));
    if (Array.isArray(data.real_picture_info_list)) parts.push("图片位置=" + data.real_picture_info_list.length);
    if (data.confirm_type !== undefined) parts.push("confirmType=" + data.confirm_type);
    return parts.length ? "请求：" + parts.join("，") : "";
}

function autoRealPhotoResponseSummary(result) {
    if (!result || typeof result !== "object") return "";
    const parts = [];
    if (result.success !== undefined) parts.push("success=" + result.success);
    const target = result.result && typeof result.result === "object" ? result.result : result;
    ["total", "totalCount", "count"].forEach(function(key) {
        if (target[key] !== undefined) parts.push(key + "=" + target[key]);
    });
    if (Array.isArray(target.items)) parts.push("items=" + target.items.length);
    if (Array.isArray(target.data)) parts.push("data=" + target.data.length);
    if (Array.isArray(target.dataList)) parts.push("dataList=" + target.dataList.length);
    if (target.check_result !== undefined) parts.push("checkResult=" + target.check_result);
    if (Array.isArray(target.rule_check_result)) parts.push("规则=" + target.rule_check_result.length);
    const msg = autoRealPhotoResultMessage(result);
    if (msg) parts.push("消息=" + msg);
    return parts.length ? "返回：" + parts.join("，") : "";
}

function autoRealPhotoLogMessageFor(url, status, requestData, result, mallId, fallbackMessage) {
    const parts = [
        autoRealPhotoEndpointTitle(url),
        "店铺=" + mallId,
        "HTTP " + status,
        autoRealPhotoRequestSummary(requestData),
        autoRealPhotoResponseSummary(result),
        fallbackMessage || ""
    ];
    return parts.filter(Boolean).join("；");
}

function autoRealPhotoBusinessLog() {
    autoRealPhotoOriginalConsoleLog.apply(console, arguments);
    try {
        const text = autoRealPhotoFormatLogArgs(Array.prototype.slice.call(arguments));
        if (!text || /^运行日志写入失败/.test(text)) return;
        autoRealPhotoEmitLog({
            phase: "detail",
            type: autoRealPhotoBusinessLogType(text),
            endpointTitle: autoRealPhotoBusinessLogTitle(text),
            endpoint: "业务明细",
            message: text,
            source: "",
            time: Date.now(),
            duration: 0
        });
    } catch (e) {
        autoRealPhotoOriginalConsoleLog(AUTO_REAL_PHOTO_TASK_NAME, "业务明细日志捕获失败", e);
    }
}

function autoRealPhotoFormatLogArgs(args) {
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

function autoRealPhotoBusinessLogType(text) {
    if (/失败|错误|不可|不支持|缺少|异常|error|success=false/i.test(text)) return "detail-error";
    return "detail";
}

function autoRealPhotoBusinessLogTitle(text) {
    if (text.indexOf("实拍图成功") >= 0) return "自动实拍图成功";
    if (text.indexOf("实拍图失败") >= 0 || text.indexOf("接口失败") >= 0) return "自动实拍图失败";
    if (text.indexOf("状态已变化") >= 0) return "待传图状态复查";
    if (text.indexOf("缺少") >= 0 && text.indexOf("模板") >= 0) return "缺少实拍图模板";
    if (text.indexOf("排队中") >= 0) return "自动实拍图排队";
    if (text.indexOf("扫描开始") >= 0) return "自动实拍图扫描";
    return "自动实拍图明细";
}

function getCurrentAutoRealPhotoMallId() {
    return localStorage.getItem("agentseller-mall-info-id") || "";
}

function getAutoRealPhotoMallMode(mall) {
    return mall && mall.mallMode ? "半托" : "全托";
}

function normalizeAutoRealPhotoMallList(userInfoData, currentMallId) {
    const list = userInfoData && userInfoData.result && Array.isArray(userInfoData.result.mallList)
        ? userInfoData.result.mallList.slice()
        : [];
    if (!list.length && currentMallId) list.push({ mallId: currentMallId, mallName: currentMallId, mallMode: 0 });
    const currentIndex = list.findIndex(function(item) {
        return String(item.mallId) === String(currentMallId);
    });
    if (currentIndex > -1) {
        const current = list.splice(currentIndex, 1)[0];
        list.unshift(current);
    }
    return list;
}

function getAutoRealPhotoErrorText(data) {
    return data && (data.error_msg || data.errorMsg || data.message || data.msg) || "接口返回失败";
}

function cloneAutoRealPhoto(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function normalizeAutoRealPhotoLabelImages(labelImageList) {
    if (!Array.isArray(labelImageList)) return [];
    return labelImageList.map(function(item) {
        const position = Number(item && item.position);
        const image = String(item && (item.image || item.image_url) || "").trim();
        if ((position !== 1 && position !== 2) || !image) return null;
        const normalized = { position, image };
        const positionType = Number(item.position_type);
        if (Number.isFinite(positionType) && positionType > 0) normalized.position_type = positionType;
        return normalized;
    }).filter(Boolean);
}

function buildAutoRealPhotoBody(product, labelImageList) {
    const groupMap = new Map();
    normalizeAutoRealPhotoLabelImages(labelImageList).forEach(function(labelImage) {
        if (!groupMap.has(labelImage.position)) groupMap.set(labelImage.position, []);
        const imageItem = { image_url: labelImage.image };
        if (labelImage.position_type != null) imageItem.position_type = labelImage.position_type;
        groupMap.get(labelImage.position).push(imageItem);
    });
    const skuInfoList = Array.isArray(product && product.sku_info) ? product.sku_info : [];
    return {
        spu_id: product.spu_id,
        goods_id: product.goods_id,
        real_picture_info_list: Array.from(groupMap.keys()).sort(function(a, b) {
            return a - b;
        }).map(function(position) {
            return {
                position,
                is_same_sku: 1,
                sku_photo_info_list: skuInfoList.map(function(sku) {
                    return {
                        sku_id: sku.sku_id,
                        image_list: groupMap.get(position).map(function(imageItem) {
                            return Object.assign({}, imageItem);
                        })
                    };
                })
            };
        })
    };
}

function isAutoRealPhotoComplianceReady(waitTaskList) {
    if (!Array.isArray(waitTaskList)) return false;
    const manufacturerTask = waitTaskList.find(function(task) {
        return task && task.show_name === "制造商信息";
    });
    return !!manufacturerTask && Number(manufacturerTask.status) === 3;
}

function isExplicitAutoRealPhotoPending(product) {
    if (!product || typeof product !== "object") return false;
    const values = [product.check_type_status, product.checkTypeStatus, product.check_status];
    const explicitStatus = values.find(function(value) {
        return value !== undefined && value !== null && String(value).trim() !== "";
    });
    return explicitStatus === undefined || Number(explicitStatus) === 1;
}

function getAutoRealPhotoFailureDetail(data) {
    if (!data || typeof data !== "object") return "接口无返回";
    const ruleList = data.result && Array.isArray(data.result.rule_check_result)
        ? data.result.rule_check_result
        : [];
    if (ruleList.length) {
        return ruleList.map(function(item) {
            return String(item.rule_name || "规则") + "->" + String(item.rule_status_toast || item.message || "失败");
        }).join("；");
    }
    return getAutoRealPhotoErrorText(data);
}

(async function() {
    "use strict";

    const pageMallId = getCurrentAutoRealPhotoMallId();
    let config = await loadAutoRealPhotoConfig();
    let userInfoData;
    try {
        userInfoData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/seller/auth/userInfo", {}, pageMallId);
    } catch (e) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "获取店铺列表失败", e);
        showAutoRealPhotoSetupButton("获取店铺列表失败，请确认已登录 TEMU 商家后台。", pageMallId, "", config);
        return;
    }
    if (!userInfoData || !userInfoData.success) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, getAutoRealPhotoErrorText(userInfoData));
        showAutoRealPhotoSetupButton(getAutoRealPhotoErrorText(userInfoData), pageMallId, "", config);
        return;
    }

    const mallList = normalizeAutoRealPhotoMallList(userInfoData, pageMallId);
    const currentMall = mallList[0] || { mallId: pageMallId, mallName: pageMallId, mallMode: 0 };
    const setupMessage = config.enabled
        ? "自动实拍图已启用，只处理待传图状态1。点击可调整模板或停用。"
        : "自动实拍图当前未启用。保存模板SPU后点“启用自动实拍图”。";
    showAutoRealPhotoSetupButton(setupMessage, pageMallId, currentMall.mallName, config);

    if (!config.enabled) {
        resetAutoRealPhotoButtonStats(false);
        return;
    }
    if (!mallList.length) {
        resetAutoRealPhotoButtonStats(false);
        showAutoRealPhotoSetupButton("没有读取到可操作店铺，脚本不会提交线上数据。", pageMallId, "", config);
        return;
    }
    if (!hasAutoRealPhotoTemplateSpu(getEffectiveAutoRealPhotoTemplateSpuMap(config, pageMallId))) {
        resetAutoRealPhotoButtonStats(false);
        showAutoRealPhotoSetupButton("当前店铺没有实拍图参考模板SPU，脚本不会提交线上数据。", pageMallId, currentMall.mallName, config);
        return;
    }
    resetAutoRealPhotoButtonStats(true);

    const queueByMall = new Map();
    const categoryTemplateByMall = new Map();
    mallList.forEach(function(mall) {
        queueByMall.set(String(mall.mallId), []);
        categoryTemplateByMall.set(String(mall.mallId), new Map());
    });

    let currentMallIndex = 0;
    let activeMallId = "";
    let activeMallName = "";
    let isProcessing = false;
    let isScanning = false;
    let isCommitingReturn = true;

    setInterval(rotatingAutoRealPhotoProcess, AUTO_REAL_PHOTO_SCAN_INTERVAL_MS);
    setInterval(submitOneAutoRealPhoto, AUTO_REAL_PHOTO_SUBMIT_INTERVAL_MS);
    setTimeout(rotatingAutoRealPhotoProcess, AUTO_REAL_PHOTO_FIRST_SCAN_DELAY_MS);

    async function rotatingAutoRealPhotoProcess() {
        if (isProcessing) return;
        isProcessing = true;
        isScanning = true;
        activeMallId = "";
        activeMallName = "";

        try {
            config = await loadAutoRealPhotoConfig();
            if (!config.enabled) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, "已停用");
                resetAutoRealPhotoButtonStats(false);
                return;
            }
            if (currentMallIndex >= mallList.length) currentMallIndex = 0;
            const mall = mallList[currentMallIndex];
            if (mallList.length > 1) currentMallIndex++;

            activeMallId = String(mall.mallId);
            activeMallName = mall.mallName || activeMallId;
            queueByMall.set(activeMallId, []);
            categoryTemplateByMall.set(activeMallId, new Map());
            resetAutoRealPhotoButtonStats(true);

            const templateSpuMap = getEffectiveAutoRealPhotoTemplateSpuMap(config, activeMallId);
            if (!hasAutoRealPhotoTemplateSpu(templateSpuMap)) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "缺少实拍图参考模板，跳过", getAutoRealPhotoMallMode(mall));
                return;
            }

            const catTemplateMap = await initAutoRealPhotoCategoryTemplateMap(activeMallId, activeMallName, templateSpuMap);
            categoryTemplateByMall.set(activeMallId, catTemplateMap);
            if (catTemplateMap.size < 1) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "没有可用的实拍图参考模板");
                return;
            }
            await scanAutoRealPhotoProducts(activeMallId, activeMallName);
        } catch (e) {
            autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName || activeMallId || "未知店铺", "轮询失败", e);
        } finally {
            isScanning = false;
            const activeQueue = activeMallId ? queueByMall.get(activeMallId) || [] : [];
            if (!activeQueue.length) isProcessing = false;
        }
    }

    async function initAutoRealPhotoCategoryTemplateMap(mallId, mallName, templateSpuMap) {
        const catTemplateMap = new Map();
        for (const [templateName, spuId] of autoRealPhotoJsonToMap(templateSpuMap)) {
            try {
                const listData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/flash/real_picture/list", {
                    page: 1,
                    page_size: 10,
                    spu_id_list: [spuId],
                    goods_status_list: [1, 2]
                }, mallId);
                const templateItems = listData && listData.result && Array.isArray(listData.result.items)
                    ? listData.result.items
                    : [];
                const labelImageList = normalizeAutoRealPhotoLabelImages(templateItems[0] && templateItems[0].label_image_list);
                if (!listData || !listData.success || !templateItems.length || !labelImageList.length) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "模板SPU缺少实拍图", templateName, spuId, getAutoRealPhotoErrorText(listData));
                    continue;
                }

                const categoryData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier", {
                    pageNum: 1,
                    pageSize: 50,
                    supplierTodoTypeList: [],
                    productSpuIdList: [spuId]
                }, mallId);
                const dataList = categoryData && categoryData.result && Array.isArray(categoryData.result.dataList)
                    ? categoryData.result.dataList
                    : [];
                const catIdList = dataList[0] && Array.isArray(dataList[0].catIdList) ? dataList[0].catIdList : [];
                const catId = catIdList.length ? String(catIdList[catIdList.length - 1]) : "";
                if (!catId) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "模板SPU缺少类目ID", templateName, spuId, getAutoRealPhotoErrorText(categoryData));
                    continue;
                }
                if (catTemplateMap.has(catId)) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "同类目存在多个模板，使用后读取的模板", "cat_id=" + catId, templateName, spuId);
                }
                catTemplateMap.set(catId, {
                    templateName,
                    spuId,
                    labelImageList
                });
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "模板读取成功", templateName, "SPU=" + spuId, "cat_id=" + catId, "图片=" + labelImageList.length);
            } catch (e) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "模板读取失败", templateName, spuId, e);
            }
        }
        return catTemplateMap;
    }

    async function scanAutoRealPhotoProducts(mallId, mallName) {
        autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "待传图状态1扫描开始");
        let page = 1;
        let scannedCount = 0;
        let apiTotal = 0;
        const seenSpu = new Set();

        while (scannedCount < AUTO_REAL_PHOTO_MAX_SCAN_COUNT) {
            const listData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/flash/real_picture/list", {
                page,
                page_size: AUTO_REAL_PHOTO_PAGE_SIZE,
                goods_status_list: [1, 2],
                check_type_status_list: [1]
            }, mallId);
            if (!listData || !listData.success) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "查询待传图商品失败", getAutoRealPhotoErrorText(listData));
                break;
            }
            const result = listData.result && typeof listData.result === "object" ? listData.result : {};
            const productList = Array.isArray(result.items) ? result.items : [];
            apiTotal = Math.min(AUTO_REAL_PHOTO_MAX_SCAN_COUNT, getAutoRealPhotoTotalCount(result) || apiTotal);
            if (!productList.length) break;

            for (let index = 0; index < productList.length && scannedCount < AUTO_REAL_PHOTO_MAX_SCAN_COUNT; index++) {
                const product = productList[index];
                scannedCount++;
                const spuId = String(product && product.spu_id || "");
                if (!spuId || seenSpu.has(spuId)) continue;
                seenSpu.add(spuId);
                if (!isExplicitAutoRealPhotoPending(product)) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "SPU(" + spuId + ")返回状态不是待传图状态1，跳过");
                    continue;
                }
                if (!product.can_edit) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "SPU(" + spuId + ")无法编辑，跳过");
                    continue;
                }
                if (!Array.isArray(product.sku_info) || !product.sku_info.length) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "SPU(" + spuId + ")缺少SKU，跳过");
                    continue;
                }
                const queue = queueByMall.get(mallId) || [];
                if (queue.some(function(item) { return String(item.spu_id) === spuId; })) {
                    autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "SPU(" + spuId + ")实拍图排队中");
                    continue;
                }
                queue.push(product);
                queueByMall.set(mallId, queue);
            }

            const queue = queueByMall.get(mallId) || [];
            setAutoRealPhotoButtonStats({
                active: true,
                pending: queue.length,
                total: Math.max(autoRealPhotoButtonStats.total, apiTotal, scannedCount)
            });
            if (apiTotal > 0) {
                if (scannedCount >= apiTotal) break;
            } else if (productList.length < AUTO_REAL_PHOTO_PAGE_SIZE) {
                break;
            }
            page++;
        }

        const queue = queueByMall.get(mallId) || [];
        if (!queue.length) {
            autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "没有待传图状态1的可提交商品");
        } else {
            autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, mallName, "待传图状态1扫描完成", "扫描=" + scannedCount, "排队=" + queue.length);
        }
    }

    async function submitOneAutoRealPhoto() {
        if (!activeMallId || !isCommitingReturn) return;
        const queue = queueByMall.get(activeMallId) || [];
        if (!queue.length) return;

        isCommitingReturn = false;
        const queuedProduct = queue.shift();
        setAutoRealPhotoButtonStats({
            active: true,
            pending: queue.length
        });

        try {
            const spuId = String(queuedProduct && queuedProduct.spu_id || "");
            const recheckData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/flash/real_picture/list", {
                page: 1,
                page_size: 10,
                spu_id_list: [spuId],
                goods_status_list: [1, 2],
                check_type_status_list: [1]
            }, activeMallId);
            const recheckItems = recheckData && recheckData.result && Array.isArray(recheckData.result.items)
                ? recheckData.result.items
                : [];
            const product = recheckItems.find(function(item) {
                return String(item && item.spu_id || "") === spuId && isExplicitAutoRealPhotoPending(item);
            });
            if (!recheckData || !recheckData.success) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")待传图状态复查失败", getAutoRealPhotoErrorText(recheckData));
                return;
            }
            if (!product) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")状态已变化，不再是待传图状态1，跳过");
                return;
            }
            if (!product.can_edit || !Array.isArray(product.sku_info) || !product.sku_info.length) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")当前不可编辑或缺少SKU，跳过");
                return;
            }

            const complianceData = await postAutoRealPhotoTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/page_query", {
                page_num: 1,
                page_size: 10,
                type: 2,
                spu_id_list: [spuId]
            }, activeMallId);
            if (!complianceData || !complianceData.success) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")合规状态查询失败", getAutoRealPhotoErrorText(complianceData));
                return;
            }
            const complianceList = complianceData.result && Array.isArray(complianceData.result.data)
                ? complianceData.result.data
                : [];
            const complianceProduct = complianceList.find(function(item) {
                return String(item && item.spu_id || "") === spuId;
            }) || complianceList[0];
            if (!complianceProduct) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")没有找到商品合规信息，跳过");
                return;
            }
            if (!isAutoRealPhotoComplianceReady(complianceProduct.wait_task_show_dtolist)) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")制造商信息合规未完成，跳过");
                return;
            }

            const catId = String(complianceProduct.cat_id == null ? "" : complianceProduct.cat_id);
            const catTemplateMap = categoryTemplateByMall.get(activeMallId) || new Map();
            const template = catTemplateMap.get(catId);
            if (!template) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")缺少同类目实拍图模板", "cat_id=" + catId, complianceProduct.cat_name || "");
                return;
            }

            const submitBody = buildAutoRealPhotoBody(product, template.labelImageList);
            if (!submitBody.real_picture_info_list.length) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")模板没有可提交的主体图或外包装图", "模板SPU=" + template.spuId);
                return;
            }

            let submitData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/flash/real_picture/pre_verification", submitBody, activeMallId);
            if (submitData && submitData.success && submitData.result && submitData.result.check_result) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")实拍图成功，剩余" + queue.length + "个", "模板SPU=" + template.spuId, "cat_id=" + catId);
                return;
            }

            // confirm_type=4 是提交确认模式，不是实拍图状态4。
            submitBody.confirm_type = 4;
            submitData = await postAutoRealPhotoTemu("https://agentseller.temu.com/api/flash/real_picture/upload_new", submitBody, activeMallId);
            if (submitData && submitData.success) {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")实拍图成功，剩余" + queue.length + "个", "模板SPU=" + template.spuId, "cat_id=" + catId);
            } else {
                autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName, "SPU(" + spuId + ")实拍图失败，剩余" + queue.length + "个", getAutoRealPhotoFailureDetail(submitData));
            }
        } catch (e) {
            autoRealPhotoBusinessLog(AUTO_REAL_PHOTO_TASK_NAME, activeMallName || activeMallId, "提交实拍图失败", e);
        } finally {
            incrementAutoRealPhotoDone(queue.length);
            isCommitingReturn = true;
            if (!queue.length && !isScanning) isProcessing = false;
        }
    }
})();
