// ==UserScript==
// @name         合规中心-实拍图-自改版
// @namespace    https://www.goldabcd.com/
// @description  合规中心-实拍图（自改版，无需下载器EXE，支持模板SPU或本地上传图片提交）
// @author       TonyTonyYang
// @match        https://agentseller.temu.com/govern/compliant-live-photos*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%AE%9E%E6%8B%8D%E5%9B%BE-%E8%87%AA%E6%94%B9%E7%89%88.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%AE%9E%E6%8B%8D%E5%9B%BE-%E8%87%AA%E6%94%B9%E7%89%88.user.js
// @version      2026.0731.1
// ==/UserScript==

const REAL_PHOTO_CONFIG_KEY = "goldabcd_noexe_real_photo_config_v1";
const REAL_PHOTO_SPU_INPUT_KEY = "goldabcd_noexe_real_photo_spu_input_v1";
const REAL_PHOTO_SOURCE_MODE_KEY = "goldabcd_noexe_real_photo_source_mode_v1";
const REAL_PHOTO_ACTIVE_TEMPLATE_KEY = "goldabcd_noexe_real_photo_active_template_v1";
const REAL_PHOTO_MAX_IMAGE_SIZE = 3 * 1024 * 1024;
const REAL_PHOTO_SPU_QUERY_BATCH_SIZE = 50;
const REAL_PHOTO_DEFAULT_CONFIG = {
    "version": 1,
    "templateSpuMap": {
        "全部分类": ""
    }
};

registerRealPhotoConfigMenu();

async function getNoExeRealPhotoConfig() {
    const config = await loadRealPhotoConfig();
    const templateSpuMap = normalizeTemplateSpuMap(config.templateSpuMap || config);
    return { success: true, data: templateSpuMap, missingTemplate: !hasTemplateSpu(templateSpuMap) };
}

async function loadRealPhotoConfig() {
    let raw = null;
    try {
        if (typeof GM_getValue === "function") raw = GM_getValue(REAL_PHOTO_CONFIG_KEY, null);
    } catch (e) {
        console.log("读取 ScriptCat 配置失败，改用 localStorage", e);
    }
    if (raw == null) {
        try {
            raw = localStorage.getItem(REAL_PHOTO_CONFIG_KEY);
        } catch (e) {
            console.log("读取 localStorage 配置失败", e);
        }
    }
    let config = raw;
    if (typeof raw === "string" && raw.trim()) {
        try {
            config = JSON.parse(raw);
        } catch (e) {
            console.log("实拍图配置 JSON 解析失败，使用默认配置", e);
            config = null;
        }
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        config = cloneRealPhoto(REAL_PHOTO_DEFAULT_CONFIG);
        await saveRealPhotoConfig(config);
    }
    config.templateSpuMap = normalizeTemplateSpuMap(config.templateSpuMap || config);
    config.version = 1;
    return config;
}

async function saveRealPhotoConfig(config) {
    const normalized = {
        version: 1,
        templateSpuMap: normalizeTemplateSpuMap(config && (config.templateSpuMap || config))
    };
    const text = JSON.stringify(normalized);
    try {
        if (typeof GM_setValue === "function") {
            const result = GM_setValue(REAL_PHOTO_CONFIG_KEY, text);
            if (result && typeof result.then === "function") await result;
        }
    } catch (e) {
        console.log("保存 ScriptCat 配置失败，继续写 localStorage", e);
    }
    try {
        localStorage.setItem(REAL_PHOTO_CONFIG_KEY, text);
    } catch (e) {
        console.log("保存 localStorage 配置失败", e);
    }
    return normalized;
}

function normalizeTemplateSpuMap(value) {
    let map = value;
    if (typeof map === "string" && map.trim()) {
        try {
            map = JSON.parse(map);
        } catch (e) {
            console.log("模板SPU配置 JSON 解析失败", e);
            map = {};
        }
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
    const normalized = {};
    Object.keys(map).forEach(function(name) {
        if (name === "version" || name === "templateSpuMap") return;
        const spuId = String(map[name] == null ? "" : map[name]).trim();
        normalized[normalizeTemplateName(name)] = spuId;
    });
    if (!Object.prototype.hasOwnProperty.call(normalized, "全部分类")) normalized["全部分类"] = "";
    return normalized;
}

function normalizeTemplateName(name) {
    return String(name == null ? "" : name).trim() || "全部分类";
}

function hasTemplateSpu(templateSpuMap) {
    return Object.keys(templateSpuMap || {}).some(function(key) {
        return String(templateSpuMap[key] || "").trim();
    });
}

function getFirstTemplateSpu(templateSpuMap) {
    const map = normalizeTemplateSpuMap(templateSpuMap);
    if (String(map["全部分类"] || "").trim()) return String(map["全部分类"]).trim();
    const key = Object.keys(map).find(function(name) {
        return String(map[name] || "").trim();
    });
    return key ? String(map[key]).trim() : "";
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

function templateMapToObject(map) {
    const objectValue = {};
    if (map && typeof map.forEach === "function") {
        map.forEach(function(spuId, name) {
            objectValue[normalizeTemplateName(name)] = String(spuId || "").trim();
        });
    }
    return normalizeTemplateSpuMap(objectValue);
}

async function postTemu(url, data) {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "accept": "*/*",
            "content-type": "application/json",
            "mallid": window.mallId || localStorage.getItem("agentseller-mall-info-id") || ""
        },
        body: JSON.stringify(data)
    });
    let result;
    try {
        result = await res.json();
    } catch (e) {
        throw new Error("TEMU接口响应不是JSON：" + url + " HTTP " + res.status);
    }
    return result;
}

async function getTemuUploadSign(mallId) {
    const result = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/signature", { tag: "flash-tag" });
    const sign = result && result.result && (result.result.signature || result.result.upload_sign || result.result.sign || result.result);
    if (!result || !result.success || !sign) {
        throw new Error((result && result.error_msg) || "获取图片上传签名失败");
    }
    return sign;
}

