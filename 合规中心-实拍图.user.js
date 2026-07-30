// ==UserScript==
// @name         合规中心-实拍图-自改版
// @namespace    https://www.goldabcd.com/
// @description  合规中心-实拍图（自改版，无需下载器EXE，使用模板SPU图片URL提交）
// @author       TonyTonyYang
// @match        https://agentseller.temu.com/govern/compliant-live-photos*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%AE%9E%E6%8B%8D%E5%9B%BE.user.js
// @updateURL    https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%AE%9E%E6%8B%8D%E5%9B%BE.user.js
// @version      2026.0730.2
// ==/UserScript==

const REAL_PHOTO_CONFIG_KEY = "goldabcd_noexe_real_photo_config_v1";
const REAL_PHOTO_SPU_INPUT_KEY = "goldabcd_noexe_real_photo_spu_input_v1";
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
    if (!hasTemplateSpu(templateSpuMap)) {
        return {
            success: false,
            msg: "未配置实拍图模板SPU。请在脚本菜单打开“实拍图自改版：编辑模板SPU配置”，填写如 {\"全部分类\":\"123456789\"}"
        };
    }
    return { success: true, data: templateSpuMap };
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
        normalized[String(name).trim() || "全部分类"] = spuId;
    });
    if (!Object.prototype.hasOwnProperty.call(normalized, "全部分类")) normalized["全部分类"] = "";
    return normalized;
}

