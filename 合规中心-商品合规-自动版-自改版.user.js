// ==UserScript==
// @name         合规中心-商品合规-自动版-自改版
// @namespace    https://www.goldabcd.com/
// @description  合规中心-商品合规自动版（自改版，无需下载器EXE，按模板SPU自动提交合规信息）
// @author       TonyTonyYang
// @match        https://agentseller.temu.com/newon/product-select*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%95%86%E5%93%81%E5%90%88%E8%A7%84-%E8%87%AA%E5%8A%A8%E7%89%88-%E8%87%AA%E6%94%B9%E7%89%88.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%95%86%E5%93%81%E5%90%88%E8%A7%84-%E8%87%AA%E5%8A%A8%E7%89%88-%E8%87%AA%E6%94%B9%E7%89%88.user.js
// @version      2026.0803.1
// ==/UserScript==

const AUTO_COMPLIANCE_CONFIG_KEY = "goldabcd_noexe_auto_compliance_config_v1";
const AUTO_COMPLIANCE_BACKUP_KEY = "goldabcd_noexe_auto_compliance_config_v1_local_backup";
const AUTO_COMPLIANCE_DEFAULT_TEMPLATE = "全部分类";
const AUTO_COMPLIANCE_TASK_NAME = "自动商品合规-自改版-";
const AUTO_COMPLIANCE_INTERVAL_MS = 1000 * 60 * 15;
const AUTO_COMPLIANCE_SUBMIT_INTERVAL_MS = 1000 * 2.5;
const AUTO_COMPLIANCE_DEFAULT_CONFIG = {
    version: 1,
    enabled: false,
    templateSpuMap: {
        "全部分类": ""
    },
    mallTemplateSpuMap: {}
};

registerAutoComplianceMenus();

async function loadAutoComplianceConfig() {
    let raw = await getAutoComplianceStoredValue(AUTO_COMPLIANCE_CONFIG_KEY, null);
    let config = raw;
    if (typeof raw === "string" && raw.trim()) {
        try {
            config = JSON.parse(raw);
        } catch (e) {
            console.log(AUTO_COMPLIANCE_TASK_NAME, "配置 JSON 解析失败，使用默认配置", e);
            config = null;
        }
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        config = cloneAutoCompliance(AUTO_COMPLIANCE_DEFAULT_CONFIG);
        await saveAutoComplianceConfig(config);
    }
    return normalizeAutoComplianceConfig(config);
}

async function saveAutoComplianceConfig(config) {
    const normalized = normalizeAutoComplianceConfig(config);
    const text = JSON.stringify(normalized);
    await setAutoComplianceStoredValue(AUTO_COMPLIANCE_CONFIG_KEY, text);
    return normalized;
}

function normalizeAutoComplianceConfig(config) {
    const normalized = config && typeof config === "object" && !Array.isArray(config)
        ? cloneAutoCompliance(config)
        : cloneAutoCompliance(AUTO_COMPLIANCE_DEFAULT_CONFIG);

    normalized.version = 1;
    normalized.enabled = !!normalized.enabled;
    normalized.templateSpuMap = normalizeTemplateSpuMap(normalized.templateSpuMap || normalized.templates || {});
    normalized.mallTemplateSpuMap = normalizeMallTemplateSpuMap(normalized.mallTemplateSpuMap || {});
    if (!Object.prototype.hasOwnProperty.call(normalized.templateSpuMap, AUTO_COMPLIANCE_DEFAULT_TEMPLATE)) {
        normalized.templateSpuMap[AUTO_COMPLIANCE_DEFAULT_TEMPLATE] = "";
    }
    return normalized;
}

function normalizeMallTemplateSpuMap(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.keys(value).forEach(function(mallId) {
        const normalizedMap = normalizeTemplateSpuMap(value[mallId]);
        if (hasTemplateSpu(normalizedMap)) result[String(mallId)] = normalizedMap;
    });
    return result;
}

