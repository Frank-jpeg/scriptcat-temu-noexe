// ==UserScript==
// @name         上新生命周期-2-开通JIT 自改版可视化业务日志
// @namespace    https://www.goldabcd.com/
// @description  开通JIT（自改版，无需下载器EXE，复用提交核价运行日志）
// @author       TonyTonyYang
// @match        https://agentseller.temu.com/newon/product-select*
// @version      2026.0803.2
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-2-jit.user.js
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-2-jit.user.js
// ==/UserScript==

const NOEXE_STORAGE_KEY = "goldabcd_noexe_config_v1";
const NOEXE_STORAGE_BACKUP_KEY = "goldabcd_noexe_config_v1_local_backup";
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
const NOEXE_LOG_EVENT = "goldabcd-noexe-log-event";
const NOEXE_SCRIPT_NAME = "上新生命周期-2-开通JIT 自改版可视化";
const noExeOriginalConsoleLog = console.log.bind(console);
let noExeLogCounter = 0;

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

    if (!config || typeof config !== "object" || Array.isArray(config)) {
        config = cloneNoExe(NOEXE_DEFAULT_CONFIG);
        await setNoExeValue(NOEXE_STORAGE_KEY, JSON.stringify(config));
    }

    return normalizeNoExeConfig(config);
}

function normalizeNoExeConfig(config) {
    config = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    if (!Array.isArray(config.malls)) config.malls = [];
    if (!config.priceReviewConfig || typeof config.priceReviewConfig !== "object" || Array.isArray(config.priceReviewConfig)) config.priceReviewConfig = {};
    migrateNoExeLegacyPriceConfig(config);
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

function migrateNoExeLegacyPriceConfig(config) {
    NOEXE_PRICE_GROUPS.forEach(function(group) {
        const legacyGroup = config[group.key];
        if (legacyGroup && typeof legacyGroup === "object" && !Array.isArray(legacyGroup)) {
            config.priceReviewConfig[group.key] = Object.assign({}, legacyGroup, config.priceReviewConfig[group.key] || {});
            delete config[group.key];
        }
    });
    if (config.priceMultiple && typeof config.priceMultiple === "object" && !Array.isArray(config.priceMultiple)) {
        config.priceReviewConfig.priceMultiple = Object.assign({}, config.priceMultiple, config.priceReviewConfig.priceMultiple || {});
        delete config.priceMultiple;
    }
    if (config.maxTryCount !== undefined && config.priceReviewConfig.maxTryCount === undefined) {
        config.priceReviewConfig.maxTryCount = config.maxTryCount;
    }
    delete config.maxTryCount;
}

async function getNoExeValue(key, fallbackValue) {
    const candidates = [];
    try {
        if (typeof GM_getValue === "function") {
            const value = GM_getValue(key, fallbackValue);
            candidates.push(await buildNoExeStoredCandidate("gm", value && typeof value.then === "function" ? await value : value));
        }
        else if (typeof GM !== "undefined" && GM.getValue) {
            candidates.push(await buildNoExeStoredCandidate("gm", await GM.getValue(key, fallbackValue)));
        }
    } catch (e) {
        noExeBusinessLog("读取自改版配置失败，改用 localStorage", e);
    }

    candidates.push(await buildNoExeStoredCandidate("local", getNoExeLocalStorageValue(key)));
    candidates.push(await buildNoExeStoredCandidate("backup", getNoExeLocalStorageValue(NOEXE_STORAGE_BACKUP_KEY)));

    const usable = candidates.filter(function(candidate) {
        return candidate && candidate.usable;
    }).sort(function(a, b) {
        return b.score - a.score;
    });
    return usable.length ? usable[0].value : fallbackValue;
}

async function setNoExeValue(key, value) {
    setNoExeLocalStorageValue(key, value);
    setNoExeLocalStorageValue(NOEXE_STORAGE_BACKUP_KEY, value);
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
}

function isNoExeStoredValueUsable(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") {
        const text = value.trim();
        return !!text && text !== "null" && text !== "undefined";
    }
    return typeof value === "object";
}

async function buildNoExeStoredCandidate(source, value) {
    return {
        source,
        value,
        usable: isNoExeStoredValueUsable(value),
        score: getNoExeStoredValueScore(value)
    };
}

function getNoExeStoredValueScore(value) {
    if (!isNoExeStoredValueUsable(value)) return -1;
    let config = value;
    if (typeof value === "string") {
        try {
            config = JSON.parse(value);
        } catch (e) {
            return -1;
        }
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) return -1;
    const priceConfig = config.priceReviewConfig && typeof config.priceReviewConfig === "object" ? config.priceReviewConfig : config;
    let score = Array.isArray(config.malls) ? config.malls.length : 0;
    NOEXE_PRICE_GROUPS.forEach(function(group) {
        const specGroup = priceConfig[group.key];
        if (specGroup && typeof specGroup === "object" && !Array.isArray(specGroup)) {
            score += Object.keys(specGroup).length * 10;
        }
    });
    const multiple = priceConfig.priceMultiple;
    if (multiple && typeof multiple === "object" && !Array.isArray(multiple)) score += Object.keys(multiple).length;
    return score;
}

function getNoExeLocalStorageValue(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? null : raw;
    } catch (e) {
        noExeBusinessLog("读取 localStorage 配置失败", e);
        return null;
    }
}

function setNoExeLocalStorageValue(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        noExeBusinessLog("保存 localStorage 配置失败", e);
    }
}