function hasTemplateSpu(templateSpuMap) {
    return Object.keys(templateSpuMap || {}).some(function(key) {
        return String(templateSpuMap[key] || "").trim();
    });
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

function registerRealPhotoConfigMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("实拍图自改版：编辑模板SPU配置", async function() {
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
    const currentText = JSON.stringify(config.templateSpuMap, null, 2);
    const nextText = prompt("填写分类到模板SPU的JSON，例如：\n{\"全部分类\":\"123456789\",\"女装\":\"987654321\"}", currentText);
    if (nextText == null) return;
    let parsed;
    try {
        parsed = JSON.parse(nextText);
    } catch (e) {
        alert("JSON格式错误：" + e.message);
        return;
    }
    const normalized = await saveRealPhotoConfig({ templateSpuMap: parsed });
    if (!hasTemplateSpu(normalized.templateSpuMap)) {
        alert("已保存，但还没有填写任何模板SPU ID");
        return;
    }
    alert("已保存，刷新页面后生效");
}

function showRealPhotoSetupTip(message) {
    const tip = document.createElement("div");
    tip.style = "z-index:9999;position:fixed;top:80px;left:20px;width:360px;background:#fff7d6;color:#111;border:1px solid #f59e0b;border-radius:8px;padding:10px;font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.18);";
    tip.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">合规中心-实拍图-自改版</div><div style="margin-bottom:8px;"></div>';
    tip.children[1].textContent = message;
    const button = document.createElement("button");
    button.textContent = "配置模板SPU";
    button.style = "height:28px;background:#fb7701;color:#fff;border:0;border-radius:6px;padding:0 10px;cursor:pointer;";
    button.onclick = async function() {
        await openRealPhotoConfigPrompt();
    };
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
    for (const [cat_name, spu_id] of cat_spu_map) {
        selectSPUModel.appendChild(new Option(cat_name+"-->模板SPU：" + spu_id, cat_name));
    }

    // 创建容器
    let container = document.createElement("div");
    container.id = "workarea";
    container.style="z-index:9999;position: absolute;top: 30px;left: 0px;min-width: 400px;background-color: lightgreen;padding: 5px;display:none;";

    const pTitle = document.createElement("p");
    pTitle.textContent = "刷实拍图";
    pTitle.style="text-align: center;";
    container.appendChild(pTitle);

    const divSelect = document.createElement("div");
    divSelect.style="width:100%;display: ruby;margin: 5px;";
    const pTip = document.createElement("div");
    pTip.textContent="产品类型：";
    divSelect.appendChild(pTip);
    divSelect.appendChild(selectSPUModel);
    container.appendChild(divSelect);

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
    spuInputLabel.textContent = "指定SPU：";
    spuInputLabel.style = "margin-bottom:4px;";
    const spuInput = document.createElement("textarea");
    spuInput.id = "spuIdStr";
    spuInput.placeholder = "一行一个SPU，也支持逗号、空格分隔";
    spuInput.value = localStorage.getItem(REAL_PHOTO_SPU_INPUT_KEY) || "";
    spuInput.style = "display:block;width:390px;height:90px;box-sizing:border-box;resize:vertical;margin-bottom:6px;padding:6px;border:1px solid #999;border-radius:6px;font-size:12px;";
    spuInput.addEventListener("input", function() {
        localStorage.setItem(REAL_PHOTO_SPU_INPUT_KEY, spuInput.value);
    });
    divSpuInput.appendChild(spuInputLabel);
    divSpuInput.appendChild(spuInput);
    container.appendChild(divSpuInput);

    const divModelInput = document.createElement("div");
    divModelInput.style="width:100%;display:flow-root;";
    const buttonSubmit = document.createElement("button");
    buttonSubmit.onclick = async function(){await mainFun(null, {ignorePanelInputs: true})};
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
        await mainFun(spu_id_list, {ignorePanelInputs: true});
    };
    buttonSubmitInput.textContent = "按输入SPU提交";
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
        await mainFun(spu_id_list, {ignorePanelInputs: true});
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

    selectSPUModel.onchange=updateSpu;
    selectSPUModel.dispatchEvent(new Event('change', { bubbles: true }));

    let label_image_list;
    async function updateSpu(){
        let spuId = cat_spu_map.get(selectSPUModel.value)+"";
        let listData = await postTemu("https://agentseller.temu.com/api/flash/real_picture/list", {page:1,page_size:10,spu_id_list:[spuId]});

        if (!listData.success || !listData.result.items || !listData.result.items.length > 0) {
            console.log("参考模板数据-缺少实拍图，模板SPU：" + selectSPUModel.value);
            return;
        }

        label_image_list = listData.result.items[0].label_image_list;
        //inputZhuTi.value=listData.result.items[0].label_image_list[0].image;
        //inputWaiBaoZhuang.value=listData.result.items[0].label_image_list[1].image;

        if (defaultName == selectSPUModel.value) {
            cateId = null;
        } else {
            let searchForChainSupplierData = await postTemu("https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier", { pageNum: 1, pageSize: 50, supplierTodoTypeList: [], productSpuIdList: [spuId] });
            cateId = searchForChainSupplierData.result.dataList[0].catIdList[0];
        }
    }

    let lastKeyPressTime = 0;
    //双击ctrl自动触发
    document.addEventListener('keydown', function(event) {
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastKeyPressTime;

        // 检查是否是Ctrl键，并且两次按键时间间隔小于阈值
        if ((event.key === 'Control' || event.keyCode === 17) && timeDiff > 150 && timeDiff < 300) {
            console.log("双击Ctrl："+timeDiff)
            if(container.style.display=="block"){
                container.style.display = "none";
            } else {
                container.style.display = "block";
            }

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

    async function mainFun(spu_id_list, options){
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

        page_num = 1;
        total = 100;
        submitCount = 0;
        successCount = 0;
		realPictureList= [];
        //while(total>(page_num-1)*page_size){
		while(total>(page_num-1)*page_size && (page_num-1)*page_size<TOPCOUNT){
            //if((page_num-1)*page_size>300) break;
            //console.log("开始：",total,page_num,page_size)
            let realPictureListBody = {
                page:page_num,
                page_size,
                goods_status_list: [1, 2]//商品状态：1在售、2未发布到站点
                //cate_id_list:[31022]//商品分类
            }
            if(cateId){
                realPictureListBody.cate_id_list=[cateId];
            }

            if(skcIdArr.length>0 || spuIdArr.length>0 || spu_id_list.length>0){
                if(skcIdArr.length>0){
                    realPictureListBody.skc_id_list=skcIdArr;
                } else if(spuIdArr.length>0){
                    realPictureListBody.spu_id_list = spuIdArr;
                } else if(spu_id_list.length>0){
                    realPictureListBody.spu_id_list = spu_id_list;
                }
            } else {
                realPictureListBody.check_type_status_list=[Number(selectStatus.value)]//识别状态：1待传图、4图中标签有异常、5识别成功
            }

            let realPictureListData = await postTemu("https://agentseller.temu.com/api/flash/real_picture/list", realPictureListBody);
            if(!realPictureListData.success){
                console.log(realPictureListData.error_msg);
                infoDiv.textContent = realPictureListData.error_msg;
                return;
            }
            if(realPictureListData.result.total>0 && realPictureListData.result.items && realPictureListData.result.items.length>0){
                // console.log(realPictureListData.result.items)
                realPictureList.push(...realPictureListData.result.items);
            }

            total = realPictureListData.result.total;
            page_num++;

            infoDiv.textContent = "进度：总共"+total+"个，已扫描"+realPictureList.length+"个";

			if(realPictureList.length > 0 && (realPictureList.length>=total || (page_num-1)*page_size>=TOPCOUNT || total<=(page_num-1)*page_size)){//添加total<=(page_num-1)*page_size)，防止total与实际数量对不上
                let timeIndex=0;
                for(let indexProduct=0;indexProduct<realPictureList.length;indexProduct++){
                    let product = realPictureList[indexProduct];
                    // console.log(product)
                    if (!product.can_edit) {
                        console.log((indexProduct+1)+"，SPU‘" + product.spu_id + "’无法编辑");
                        continue;
                    }
                    if(!product.sku_info){
                        console.log((indexProduct+1)+"，SPU‘" + product.spu_id + "’商品异常或已被删除");
                        continue;
                    }
                    timeIndex++;

                    setTimeout(async function() {
                        let pageQueryData = await postTemu("https://agentseller.temu.com/ms/bg-flux-ms/compliance_property/page_query", {
                            page_num,
                            page_size,
                            type:2,
                            spu_id_list:[product.spu_id]
                        });
                        if(!pageQueryData.success){
                            console.log(pageQueryData.error_msg);
                            return;
                        }
                        if(pageQueryData.result.data.length<1){
                            console.log("没有找到SPU‘"+product.spu_id+"’的合规信息");
                            return;
                        }
                        if(!checkComplianceStatus(pageQueryData.result.data[0].wait_task_show_dtolist)){
                            console.log("SPU‘"+product.spu_id+"’的合规操作未完成");
                            return;
                        }
						
                        let preVerificationBody = {
                            spu_id:product.spu_id,
                            goods_id:product.goods_id,
                            real_picture_info_list:[
                                {
                                    "position":1,
                                    "is_same_sku":1,
                                    "sku_photo_info_list":[]
                                },
                                {
                                    "position":2,
                                    "is_same_sku":1,
                                    "sku_photo_info_list":[]
                                }
                            ]
                        };

                        for(let indexSKU=0;indexSKU<product.sku_info.length;indexSKU++){
                            let sku = product.sku_info[indexSKU];
                            
                            let image_list1=[],image_list2=[];
                            label_image_list.forEach((label_image)=>{
                                if(label_image.position==1){
                                    image_list1.push({image_url:label_image.image});
                                } else if(label_image.position==2){
                                    image_list2.push({image_url:label_image.image});
                                }
                            })
                            preVerificationBody.real_picture_info_list[0].sku_photo_info_list.push({
                                sku_id:sku.sku_id,
                                image_list:image_list1
                            });
                            preVerificationBody.real_picture_info_list[1].sku_photo_info_list.push({
                                sku_id:sku.sku_id,
                                image_list:image_list2
                            })
                        }

                        console.log("进度：总共"+total+"个，已提交"+(submitCount)+"个，成功"+successCount+"个，正在提交SPU：："+product.spu_id);
                        infoDiv.textContent = "进度：总共"+total+"个，已提交"+(submitCount)+"个，成功"+successCount+"个，正在提交SPU："+product.spu_id;
                        submitCount++;

                        let redata = await postTemu("https://agentseller.temu.com/api/flash/real_picture/pre_verification", preVerificationBody);

                        // 处理获取到的数据
                        if(redata.success && redata.result.check_result) {
                            successCount++;
                        } else {
                            preVerificationBody.confirm_type = 4;
                            redata = await postTemu("https://agentseller.temu.com/api/flash/real_picture/upload_new", preVerificationBody);
                            if(redata.success) {
                                successCount++;
                            } else {
                                let failInfo = product.spu_id + "失败情况：";

                                if (!redata.result || !redata.result.rule_check_result) {
                                    failInfo += redata.error_msg;
                                } else {
                                    redata.result.rule_check_result.forEach((item) => {
                                        failInfo += item.rule_name + "->" + item.rule_status_toast + "<br>";
                                    })
                                }
                                console.log(failInfo);
                            }
                        }

                        console.log("进度：总共"+total+"个，已提交"+(submitCount)+"个，成功"+successCount+"个");
                        infoDiv.textContent = "进度：总共"+total+"个，已提交"+(submitCount)+"个，成功"+successCount+"个";
                    }, 1000*2.5*timeIndex);//接口限制，不能太快提交；限制每2秒提交1个。
                }
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