function normalizeTemplateSpuMap(value) {
    let map = value;
    if (typeof map === "string" && map.trim()) {
        try {
            map = JSON.parse(map);
        } catch (e) {
            console.log(AUTO_COMPLIANCE_TASK_NAME, "模板SPU配置 JSON 解析失败", e);
            map = {};
        }
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
    const normalized = {};
    Object.keys(map).forEach(function(name) {
        if (name === "version" || name === "enabled" || name === "templateSpuMap" || name === "mallTemplateSpuMap") return;
        normalized[normalizeTemplateName(name)] = String(map[name] == null ? "" : map[name]).trim();
    });
    if (!Object.prototype.hasOwnProperty.call(normalized, AUTO_COMPLIANCE_DEFAULT_TEMPLATE)) {
        normalized[AUTO_COMPLIANCE_DEFAULT_TEMPLATE] = "";
    }
    return normalized;
}

function normalizeTemplateName(name) {
    return String(name == null ? "" : name).trim() || AUTO_COMPLIANCE_DEFAULT_TEMPLATE;
}

function hasTemplateSpu(templateSpuMap) {
    return Object.keys(templateSpuMap || {}).some(function(key) {
        return String(templateSpuMap[key] || "").trim();
    });
}

function getEffectiveTemplateSpuMap(config, mallId) {
    const mallMap = config.mallTemplateSpuMap && config.mallTemplateSpuMap[String(mallId)];
    if (hasTemplateSpu(mallMap)) return normalizeTemplateSpuMap(mallMap);
    return normalizeTemplateSpuMap(config.templateSpuMap);
}

function jsonToMap(value) {
    const objectValue = normalizeTemplateSpuMap(value);
    const map = new Map();
    Object.keys(objectValue).forEach(function(name) {
        const spuId = String(objectValue[name] || "").trim();
        if (spuId) map.set(name, spuId);
    });
    return map;
}

async function getAutoComplianceStoredValue(key, fallbackValue) {
    try {
        if (typeof GM_getValue === "function") {
            const value = GM_getValue(key, fallbackValue);
            if (value && typeof value.then === "function") return await value;
            if (value !== undefined && value !== null && String(value).trim() !== "") return value;
        }
    } catch (e) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, "读取 ScriptCat 配置失败，改用 localStorage", e);
    }
    try {
        const value = localStorage.getItem(key);
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
        const backupValue = localStorage.getItem(AUTO_COMPLIANCE_BACKUP_KEY);
        if (backupValue !== undefined && backupValue !== null && String(backupValue).trim() !== "") return backupValue;
    } catch (e) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, "读取 localStorage 配置失败", e);
    }
    return fallbackValue;
}

async function setAutoComplianceStoredValue(key, value) {
    try {
        localStorage.setItem(key, value);
        localStorage.setItem(AUTO_COMPLIANCE_BACKUP_KEY, value);
    } catch (e) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, "保存 localStorage 配置失败", e);
    }
    try {
        if (typeof GM_setValue === "function") {
            const result = GM_setValue(key, value);
            if (result && typeof result.then === "function") await result;
        }
    } catch (e) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, "保存 ScriptCat 配置失败", e);
    }
}

function registerAutoComplianceMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("商品合规自改版：启用/停用自动合规", async function() {
        const config = await loadAutoComplianceConfig();
        config.enabled = !config.enabled;
        await saveAutoComplianceConfig(config);
        alert(config.enabled ? "已启用自动商品合规，刷新页面后生效" : "已停用自动商品合规，刷新页面后生效");
    });
    GM_registerMenuCommand("商品合规自改版：新增/修改当前店铺模板SPU", async function() {
        await openAutoComplianceTemplatePrompt();
    });
    GM_registerMenuCommand("商品合规自改版：导出配置JSON", async function() {
        const config = await loadAutoComplianceConfig();
        await copyAutoComplianceText(JSON.stringify(config, null, 2));
        alert("已复制商品合规配置 JSON");
    });
    GM_registerMenuCommand("商品合规自改版：重置当前店铺模板", async function() {
        const mallId = getCurrentMallId();
        if (!mallId) {
            alert("当前页面没有读取到 mallId");
            return;
        }
        if (!confirm("确认重置当前店铺模板SPU配置？")) return;
        const config = await loadAutoComplianceConfig();
        delete config.mallTemplateSpuMap[String(mallId)];
        await saveAutoComplianceConfig(config);
        alert("已重置当前店铺模板，刷新页面后生效");
    });
}