async function uploadTemuImage(file) {
    if (!file || !file.type || !file.type.startsWith("image/")) {
        throw new Error("只能上传图片文件：" + (file && file.name ? file.name : ""));
    }
    if (file.size > REAL_PHOTO_MAX_IMAGE_SIZE) {
        throw new Error(file.name + " 超过 3MB，请先压缩后再上传");
    }
    const uploadSign = await getTemuUploadSign(window.mallId || localStorage.getItem("agentseller-mall-info-id") || "");
    const body = new FormData();
    body.append("url_width_height", "true");
    body.append("image", file);
    body.append("upload_sign", uploadSign);
    const res = await fetch("https://agentseller.temu.com/api/galerie/v3/store_image?sdk_version=js-0.0.37&tag_name=flash-tag", {
        method: "POST",
        credentials: "include",
        body
    });
    let result;
    try {
        result = await res.json();
    } catch (e) {
        throw new Error("图片上传接口响应不是JSON：HTTP " + res.status);
    }
    const url = result && (result.url || result.image_url || (result.result && (result.result.url || result.result.image_url)));
    if (!res.ok || !url) {
        throw new Error((result && (result.error_msg || result.message)) || ("图片上传失败：HTTP " + res.status));
    }
    return String(url).startsWith("//") ? "https:" + url : String(url);
}

function registerRealPhotoConfigMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("实拍图自改版：新增/修改模板SPU", async function() {
        await openRealPhotoConfigPrompt();
    });
    GM_registerMenuCommand("实拍图自改版：导出模板SPU配置", async function() {
        const config = await loadRealPhotoConfig();
        await copyRealPhotoText(JSON.stringify(config, null, 2));
        alert("已复制实拍图模板SPU配置 JSON");
    });
    GM_registerMenuCommand("实拍图自改版：重置模板SPU配置", async function() {
        if (!confirm("确认重置实拍图模板SPU配置？")) return;
        await saveRealPhotoConfig(cloneRealPhoto(REAL_PHOTO_DEFAULT_CONFIG));
        alert("已重置，刷新页面后生效");
    });
}

async function openRealPhotoConfigPrompt() {
    const config = await loadRealPhotoConfig();
    const templateSpuMap = normalizeTemplateSpuMap(config.templateSpuMap);
    const currentName = Object.keys(templateSpuMap).find(function(name) {
        return String(templateSpuMap[name] || "").trim();
    }) || "全部分类";
    const nextName = prompt("请输入模板名称，用来区分不同图片模板。", currentName);
    if (nextName == null) return;
    const templateName = normalizeTemplateName(nextName);
    const currentSpu = String(templateSpuMap[templateName] || getFirstTemplateSpu(templateSpuMap) || "").trim();
    const nextSpu = prompt("请输入图片来源模板SPU，只填SPU数字。脚本会复制这个SPU已有的实拍图。", currentSpu);
    if (nextSpu == null) return;
    const spuId = String(nextSpu || "").trim();
    if (!spuId) {
        alert("没有填写模板SPU");
        return;
    }
    templateSpuMap[templateName] = spuId;
    await saveRealPhotoConfig({ templateSpuMap });
    try {
        localStorage.setItem(REAL_PHOTO_ACTIVE_TEMPLATE_KEY, templateName);
    } catch (e) {
        console.log("保存当前模板名称失败", e);
    }
    alert("已保存模板：" + templateName + "，刷新页面后生效");
}

function showRealPhotoSetupTip(message) {
    const tip = document.createElement("div");
    tip.style = "z-index:9999;position:fixed;top:80px;left:20px;width:390px;background:#fff7d6;color:#111;border:1px solid #f59e0b;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.18);";
    tip.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">合规中心-实拍图-自改版</div><div style="margin-bottom:8px;"></div>';
    tip.children[1].textContent = message || "先填写图片来源模板SPU。只填数字，不用写JSON。";
    const input = document.createElement("input");
    input.placeholder = "图片来源模板SPU，例如 123456789";
    input.style = "width:100%;height:32px;box-sizing:border-box;margin:4px 0 8px 0;padding:5px 8px;border:1px solid #999;border-radius:6px;";
    const button = document.createElement("button");
    button.textContent = "保存模板SPU";
    button.style = "height:28px;background:#fb7701;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    button.onclick = async function() {
        const spuId = String(input.value || "").trim();
        if (!spuId) {
            alert("请先填写模板SPU");
            return;
        }
        await saveRealPhotoConfig({ templateSpuMap: { "全部分类": spuId } });
        alert("已保存模板SPU，页面会刷新");
        location.reload();
    };
    tip.appendChild(input);
    tip.appendChild(button);
    document.body.appendChild(tip);
}

async function copyRealPhotoText(text) {
    try {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text);
            return;
        }
    } catch (e) {
        console.log("GM_setClipboard 失败", e);
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        prompt("复制配置 JSON", text);
    }
}

function cloneRealPhoto(value) {
    return JSON.parse(JSON.stringify(value));
}