function cloneNoExe(value) {
    return JSON.parse(JSON.stringify(value));
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
    if (path.indexOf("/searchForChainSupplier") >= 0) return "查询全托商品/核价列表";
    if (path.indexOf("/searchForSemiSupplier") >= 0) return "查询半托核价列表";
    if (path.indexOf("/batch/info/query") >= 0) return "查询半托核价订单详情";
    if (path.indexOf("/bargain-no-bom/batch") >= 0) return "提交半托核价";
    if (path.indexOf("/re-price-review/click") >= 0) return "提交全托核价确认";
    if (path.indexOf("/batchOpenJit") >= 0) return "批量开通 JIT";
    if (path.indexOf("/product/skc/pageQuery") >= 0) return "查询库存商品列表";
    if (path.indexOf("/queryBtgProductStockInfo") >= 0) return "查询半托库存";
    if (path.indexOf("/updateMmsBtgProductSalesStock") >= 0) return "更新半托库存";
    if (path.indexOf("/updateMmsSkuSalesStock") >= 0) return "更新全托库存";
    return "TEMU 接口请求";
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
        ["productStockList", "库存SKU"]
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




(async function () {
    'use strict';
    const mallId = localStorage.getItem('agentseller-mall-info-id');
    window.mallId = mallId;

    const skeyInfo = await getSkey(mallId);
    if(!skeyInfo) return;

    const isSemiHosted = skeyInfo.isSemiHosted;

    if(isSemiHosted){
        noExeBusinessLog("这是一个半托管店铺，没有JIT操作功能");
        return;
    }

    // 创建按钮元素
    let button = document.createElement('button');
    button.textContent = '2、开通JIT';
    button.style = "z-index:9999;position: absolute;top: 220px;left: 260px;background-color: pink;border: 0px;cursor: pointer;padding:10px;";

    // 将按钮添加到容器中
    document.body.appendChild(button);

    const TOPCOUNT = 5000;
    const pageSize = 100;
    let isReturn = true;

    let page = 1;
    let total = 100;
    let productSkcSubSellModeReqList = [];

    let intervalId;
    button.addEventListener('click', function () {
        page = 1;
        total = 100;

        productSkcSubSellModeReqList = [];

        button.textContent = '2、开通JIT(0/0/0)';

        if (!intervalId) {
            //每隔3秒钟检查一次
            intervalId = setInterval(timerFun, 1000 * 5);
            timerFun();//立马执行一次
        }
    });
    setTimeout(function () {
        //noExeBusinessLog("启动定时器");
        button.click();
    }, 5000);

    async function timerFun() {
        if (isReturn && total > pageSize * (page - 1) && pageSize * (page - 1) < TOPCOUNT) {
            isReturn = false;

            let searchForChainSupplierBody = {
				removeStatus: 0,
                secondarySelectStatusList: [7, 10],
                supplierTodoTypeList: [],
                pageNum: page,
                pageSize: pageSize
            }
            let searchForChainSupplierBodyData = await postTemu("https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier", searchForChainSupplierBody);

            // 处理获取到的数据
            total = searchForChainSupplierBodyData.result.total;
            page++;

            for (let i = 0; i < searchForChainSupplierBodyData.result.dataList.length; i++) {
                let data = searchForChainSupplierBodyData.result.dataList[i];
                //noExeBusinessLog("data.customized="+data.customized)

                if (data.customized != 1 && data.productName.indexOf("定制")<0) {//JIT产品
                    let skcList = data.skcList;
                    for (let j = 0; j < skcList.length; j++) {
                        if (!skcList[j].applyJitStatus || skcList[j].applyJitStatus != 3) {//未开通JIT
                            //noExeBusinessLog("SPU:",data.productId,",SKC:",skcList[j].skcId)
                            productSkcSubSellModeReqList.push({
                                productId: data.productId,//SPU
                                productSkcId: skcList[j].skcId//SKC
                            });
                        }
                    }
                }

                button.textContent = '2、开通JIT(0/' + productSkcSubSellModeReqList.length + '/' + total + ')';
            }

            if (productSkcSubSellModeReqList.length > 0 && (total <= pageSize * (page - 1) || pageSize * (page - 1) >= TOPCOUNT)) {
                for (let x = 0; x < productSkcSubSellModeReqList.length; x += pageSize) {
                    let subProductSkcSubSellModeReqList = productSkcSubSellModeReqList.slice(x, x + pageSize);

                    button.textContent = '2、开通JIT(' + (x + subProductSkcSubSellModeReqList.length) + '/' + productSkcSubSellModeReqList.length + '/' + total + ')';

                    let batchOpenJitBody = {
                        productSkcSubSellModeReqList: subProductSkcSubSellModeReqList
                    }
                    let batchOpenJitData = await postTemu("https://agentseller.temu.com/visage-agent-seller/product/skc/batchOpenJit", batchOpenJitBody);
                    if (!batchOpenJitData.success) {
                        noExeBusinessLog(subProductSkcSubSellModeReqList, batchOpenJitData.errorMsg);
                    }
                }
            } else {
                button.textContent = '2、开通JIT(0/' + productSkcSubSellModeReqList.length + '/' + total + ')';
            }

            if (total <= pageSize * (page - 1) || pageSize * (page - 1) >= TOPCOUNT) {
                setTimeout(function () {
                    page = 1;
                    total = 100;
                    productSkcSubSellModeReqList = [];
                }, 1000 * 60 * 5);
            }

            isReturn = true;
        }
    }
})();