async function openAutoComplianceTemplatePrompt() {
    const mallId = getCurrentMallId();
    if (!mallId) {
        alert("当前页面没有读取到 mallId");
        return;
    }
    const config = await loadAutoComplianceConfig();
    const currentMap = getEffectiveTemplateSpuMap(config, mallId);
    const currentName = Object.keys(currentMap).find(function(name) {
        return String(currentMap[name] || "").trim();
    }) || AUTO_COMPLIANCE_DEFAULT_TEMPLATE;
    const nextName = prompt("请输入模板名称。可用类目名，也可用“全部分类”。", currentName);
    if (nextName == null) return;
    const templateName = normalizeTemplateName(nextName);
    const currentSpu = String(currentMap[templateName] || currentMap[currentName] || "").trim();
    const nextSpu = prompt("请输入合规参考模板SPU，只填SPU数字。", currentSpu);
    if (nextSpu == null) return;
    const spuId = String(nextSpu || "").trim();
    if (!spuId) {
        alert("没有填写模板SPU");
        return;
    }
    const mallMap = normalizeTemplateSpuMap(config.mallTemplateSpuMap[String(mallId)] || {});
    mallMap[templateName] = spuId;
    config.mallTemplateSpuMap[String(mallId)] = mallMap;
    await saveAutoComplianceConfig(config);
    alert("已保存当前店铺模板：" + templateName + " -> " + spuId + "，刷新页面后生效");
}

function showAutoComplianceSetupPanel(message, mallId, mallName, config) {
    if (document.getElementById("auto-compliance-noexe-setup")) return;
    const panel = document.createElement("div");
    panel.id = "auto-compliance-noexe-setup";
    panel.style = "z-index:9999;position:fixed;top:80px;left:20px;width:410px;background:#fff7d6;color:#111;border:1px solid #f59e0b;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.18);";

    const title = document.createElement("div");
    title.textContent = "合规中心-商品合规-自动版-自改版";
    title.style = "font-weight:700;margin-bottom:6px;";
    panel.appendChild(title);

    const messageDiv = document.createElement("div");
    messageDiv.textContent = message || "先配置当前店铺的合规参考模板SPU，再启用自动合规。";
    messageDiv.style = "margin-bottom:8px;";
    panel.appendChild(messageDiv);

    const mallDiv = document.createElement("div");
    mallDiv.textContent = "当前店铺：" + (mallName || mallId || "未识别");
    mallDiv.style = "font-size:12px;margin-bottom:8px;";
    panel.appendChild(mallDiv);

    const nameInput = document.createElement("input");
    nameInput.placeholder = "模板名称，例如 全部分类";
    nameInput.value = AUTO_COMPLIANCE_DEFAULT_TEMPLATE;
    nameInput.style = "width:100%;height:30px;box-sizing:border-box;margin:4px 0;padding:5px 8px;border:1px solid #999;border-radius:6px;";
    panel.appendChild(nameInput);

    const spuInput = document.createElement("input");
    spuInput.placeholder = "合规参考模板SPU，只填数字";
    const templateMap = getEffectiveTemplateSpuMap(config || AUTO_COMPLIANCE_DEFAULT_CONFIG, mallId);
    const existingSpu = Object.keys(templateMap).map(function(key) {
        return templateMap[key];
    }).find(function(spuId) {
        return String(spuId || "").trim();
    });
    spuInput.value = existingSpu || "";
    spuInput.style = "width:100%;height:30px;box-sizing:border-box;margin:4px 0 8px 0;padding:5px 8px;border:1px solid #999;border-radius:6px;";
    panel.appendChild(spuInput);

    const buttonRow = document.createElement("div");
    buttonRow.style = "display:flex;gap:8px;align-items:center;";

    const saveButton = document.createElement("button");
    saveButton.textContent = "保存模板";
    saveButton.style = "height:28px;background:#1677ff;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    saveButton.onclick = async function() {
        const targetMallId = mallId || getCurrentMallId();
        const templateName = normalizeTemplateName(nameInput.value);
        const spuId = String(spuInput.value || "").trim();
        if (!targetMallId) {
            alert("当前页面没有读取到 mallId");
            return;
        }
        if (!spuId) {
            alert("请先填写模板SPU");
            return;
        }
        const nextConfig = await loadAutoComplianceConfig();
        const mallMap = normalizeTemplateSpuMap(nextConfig.mallTemplateSpuMap[String(targetMallId)] || {});
        mallMap[templateName] = spuId;
        nextConfig.mallTemplateSpuMap[String(targetMallId)] = mallMap;
        await saveAutoComplianceConfig(nextConfig);
        alert("已保存模板，刷新页面后生效");
    };

    const enableButton = document.createElement("button");
    enableButton.textContent = config && config.enabled ? "已启用" : "启用自动合规";
    enableButton.style = "height:28px;background:#16a34a;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    enableButton.onclick = async function() {
        const nextConfig = await loadAutoComplianceConfig();
        nextConfig.enabled = true;
        await saveAutoComplianceConfig(nextConfig);
        alert("已启用自动商品合规，刷新页面后生效");
    };

    buttonRow.appendChild(saveButton);
    buttonRow.appendChild(enableButton);
    panel.appendChild(buttonRow);
    document.body.appendChild(panel);
}