(async function() {
    'use strict';
    const mallId = localStorage.getItem('agentseller-mall-info-id');
    window.mallId = mallId;

    let getConfigData = await getNoExeRealPhotoConfig();
    if(!getConfigData.success){
        console.log(getConfigData.msg)
        showRealPhotoSetupTip(getConfigData.msg);
        return;
    }

    let cateId;

    const defaultName = "全部分类";
    const selectSPUModel = document.createElement('select');
    selectSPUModel.id = 'selectSPUModel';
    selectSPUModel.style="margin:10px 5px 10px 5px;height: 27px;min-width:150px;";

    let cat_spu_map = jsonToMap(getConfigData.data);
    if (!cat_spu_map.has(defaultName)) cat_spu_map.set(defaultName, "");
    function templateOptionLabel(catName, spuId) {
        return catName + "-->模板SPU：" + (String(spuId || "").trim() || "未配置");
    }

    async function saveTemplateMapFromPanel() {
        await saveRealPhotoConfig({ templateSpuMap: templateMapToObject(cat_spu_map) });
    }

    function refreshTemplateSelect(preferredName) {
        const targetName = normalizeTemplateName(preferredName || selectSPUModel.value || localStorage.getItem(REAL_PHOTO_ACTIVE_TEMPLATE_KEY) || defaultName);
        selectSPUModel.innerHTML = "";
        if (!cat_spu_map.size) cat_spu_map.set(defaultName, "");
        for (const [cat_name, spu_id] of cat_spu_map) {
            selectSPUModel.appendChild(new Option(templateOptionLabel(cat_name, spu_id), cat_name));
        }
        if (cat_spu_map.has(targetName)) {
            selectSPUModel.value = targetName;
        } else if (cat_spu_map.has(defaultName)) {
            selectSPUModel.value = defaultName;
        } else {
            selectSPUModel.value = Array.from(cat_spu_map.keys())[0] || defaultName;
        }
        localStorage.setItem(REAL_PHOTO_ACTIVE_TEMPLATE_KEY, selectSPUModel.value);
    }
    refreshTemplateSelect();

    // 创建容器
    let container = document.createElement("div");
    container.id = "workarea";
    container.style="z-index:9999;position:fixed;top:72px;left:0;width:460px;max-height:calc(100vh - 90px);overflow:auto;background-color:lightgreen;padding:8px;display:block;border-radius:0 8px 8px 0;box-shadow:0 8px 24px rgba(0,0,0,.18);transition:transform .18s ease;";

    const titleBar = document.createElement("div");
    titleBar.style = "display:flex;align-items:center;justify-content:space-between;margin:4px 0 8px 0;";
    const pTitle = document.createElement("div");
    pTitle.textContent = "刷实拍图-自改版";
    pTitle.style="font-weight:bold;flex:1;text-align:center;";
    const collapseButton = document.createElement("button");
    collapseButton.textContent = "收起";
    collapseButton.style = "height:26px;background:#1677ff;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    titleBar.appendChild(pTitle);
    titleBar.appendChild(collapseButton);
    container.appendChild(titleBar);

    const guideDiv = document.createElement("div");
    guideDiv.textContent = "先选图片来源：可用模板SPU复刻，也可自己上传图片。目标SPU一行一个。";
    guideDiv.style = "font-size:12px;color:#333;background:#fff7d6;border:1px solid #f59e0b;border-radius:6px;padding:6px;margin:5px;";
    container.appendChild(guideDiv);

    let sourceMode = localStorage.getItem(REAL_PHOTO_SOURCE_MODE_KEY) === "upload" ? "upload" : "template";
    let uploadedPhotoGroupsCache = null;
    const uploadInputs = {};
    const uploadSlots = [
        { key: "subjectFront", title: "商品主体-正视图", position: 1, positionType: 2, max: 1 },
        { key: "subjectSide", title: "商品主体-侧视图", position: 1, positionType: 3, max: 2 },
        { key: "subjectLabel", title: "商品主体-标签图", position: 1, positionType: 4, max: 20 },
        { key: "subjectOther", title: "商品主体-其他图", position: 1, positionType: 5, max: 10 },
        { key: "packageFront", title: "外包装-正视图", position: 2, positionType: 2, max: 1 },
        { key: "packageSide", title: "外包装-侧视图", position: 2, positionType: 3, max: 2 },
        { key: "packageLabel", title: "外包装-标签图", position: 2, positionType: 4, max: 12 },
        { key: "packageOther", title: "外包装-其他图", position: 2, positionType: 5, max: 10 }
    ];

    const sourceModeDiv = document.createElement("div");
    sourceModeDiv.style = "display:flex;gap:10px;align-items:center;margin:5px;padding:6px;background:#fff;border-radius:6px;border:1px solid #ddd;";
    const sourceModeLabel = document.createElement("span");
    sourceModeLabel.textContent = "图片来源：";
    sourceModeLabel.style = "font-weight:bold;";
    const templateModeLabel = document.createElement("label");
    templateModeLabel.style = "cursor:pointer;";
    const templateModeRadio = document.createElement("input");
    templateModeRadio.type = "radio";
    templateModeRadio.name = "realPhotoSourceMode";
    templateModeRadio.value = "template";
    templateModeLabel.appendChild(templateModeRadio);
    templateModeLabel.appendChild(document.createTextNode(" 模板SPU复刻"));
    const uploadModeLabel = document.createElement("label");
    uploadModeLabel.style = "cursor:pointer;";
    const uploadModeRadio = document.createElement("input");
    uploadModeRadio.type = "radio";
    uploadModeRadio.name = "realPhotoSourceMode";
    uploadModeRadio.value = "upload";
    uploadModeLabel.appendChild(uploadModeRadio);
    uploadModeLabel.appendChild(document.createTextNode(" 自己上传图片"));
    sourceModeDiv.appendChild(sourceModeLabel);
    sourceModeDiv.appendChild(templateModeLabel);
    sourceModeDiv.appendChild(uploadModeLabel);
    container.appendChild(sourceModeDiv);

    const divTemplateInput = document.createElement("div");
    divTemplateInput.style = "width:100%;margin:5px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px;box-sizing:border-box;";
    const templateHelp = document.createElement("div");
    templateHelp.textContent = "模板模式：可保存多个模板，命名后下次直接下拉选择。";
    templateHelp.style = "font-size:12px;color:#333;margin-bottom:6px;";
    const templateSelectLabel = document.createElement("div");
    templateSelectLabel.textContent = "已保存模板：";
    templateSelectLabel.style = "margin-bottom:4px;font-weight:bold;";
    const templateSelectRow = document.createElement("div");
    templateSelectRow.style = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
    selectSPUModel.style = "height:30px;flex:1;min-width:0;box-sizing:border-box;border:1px solid #999;border-radius:6px;padding:0 6px;";
    const deleteTemplateButton = document.createElement("button");
    deleteTemplateButton.textContent = "删除";
    deleteTemplateButton.style = "height:30px;background:#666;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    templateSelectRow.appendChild(selectSPUModel);
    templateSelectRow.appendChild(deleteTemplateButton);
    const templateNameLabel = document.createElement("div");
    templateNameLabel.textContent = "模板名称：";
    templateNameLabel.style = "margin-bottom:4px;font-weight:bold;";
    const templateNameInput = document.createElement("input");
    templateNameInput.placeholder = "例如：女装标签图、包装图A款";
    templateNameInput.value = selectSPUModel.value || defaultName;
    templateNameInput.style = "width:430px;height:30px;box-sizing:border-box;margin-bottom:6px;padding:5px 8px;border:1px solid #999;border-radius:6px;";
    const templateSpuLabel = document.createElement("div");
    templateSpuLabel.textContent = "图片来源模板SPU（复制这个SPU的实拍图）：";
    templateSpuLabel.style = "margin-bottom:4px;font-weight:bold;";
    const templateSpuRow = document.createElement("div");
    templateSpuRow.style = "display:flex;align-items:center;gap:6px;";
    const templateSpuInput = document.createElement("input");
    templateSpuInput.placeholder = "只填一个SPU数字，例如 123456789";
    templateSpuInput.value = cat_spu_map.get(selectSPUModel.value) || getFirstTemplateSpu(getConfigData.data);
    templateSpuInput.style = "height:30px;flex:1;min-width:0;box-sizing:border-box;padding:5px 8px;border:1px solid #999;border-radius:6px;";
    const saveTemplateButton = document.createElement("button");
    saveTemplateButton.textContent = "保存模板";
    saveTemplateButton.style = "height:30px;background:#1677ff;color:#fff;border:0;border-radius:6px;padding:0 12px;cursor:pointer;";

    function syncTemplateInputsFromSelection() {
        const selectedName = normalizeTemplateName(selectSPUModel.value || defaultName);
        templateNameInput.value = selectedName;
        templateSpuInput.value = String(cat_spu_map.get(selectedName) || "").trim();
        localStorage.setItem(REAL_PHOTO_ACTIVE_TEMPLATE_KEY, selectedName);
    }

    saveTemplateButton.onclick = async function() {
        const templateName = normalizeTemplateName(templateNameInput.value || selectSPUModel.value || defaultName);
        const templateSpu = String(templateSpuInput.value || "").trim();
        if (!templateSpu) {
            alert("请先填写图片来源模板SPU");
            return;
        }
        cat_spu_map.set(templateName, templateSpu);
        await saveTemplateMapFromPanel();
        refreshTemplateSelect(templateName);
        syncTemplateInputsFromSelection();
        infoDiv.textContent = "模板已保存：" + templateName + "，正在读取模板图片...";
        await updateSpu();
    };
    deleteTemplateButton.onclick = async function() {
        const templateName = normalizeTemplateName(selectSPUModel.value || templateNameInput.value || defaultName);
        if (!cat_spu_map.has(templateName)) return;
        if (!confirm("确认删除模板：" + templateName + "？")) return;
        cat_spu_map.delete(templateName);
        if (!cat_spu_map.size) cat_spu_map.set(defaultName, "");
        const nextName = cat_spu_map.has(defaultName) ? defaultName : Array.from(cat_spu_map.keys())[0];
        await saveTemplateMapFromPanel();
        refreshTemplateSelect(nextName);
        syncTemplateInputsFromSelection();
        infoDiv.textContent = "模板已删除：" + templateName;
        await updateSpu();
    };
    divTemplateInput.appendChild(templateHelp);
    divTemplateInput.appendChild(templateSelectLabel);
    divTemplateInput.appendChild(templateSelectRow);
    divTemplateInput.appendChild(templateNameLabel);
    divTemplateInput.appendChild(templateNameInput);
    divTemplateInput.appendChild(templateSpuLabel);
    templateSpuRow.appendChild(templateSpuInput);
    templateSpuRow.appendChild(saveTemplateButton);
    divTemplateInput.appendChild(templateSpuRow);
    container.appendChild(divTemplateInput);

    const divUploadInput = document.createElement("div");
    divUploadInput.style = "width:100%;margin:5px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px;box-sizing:border-box;";
    const uploadTip = document.createElement("div");
    uploadTip.textContent = "自己上传图片：每张不超过3MB。选择后点提交，脚本会先上传图片，再提交给目标SPU。";
    uploadTip.style = "font-size:12px;color:#333;margin-bottom:6px;";
    divUploadInput.appendChild(uploadTip);

    function createUploadSlot(slot) {
        const row = document.createElement("div");
        row.style = "display:flex;align-items:center;gap:6px;margin:5px 0;";
        const label = document.createElement("label");
        label.textContent = slot.title + "：";
        label.style = "width:120px;font-size:12px;";
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = slot.max > 1;
        input.style = "width:230px;font-size:12px;";
        const count = document.createElement("span");
        count.textContent = "0/" + slot.max;
        count.style = "font-size:12px;color:#666;";
        input.onchange = function() {
            const files = Array.from(input.files || []);
            uploadedPhotoGroupsCache = null;
            if (files.length > slot.max) {
                alert(slot.title + "最多选择 " + slot.max + " 张");
                input.value = "";
                count.textContent = "0/" + slot.max;
                return;
            }
            const tooLarge = files.find(function(file) { return file.size > REAL_PHOTO_MAX_IMAGE_SIZE; });
            if (tooLarge) {
                alert(tooLarge.name + " 超过3MB，请压缩后再选");
                input.value = "";
                count.textContent = "0/" + slot.max;
                return;
            }
            count.textContent = files.length + "/" + slot.max;
        };
        uploadInputs[slot.key] = input;
        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(count);
        return row;
    }

    uploadSlots.forEach(function(slot) {
        divUploadInput.appendChild(createUploadSlot(slot));
    });
    container.appendChild(divUploadInput);

    function setSourceMode(nextMode) {
        sourceMode = nextMode === "upload" ? "upload" : "template";
        localStorage.setItem(REAL_PHOTO_SOURCE_MODE_KEY, sourceMode);
        templateModeRadio.checked = sourceMode === "template";
        uploadModeRadio.checked = sourceMode === "upload";
        divTemplateInput.style.display = sourceMode === "template" ? "block" : "none";
        divUploadInput.style.display = sourceMode === "upload" ? "block" : "none";
        guideDiv.textContent = sourceMode === "upload"
            ? "上传模式：选择本地图片，目标SPU一行一个，然后点提交。模板SPU不会被使用。"
            : "模板模式：填写已有实拍图的模板SPU，目标SPU一行一个，然后点提交。";
    }
    templateModeRadio.onchange = function() { setSourceMode("template"); };
    uploadModeRadio.onchange = function() { setSourceMode("upload"); };
    setSourceMode(sourceMode);

    const statusDiv = document.createElement("div");
    statusDiv.style="width:100%;display: ruby;margin: 5px;";

    const selectStatus = document.createElement('select');
    selectStatus.id = 'selectStatus';
    selectStatus.style="margin:10px 5px 10px 5px;height: 27px;min-width:150px;";
    selectStatus.appendChild(new Option("待传图", 1));
    selectStatus.appendChild(new Option("图中标签有异常", 4));
    selectStatus.appendChild(new Option("识别成功", 5));

    const statusTip = document.createElement("div");
    statusTip.textContent="识别状态：";
    statusDiv.appendChild(statusTip);
    statusDiv.appendChild(selectStatus);
    container.appendChild(statusDiv);

    const divSpuInput = document.createElement("div");
    divSpuInput.style = "width:100%;margin:5px;";
    const spuInputLabel = document.createElement("div");
    spuInputLabel.textContent = "目标SPU（要提交图片的商品，粘贴到这里）：";
    spuInputLabel.style = "margin-bottom:4px;font-weight:bold;";
    const spuInput = document.createElement("textarea");
    spuInput.id = "spuIdStr";
    spuInput.placeholder = "一行一个SPU，例如：\n123456789\n987654321\n也支持从表格复制多行";
    spuInput.value = localStorage.getItem(REAL_PHOTO_SPU_INPUT_KEY) || "";
    spuInput.style = "display:block;width:410px;height:120px;box-sizing:border-box;resize:vertical;margin-bottom:6px;padding:6px;border:1px solid #999;border-radius:6px;font-size:12px;";
    spuInput.addEventListener("input", function() {
        localStorage.setItem(REAL_PHOTO_SPU_INPUT_KEY, spuInput.value);
    });
    const spuImportRow = document.createElement("div");
    spuImportRow.style = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
    const importSpuButton = document.createElement("button");
    importSpuButton.textContent = "导入TXT/CSV";
    importSpuButton.style = "height:28px;background:#1677ff;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    const clearSpuButton = document.createElement("button");
    clearSpuButton.textContent = "清空SPU";
    clearSpuButton.style = "height:28px;background:#666;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    const importSpuTip = document.createElement("span");
    importSpuTip.textContent = "大量SPU建议用TXT/CSV，一行一个";
    importSpuTip.style = "font-size:12px;color:#555;";
    const spuFileInput = document.createElement("input");
    spuFileInput.type = "file";
    spuFileInput.accept = ".txt,.csv,text/plain,text/csv";
    spuFileInput.style = "display:none;";
    importSpuButton.onclick = function() {
        spuFileInput.click();
    };
    clearSpuButton.onclick = function() {
        if (!confirm("确认清空目标SPU？")) return;
        spuInput.value = "";
        localStorage.removeItem(REAL_PHOTO_SPU_INPUT_KEY);
        infoDiv.textContent = "目标SPU已清空";
    };
    spuFileInput.onchange = async function() {
        const file = spuFileInput.files && spuFileInput.files[0];
        if (!file) return;
        const text = await file.text();
        const ids = parseIdList(text);
        if (!ids.length) {
            alert("文件里没有识别到SPU");
            spuFileInput.value = "";
            return;
        }
        spuInput.value = ids.join("\n");
        localStorage.setItem(REAL_PHOTO_SPU_INPUT_KEY, spuInput.value);
        infoDiv.textContent = "已导入SPU：" + ids.length + "个";
        spuFileInput.value = "";
    };
    spuImportRow.appendChild(importSpuButton);
    spuImportRow.appendChild(clearSpuButton);
    spuImportRow.appendChild(importSpuTip);
    divSpuInput.appendChild(spuInputLabel);
    divSpuInput.appendChild(spuImportRow);
    divSpuInput.appendChild(spuFileInput);
    divSpuInput.appendChild(spuInput);
    container.appendChild(divSpuInput);

    const divModelInput = document.createElement("div");
    divModelInput.style="width:100%;display:flow-root;";
    const buttonSubmit = document.createElement("button");
    buttonSubmit.onclick = async function(){
        const photoGroups = await ensurePhotoSourceReady();
        if (!photoGroups) return;
        await mainFun(null, {ignorePanelInputs: true, photoGroups});
    };
    buttonSubmit.textContent = "按状态提交";
    buttonSubmit.style="float: right;width: 80px;height: 30px;background-color: #fb7701;color: white;border: none;border-radius: 6px;cursor:pointer";
    divModelInput.appendChild(buttonSubmit);
    const buttonSubmitInput = document.createElement("button");
    buttonSubmitInput.onclick = async function(){
        const spu_id_list = parseIdList(spuInput.value);
        if(spu_id_list.length === 0){
            infoDiv.textContent = "请先输入SPU，一行一个";
            alert("请先输入SPU，一行一个");
            return;
        }
        const photoGroups = await ensurePhotoSourceReady();
        if (!photoGroups) return;
        await mainFun(spu_id_list, {ignorePanelInputs: true, photoGroups});
    };
    buttonSubmitInput.textContent = "提交这些SPU";
    buttonSubmitInput.style="float: right;margin-right:5px;width: 110px;height: 30px;background-color: #fb7701;color: white;border: none;border-radius: 6px;cursor:pointer";
    divModelInput.appendChild(buttonSubmitInput);
    const buttonSubmit2 = document.createElement("button");
    buttonSubmit2.onclick = async function(){
        let checkBoxArr = document.getElementsByClassName("lf-checkbox is-checked");
        let spu_id_list = [];
        for(let i=0;i<checkBoxArr.length;i++){
            let checkBox = checkBoxArr[i];
            let text = checkBox.parentElement.nextSibling.nextSibling.textContent;
            let spuIndex = text.indexOf("SPU：");
			if(spuIndex >= 0){
				let spu = text.substr(spuIndex+4).trim();
				if(spu && spu.length >0){
					spu_id_list.push(spu);
				}
			}
        }
        if(spu_id_list.length === 0){
            infoDiv.textContent = "没有识别到勾选SPU，请改用目标SPU输入框";
            alert("没有识别到勾选SPU，请改用目标SPU输入框");
            return;
        }
        const photoGroups = await ensurePhotoSourceReady();
        if (!photoGroups) return;
        await mainFun(spu_id_list, {ignorePanelInputs: true, photoGroups});
    };
    buttonSubmit2.textContent = "按勾选提交";
    buttonSubmit2.style="float: right;margin-right:5px;width: 80px;height: 30px;background-color: #fb7701;color: white;border: none;border-radius: 6px;cursor:pointer";
    divModelInput.appendChild(buttonSubmit2);
    container.appendChild(divModelInput);

    const bottomDiv = document.createElement("div");
    bottomDiv.style="width:100%;display:block;";
    const infoDiv = document.createElement("div");
    infoDiv.textContent = " ";
    infoDiv.style="float: left;color: red;width: 100%;margin-left: 5px;";
    bottomDiv.appendChild(infoDiv);
    container.appendChild(bottomDiv);

    document.body.appendChild(container);

    const launcherButton = document.createElement("button");
    launcherButton.textContent = "实拍图";
    launcherButton.style = "z-index:10000;position:fixed;top:88px;left:0;width:42px;min-height:82px;background:#fb7701;color:#fff;border:0;border-radius:0 8px 8px 0;padding:8px 6px;font-weight:bold;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);writing-mode:vertical-rl;letter-spacing:1px;transition:left .18s ease;";
    let drawerOpen = false;
    function setDrawerOpen(open) {
        drawerOpen = !!open;
        container.style.transform = drawerOpen ? "translateX(0)" : "translateX(-485px)";
        launcherButton.style.left = drawerOpen ? "460px" : "0";
        launcherButton.textContent = drawerOpen ? "收起" : "实拍图";
    }
    launcherButton.onclick = function() {
        setDrawerOpen(!drawerOpen);
    };
    collapseButton.onclick = function() {
        setDrawerOpen(false);
    };
    document.body.appendChild(launcherButton);
    setDrawerOpen(false);

    let label_image_list = [];

    selectSPUModel.onchange = async function(){
        syncTemplateInputsFromSelection();
        await updateSpu();
    };
    syncTemplateInputsFromSelection();
    selectSPUModel.dispatchEvent(new Event('change', { bubbles: true }));

    async function ensureTemplateReady(){
        const templateName = normalizeTemplateName(templateNameInput.value || selectSPUModel.value || defaultName);
        const templateSpu = String(templateSpuInput.value || "").trim();
        if(!templateSpu){
            infoDiv.textContent = "第1步：请先填写图片来源模板SPU";
            alert("请先填写图片来源模板SPU。这个SPU必须已经有实拍图。");
            return false;
        }
        if(selectSPUModel.value !== templateName || String(cat_spu_map.get(templateName) || "").trim() !== templateSpu || !label_image_list || label_image_list.length === 0){
            cat_spu_map.set(templateName, templateSpu);
            await saveTemplateMapFromPanel();
            refreshTemplateSelect(templateName);
            syncTemplateInputsFromSelection();
            await updateSpu();
        }
        if(!label_image_list || label_image_list.length === 0){
            infoDiv.textContent = "模板SPU没有读取到实拍图，换一个已上传实拍图的SPU";
            alert("模板SPU没有读取到实拍图，换一个已上传实拍图的SPU。");
            return false;
        }
        return true;
    }

    async function updateSpu(){
        const selectedTemplateName = normalizeTemplateName(selectSPUModel.value || defaultName);
        let spuId = String(cat_spu_map.get(selectedTemplateName) || "").trim();
        templateSpuInput.value = spuId;
        if(!spuId){
            label_image_list = [];
            cateId = null;
            infoDiv.textContent = "第1步：填写图片来源模板SPU，然后点保存或直接提交";
            return;
        }
        infoDiv.textContent = "正在读取模板SPU图片：" + spuId;
        let listData = await postTemu("https://agentseller.temu.com/api/flash/real_picture/list", {page:1,page_size:10,spu_id_list:[spuId]});

        if (!listData.success || !listData.result.items || !listData.result.items.length > 0) {
            label_image_list = [];
            infoDiv.textContent = "参考模板数据缺少实拍图，模板SPU：" + spuId;
            console.log("参考模板数据-缺少实拍图，模板SPU：" + spuId);
            return;
        }

        label_image_list = listData.result.items[0].label_image_list || [];
        const position1Count = label_image_list.filter(function(item) { return item.position == 1; }).length;
        const position2Count = label_image_list.filter(function(item) { return item.position == 2; }).length;
        infoDiv.textContent = "模板图片已读取：主体图" + position1Count + "张，外包装图" + position2Count + "张";
        //inputZhuTi.value=listData.result.items[0].label_image_list[0].image;
        //inputWaiBaoZhuang.value=listData.result.items[0].label_image_list[1].image;
        cateId = null;
    }

    function addImageToGroup(groupMap, position, imageItem) {
        const positionNum = Number(position);
        if (!positionNum || !imageItem || !imageItem.image_url) return;
        if (!groupMap.has(positionNum)) groupMap.set(positionNum, []);
        groupMap.get(positionNum).push(imageItem);
    }

    function groupsFromMap(groupMap) {
        return Array.from(groupMap.keys()).sort(function(a, b) { return a - b; }).map(function(position) {
            return {
                position,
                image_list: groupMap.get(position)
            };
        }).filter(function(group) {
            return group.image_list && group.image_list.length > 0;
        });
    }

    function normalizeImageItem(imageUrl, positionType) {
        const item = { image_url: String(imageUrl || "").trim() };
        const positionTypeNum = Number(positionType);
        if (!Number.isNaN(positionTypeNum) && positionTypeNum > 0) item.position_type = positionTypeNum;
        return item;
    }

    function getTemplatePhotoGroups() {
        const groupMap = new Map();
        label_image_list.forEach(function(labelImage) {
            const imageUrl = labelImage.image || labelImage.image_url;
            if (!imageUrl) return;
            addImageToGroup(groupMap, labelImage.position, normalizeImageItem(imageUrl, labelImage.position_type));
        });
        return groupsFromMap(groupMap);
    }

    async function ensureUploadedPhotosReady() {
        if (uploadedPhotoGroupsCache && uploadedPhotoGroupsCache.length > 0) return uploadedPhotoGroupsCache;
        const selected = [];
        uploadSlots.forEach(function(slot) {
            const input = uploadInputs[slot.key];
            const files = input ? Array.from(input.files || []) : [];
            if (files.length > slot.max) {
                throw new Error(slot.title + "最多选择 " + slot.max + " 张");
            }
            files.forEach(function(file) {
                selected.push({ slot, file });
            });
        });
        if (selected.length === 0) {
            alert("请先在上传模式里选择至少一张图片");
            infoDiv.textContent = "请先选择要上传的图片";
            return null;
        }
        const groupMap = new Map();
        for (let i = 0; i < selected.length; i++) {
            const item = selected[i];
            infoDiv.textContent = "正在上传图片 " + (i + 1) + "/" + selected.length + "：" + item.file.name;
            const uploadedUrl = await uploadTemuImage(item.file);
            addImageToGroup(groupMap, item.slot.position, normalizeImageItem(uploadedUrl, item.slot.positionType));
        }
        uploadedPhotoGroupsCache = groupsFromMap(groupMap);
        infoDiv.textContent = "图片上传完成：" + selected.length + "张";
        return uploadedPhotoGroupsCache;
    }

    async function ensurePhotoSourceReady() {
        try {
            if (sourceMode === "upload") {
                return await ensureUploadedPhotosReady();
            }
            if (!await ensureTemplateReady()) return null;
            const templateGroups = getTemplatePhotoGroups();
            if (!templateGroups.length) {
                infoDiv.textContent = "模板SPU没有可提交的图片";
                alert("模板SPU没有可提交的图片");
                return null;
            }
            return templateGroups;
        } catch (e) {
            console.error(e);
            infoDiv.textContent = e.message || "图片准备失败";
            alert(e.message || "图片准备失败");
            return null;
        }
    }

    function cloneImageList(imageList) {
        return imageList.map(function(imageItem) {
            const cloned = { image_url: imageItem.image_url };
            if (imageItem.position_type != null) cloned.position_type = imageItem.position_type;
            return cloned;
        });
    }

    function buildRealPictureBody(product, photoGroups) {
        return {
            spu_id: product.spu_id,
            goods_id: product.goods_id,
            real_picture_info_list: photoGroups.map(function(group) {
                return {
                    position: Number(group.position),
                    is_same_sku: 1,
                    sku_photo_info_list: (product.sku_info || []).map(function(sku) {
                        return {
                            sku_id: sku.sku_id,
                            image_list: cloneImageList(group.image_list)
                        };
                    })
                };
            })
        };
    }

    let lastKeyPressTime = 0;
    //双击ctrl自动触发
    document.addEventListener('keydown', function(event) {
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastKeyPressTime;

        // 检查是否是Ctrl键，并且两次按键时间间隔小于阈值
        if ((event.key === 'Control' || event.keyCode === 17) && timeDiff > 150 && timeDiff < 300) {
            console.log("双击Ctrl："+timeDiff)
            setDrawerOpen(!drawerOpen);

            lastKeyPressTime = currentTime + 300;//屏蔽过快点击造成双闪
        } else {
            lastKeyPressTime = currentTime;
        }
    });

	const TOPCOUNT = 5000;
    const page_size = 50;
    let page_num = 1;
    let total = 100;
    let submitCount = 0;
    let successCount = 0;
    let realPictureList= [];

    function parseIdList(text){
        return Array.from(new Set(String(text || "").split(/[\s,，、;；]+/).map(function(item){
            return item.trim();
        }).filter(Boolean)));
    }

    function chunkArray(list, size) {
        const chunks = [];
        for (let i = 0; i < list.length; i += size) {
            chunks.push(list.slice(i, i + size));
        }
        return chunks;
    }

    function sleep(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function queryRealPictureList(body) {
        const data = await postTemu("https://agentseller.temu.com/api/flash/real_picture/list", body);
        if (!data.success) {
            throw new Error(data.error_msg || "查询实拍图商品列表失败");
        }
        return {
            total: (data.result && data.result.total) || 0,
            items: (data.result && data.result.items) || []
        };
    }

    async function collectRealPictureProducts(baseBody, directSpuIds, skcIdArr) {
        const productMap = new Map();
        if (directSpuIds.length > 0) {
            const chunks = chunkArray(directSpuIds, REAL_PHOTO_SPU_QUERY_BATCH_SIZE);
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                let currentPage = 1;
                let chunkTotal = chunk.length;
                while ((currentPage - 1) * page_size < chunkTotal) {
                    const body = Object.assign({}, baseBody, {
                        page: currentPage,
                        page_size,
                        spu_id_list: chunk
                    });
                    const result = await queryRealPictureList(body);
                    chunkTotal = result.total || result.items.length;
                    result.items.forEach(function(product) {
                        productMap.set(String(product.spu_id), product);
                    });
                    infoDiv.textContent = "SPU分批查询：" + (chunkIndex + 1) + "/" + chunks.length + "批，已找到" + productMap.size + "个商品";
                    if (!result.items.length) break;
                    currentPage++;
                }
            }
            return Array.from(productMap.values());
        }

        page_num = 1;
        total = 100;
        while (total > (page_num - 1) * page_size && (page_num - 1) * page_size < TOPCOUNT) {
            const body = Object.assign({}, baseBody, {
                page: page_num,
                page_size
            });
            if (skcIdArr.length > 0) {
                body.skc_id_list = skcIdArr;
            } else {
                body.check_type_status_list = [Number(selectStatus.value)];
            }
            const result = await queryRealPictureList(body);
            result.items.forEach(function(product) {
                productMap.set(String(product.spu_id), product);
            });
            total = result.total;
            page_num++;
            infoDiv.textContent = "进度：总共" + total + "个，已扫描" + productMap.size + "个";
            if (!result.items.length) break;
        }
        return Array.from(productMap.values());
    }

    async function submitRealPictureProduct(product, photoGroups, productTotal) {
        if (!product.can_edit) {
            console.log("SPU‘" + product.spu_id + "’无法编辑");
            return;
        }
        if (!product.sku_info || !product.sku_info.length) {
            console.log("SPU‘" + product.spu_id + "’商品异常或已被删除");
            return;
        }
        const pageQueryData = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/page_query", {
            page_num: 1,
            page_size,
            type: 2,
            spu_id_list: [product.spu_id]
        });
        if (!pageQueryData.success) {
            console.log(pageQueryData.error_msg);
            return;
        }
        const pageQueryList = pageQueryData.result && pageQueryData.result.data ? pageQueryData.result.data : [];
        if (pageQueryList.length < 1) {
            console.log("没有找到SPU‘" + product.spu_id + "’的合规信息");
            return;
        }
        if (!checkComplianceStatus(pageQueryList[0].wait_task_show_dtolist || [])) {
            console.log("SPU‘" + product.spu_id + "’的合规操作未完成");
            return;
        }

        const preVerificationBody = buildRealPictureBody(product, photoGroups);
        console.log("进度：总共" + productTotal + "个，已提交" + submitCount + "个，成功" + successCount + "个，正在提交SPU：" + product.spu_id);
        infoDiv.textContent = "进度：总共" + productTotal + "个，已提交" + submitCount + "个，成功" + successCount + "个，正在提交SPU：" + product.spu_id;
        submitCount++;

        let redata = await postTemu("https://agentseller.temu.com/api/flash/real_picture/pre_verification", preVerificationBody);
        if (redata.success && redata.result && redata.result.check_result) {
            successCount++;
        } else {
            preVerificationBody.confirm_type = 4;
            redata = await postTemu("https://agentseller.temu.com/api/flash/real_picture/upload_new", preVerificationBody);
            if (redata.success) {
                successCount++;
            } else {
                let failInfo = product.spu_id + "失败情况：";
                if (!redata.result || !redata.result.rule_check_result) {
                    failInfo += redata.error_msg;
                } else {
                    redata.result.rule_check_result.forEach(function(item) {
                        failInfo += item.rule_name + "->" + item.rule_status_toast + "<br>";
                    });
                }
                console.log(failInfo);
            }
        }

        console.log("进度：总共" + productTotal + "个，已提交" + submitCount + "个，成功" + successCount + "个");
        infoDiv.textContent = "进度：总共" + productTotal + "个，已提交" + submitCount + "个，成功" + successCount + "个";
    }

    async function mainFun(spu_id_list, options){
        const photoGroups = options && options.photoGroups ? options.photoGroups : await ensurePhotoSourceReady();
        if (!photoGroups || photoGroups.length === 0) {
            infoDiv.textContent = "没有可提交的实拍图";
            return;
        }
        const ignorePanelInputs = !!(options && options.ignorePanelInputs);
        let skcIdArr = [];
        let spuIdArr = [];
        if(!ignorePanelInputs){
            const skcInput = document.getElementById("skcIdStr");
            if(skcInput && skcInput.value) skcIdArr = parseIdList(skcInput.value);
            const spuInputElement = document.getElementById("spuIdStr");
            if(spuInputElement && spuInputElement.value) spuIdArr = parseIdList(spuInputElement.value);
        }
		
        if(!spu_id_list || spu_id_list.length==0){
            spu_id_list = [];
        } else {
            spu_id_list = parseIdList(spu_id_list.join("\n"));
        }

        const directSpuIds = spu_id_list.length > 0 ? spu_id_list : (skcIdArr.length === 0 ? spuIdArr : []);
        const baseBody = {
            goods_status_list: [1, 2]
        };
        if (cateId && directSpuIds.length === 0) {
            baseBody.cate_id_list = [cateId];
        }

        submitCount = 0;
        successCount = 0;
		realPictureList= [];

        try {
            realPictureList = await collectRealPictureProducts(baseBody, directSpuIds, skcIdArr);
        } catch (e) {
            console.error(e);
            infoDiv.textContent = e.message || "查询商品失败";
            alert(e.message || "查询商品失败");
            return;
        }

        if (!realPictureList.length) {
            infoDiv.textContent = "没有找到可提交的商品";
            alert("没有找到可提交的商品，请检查SPU或筛选状态");
            return;
        }

        for (let indexProduct = 0; indexProduct < realPictureList.length; indexProduct++) {
            await submitRealPictureProduct(realPictureList[indexProduct], photoGroups, realPictureList.length);
            if (indexProduct < realPictureList.length - 1) {
                await sleep(2500);
            }
        }
    }
    function checkComplianceStatus(wait_task_show_dtolist){
        let isOK = false;
		for(let wait_task_show of wait_task_show_dtolist){
            //console.log(wait_task_show.show_name, wait_task_show.status,wait_task_show.show_name=="制造商属性",wait_task_show.status==3)
            if(wait_task_show.show_name=="制造商信息"){
                isOK=(wait_task_show.status==3)
				return isOK;
            }
        }
        return isOK;
    }
})();