async function copyAutoComplianceText(text) {
    try {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text);
            return;
        }
    } catch (e) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, "GM_setClipboard 失败", e);
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        prompt("复制配置 JSON", text);
    }
}

async function postTemu(url, data) {
    const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
            accept: "*/*",
            "content-type": "application/json",
            mallid: window.mallId || getCurrentMallId() || ""
        },
        body: JSON.stringify(data || {})
    });
    let result;
    try {
        result = await res.json();
    } catch (e) {
        throw new Error("TEMU接口响应不是JSON：" + url + " HTTP " + res.status);
    }
    return result;
}

function getCurrentMallId() {
    return localStorage.getItem("agentseller-mall-info-id") || "";
}

function getMallMode(mall) {
    return mall && mall.mallMode ? "半托" : "全托";
}

function normalizeMallList(userInfoData, currentMallId) {
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

function getErrorText(data) {
    return data && (data.error_msg || data.errorMsg || data.message || data.msg) || "接口返回失败";
}

function cloneAutoCompliance(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function isEmptyPlainObject(obj) {
    return Object.prototype.toString.call(obj) === "[object Object]"
        && Object.keys(obj).length === 0
        && Object.getOwnPropertySymbols(obj).length === 0;
}

(async function() {
    "use strict";

    let mallId = getCurrentMallId();
    window.mallId = mallId;

    let config = await loadAutoComplianceConfig();
    let userInfoData;
    try {
        userInfoData = await postTemu("https://agentseller.temu.com/api/seller/auth/userInfo", {});
    } catch (e) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, "获取店铺列表失败", e);
        showAutoComplianceSetupPanel("获取店铺列表失败，请确认已登录 TEMU 商家后台。", mallId, "", config);
        return;
    }
    if (!userInfoData.success) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, getErrorText(userInfoData));
        showAutoComplianceSetupPanel(getErrorText(userInfoData), mallId, "", config);
        return;
    }

    const mallList = normalizeMallList(userInfoData, mallId);
    const currentMall = mallList[0] || { mallId, mallName: mallId, mallMode: 0 };
    if (!config.enabled) {
        showAutoComplianceSetupPanel("自动商品合规当前未启用。保存模板SPU后点“启用自动合规”。", mallId, currentMall.mallName, config);
        return;
    }
    if (!hasTemplateSpu(getEffectiveTemplateSpuMap(config, mallId))) {
        showAutoComplianceSetupPanel("当前店铺没有合规参考模板SPU，脚本不会提交线上数据。", mallId, currentMall.mallName, config);
        return;
    }

    const heguiMap = new Map();
    mallList.forEach(function(mall) {
        heguiMap.set(String(mall.mallId), []);
    });

    let mallName = currentMall.mallName || String(currentMall.mallId || "");
    let currentMallIndex = 0;
    let isProcessing = false;
    let isCommitingReturn = true;

    setInterval(rotatingProcess, AUTO_COMPLIANCE_INTERVAL_MS);
    setInterval(submitOneCompliance, AUTO_COMPLIANCE_SUBMIT_INTERVAL_MS);
    rotatingProcess();

    async function rotatingProcess() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            config = await loadAutoComplianceConfig();
            if (!config.enabled) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, "已停用");
                isProcessing = false;
                return;
            }

            if (currentMallIndex >= mallList.length) currentMallIndex = 0;
            const mall = mallList[currentMallIndex];
            if (mallList.length > 1) currentMallIndex++;

            mallId = String(mall.mallId);
            window.mallId = mallId;
            mallName = mall.mallName || mallId;
            heguiMap.set(mallId, []);

            const templateSpuMap = getEffectiveTemplateSpuMap(config, mallId);
            if (!hasTemplateSpu(templateSpuMap)) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "缺少合规参考模板，跳过", getMallMode(mall));
                isProcessing = false;
                return;
            }

            const catSpuMap = await initCatSPUMap(templateSpuMap);
            if (catSpuMap.size < 1) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "没有可用的合规参考模板");
                isProcessing = false;
                return;
            }
            await mainFun(catSpuMap);
        } catch (e) {
            console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "轮询失败", e);
            isProcessing = false;
        }
    }

    async function initCatSPUMap(templateSpuMap) {
        const catSpuMap = new Map();
        for (const [templateName, spuId] of jsonToMap(templateSpuMap)) {
            const pageQueryDataTemplate = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/page_query", {
                page_num: 1,
                page_size: 10,
                type: 2,
                task_status_list: [2],
                spu_id_list: [spuId],
                goods_status_list: [1, 2]
            });
            if (!pageQueryDataTemplate.success || !pageQueryDataTemplate.result || !pageQueryDataTemplate.result.data || pageQueryDataTemplate.result.data.length === 0) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "没有获取到模板SPU的合规数据", templateName, spuId, getErrorText(pageQueryDataTemplate));
                continue;
            }

            const productTemplate = pageQueryDataTemplate.result.data[0];
            const queryDetailDataTemplate = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/query_detail", {
                spu_id: productTemplate.spu_id,
                goods_id: productTemplate.goods_id,
                wait_task_list: productTemplate.wait_task_dtolist
            });
            if (!queryDetailDataTemplate.result || !queryDetailDataTemplate.result.template_list) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "模板明细读取失败", templateName, spuId, getErrorText(queryDetailDataTemplate));
                continue;
            }

            const taskValueMap = new Map();
            queryDetailDataTemplate.result.template_list.forEach(function(template) {
                if (template.rep_detail_list && template.rep_detail_list.length > 0) {
                    template.rep_detail_list = template.rep_detail_list.filter(function(repDetail) {
                        return repDetail.default_select;
                    });
                }
                taskValueMap.set(String(template.task_type), template);
            });

            catSpuMap.set(String(productTemplate.cat_id), {
                spu_id: spuId,
                taskValueMap,
                sku_info_list: queryDetailDataTemplate.result.sku_info_list || []
            });
        }
        return catSpuMap;
    }

    async function mainFun(catSpuMap) {
        console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "合规扫描开始");
        let pageNum = 1;
        let pageQueryData = {
            success: true,
            result: {
                data: [1]
            }
        };

        while (pageQueryData.success && pageQueryData.result && pageQueryData.result.data && pageQueryData.result.data.length > 0) {
            pageQueryData = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/page_query", {
                page_num: pageNum++,
                page_size: 50,
                type: 2,
                goods_status_list: [1, 2],
                task_type_list: [60],
                task_status_list: [2]
            });

            if (!pageQueryData.success) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "查询待合规商品失败", getErrorText(pageQueryData));
                break;
            }
            const productList = pageQueryData.result && pageQueryData.result.data ? pageQueryData.result.data : [];
            productList.forEach(function(product) {
                const queue = heguiMap.get(mallId) || [];
                const exists = queue.some(function(item) {
                    return item.product.spu_id === product.spu_id;
                });
                if (exists) {
                    console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "SPU(" + product.spu_id + ")合规排队中");
                    return;
                }
                const templateProduct = catSpuMap.get(String(product.cat_id));
                if (!templateProduct) {
                    console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "缺少模板，SPU:" + product.spu_id + "，类目ID:" + product.cat_id + "，类目名称:" + product.cat_name);
                    return;
                }
                queue.push({ product, templateProduct });
                heguiMap.set(mallId, queue);
            });
        }

        if ((heguiMap.get(mallId) || []).length === 0) {
            isProcessing = false;
            console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "没有需要合规的商品");
        }
    }

    async function submitOneCompliance() {
        const heguiData = heguiMap.get(mallId) || [];
        if (heguiData.length < 1 || !isCommitingReturn) return;

        isCommitingReturn = false;
        const item = heguiData.shift();

        try {
            const product = item.product;
            const templateProduct = item.templateProduct;
            const queryDetailData = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/query_detail", {
                spu_id: product.spu_id,
                goods_id: product.goods_id,
                wait_task_list: product.wait_task_dtolist
            });
            if (!queryDetailData.result || !queryDetailData.result.template_list) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, getErrorText(queryDetailData) + "，接口报错-->SPU：" + product.spu_id);
                return;
            }

            const skuInfoList = queryDetailData.result.sku_info_list || [];
            skuInfoList.forEach(function(skuTarget, skuTargetIndex) {
                skuInfoList[skuTargetIndex].sku_id_template = templateProduct.sku_info_list && templateProduct.sku_info_list[0]
                    ? templateProduct.sku_info_list[0].sku_id
                    : "";
            });

            const editComplianceBody = {
                cat_id: product.cat_id,
                spu_id: product.spu_id,
                goods_id: product.goods_id,
                template_edit_request_list: []
            };

            let isFillSuccess = true;
            (product.wait_task_dtolist || []).forEach(function(task) {
                const taskType2ValueTemplate = templateProduct.taskValueMap.get(String(task.task_type));
                if (task.task_name === "General Certificate of Conformity（GCC）资质相关信息") return;

                if (!taskType2ValueTemplate) {
                    if (task.task_name !== "土耳其负责人") {
                        console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "参考模板缺少：" + task.task_name + "，SPU：" + product.spu_id);
                        isFillSuccess = false;
                    }
                    return;
                }

                const taskType2Value = cloneAutoCompliance(taskType2ValueTemplate);
                taskType2Value.task_id = task.task_id;
                taskType2Value.task_status = task.status;

                if (Number(task.task_type) === 166) {
                    if (!skuInfoList.length) {
                        console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, product.spu_id + "的‘商品包装材质信息收集’是空的");
                        taskType2Value.sku_group_multi_detail_list = [];
                    } else {
                        taskType2Value.sku_group_multi_detail_list = [{ sku_ids: [], sku_multi_detail: [] }];
                        skuInfoList.forEach(function(sku) {
                            if (!sku.sku_id_template) {
                                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "sku是空的", sku, taskType2ValueTemplate);
                                isFillSuccess = false;
                                return;
                            }
                            if (taskType2ValueTemplate.sku_group_multi_detail_list && taskType2ValueTemplate.sku_group_multi_detail_list[0] && taskType2ValueTemplate.sku_group_multi_detail_list[0].sku_multi_detail) {
                                taskType2Value.sku_group_multi_detail_list[0].sku_ids.push(sku.sku_id);
                                if (taskType2Value.sku_group_multi_detail_list[0].sku_multi_detail.length === 0) {
                                    const sourceDetail = taskType2ValueTemplate.sku_group_multi_detail_list[0].sku_multi_detail[0];
                                    const propertyUploadDetail = cloneAutoCompliance(sourceDetail && sourceDetail.property_upload_detail);
                                    if (propertyUploadDetail["1100100464"] && propertyUploadDetail["1100100464"][0]) {
                                        delete propertyUploadDetail["1100100464"][0].vid_list;
                                        propertyUploadDetail["1100100464"][0].name = Number(propertyUploadDetail["1100100464"][0].name);
                                    }
                                    taskType2Value.sku_group_multi_detail_list[0].sku_multi_detail.push({
                                        property_upload_detail: propertyUploadDetail
                                    });
                                }
                                editComplianceBody.group_sku_by_same_info = true;
                            } else if (taskType2ValueTemplate.sku_multi_detail) {
                                taskType2Value.sku_group_multi_detail_list[sku.sku_id + ""] = taskType2ValueTemplate.sku_multi_detail[sku.sku_id_template + ""];
                            } else {
                                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "sku是空的", sku, taskType2ValueTemplate);
                                isFillSuccess = false;
                            }
                        });
                        if (isEmptyPlainObject(taskType2Value.sku_multi_detail)) {
                            console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "缺少需要的数据", taskType2Value.sku_multi_detail, skuInfoList);
                            isFillSuccess = false;
                        }
                    }
                }
                editComplianceBody.template_edit_request_list.push(taskType2Value);
            });

            if (!isFillSuccess) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "SPU(" + product.spu_id + ")合规失败，剩余" + heguiData.length + "个");
                return;
            }

            const redata = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/edit_compliance", editComplianceBody);
            if (redata && redata.success) {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "SPU(" + product.spu_id + ")合规成功，剩余" + heguiData.length + "个");
            } else {
                console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "SPU(" + product.spu_id + ")合规接口失败：" + getErrorText(redata) + "，剩余" + heguiData.length + "个");
            }
        } catch (e) {
            console.log(AUTO_COMPLIANCE_TASK_NAME, mallName, "提交合规失败", e);
        } finally {
            isCommitingReturn = true;
            if (heguiData.length === 0) isProcessing = false;
        }
    }
})();
