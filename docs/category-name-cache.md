# 类目名称查询与缓存

生命周期 8 保持单文件、`@grant none`，不附带全站类目库。

## 查询过程

1. 精确查询代表 SPU：`POST /api/kiana/mms/robin/searchForChainSupplier`，请求使用 `productSpuIdList:[数字SPU]`。严格检查返回商品 ID，并取 `catIdList` 最后一项作为目标类目、倒数第二项作为父级。
2. 商品响应已提供完整 `catNameList` 时直接显示；否则先检查该店铺名称缓存。
3. 缓存未命中时请求 `POST /anniston-agent-seller/category/children/list`，请求体 `{parentCatId:父级ID}`；一级类目用 `{}`。这是“查子级”接口，并非“按 ID 查详情”。
4. 在 `result.categoryNodeVOS` 中同时精确匹配 `catId` 与 `parentCatId`，取 `catName`。只缓存目标类目，不存整批子级，不遍历全树。

首次通常为一次 SPU 查询加一次名称查询；之后仍校验 SPU，但同类目名称直接读缓存。名称接口异常、缺字段、未匹配或重复匹配均显示原因，保留已经确认的商品类目 ID，允许备注和保存；失败不缓存，下次手动查询可重试。不因名称失败扫描全店或猜测其他类目。

名称仅用于显示；规则仍按区域列表返回的 `leafCatId` 精确匹配，不扩展上级类目、不改动区域写入。

## 保存与旧规则

名称缓存在 `goldabcd_category_names_v1:<mallId>`，内容为 `{类目ID:{name,parentId}}`。只缓存实际查到的类目，刷新恢复，没有定时过期。父级与新商品响应不一致时不复用旧缓存。缓存保存失败会提示，本页面查询结果仍可使用。

业务规则继续保存在原来的 `goldabcd_category_area_v1:<mallId>`；备注、SPU、到货区域及启用状态保持。已有缓存可在加载时补全旧规则名；没有缓存的旧规则通过“编辑 → 查询类目 → 保存规则”补名，不会在页面加载时自动逐条发请求。名称与父级路径分开：名称接口只补末级名称，不为了展示完整路径逐级发额外请求。

## 实际验证

2026-09-30 在已登录 TEMU 页面只读查询，响应 `success:true`：

```json
{"parentCatId":30972}
```

返回列表包含：

```json
{"catId":30977,"catName":"旅行包、行李包","catLevel":3,"parentCatId":30972,"isLeaf":true}
```

用户提供的参考快照 `G:\2026-09-30-16-43-14\temu-全站类目树.json` 保持不变；已校验 3,980,447 字节、45,236 个唯一 ID、8 层和 37,473 个末级，父子关系及末级标记无冲突。原始 SHA-256 为 `98b0644fa01fda0ff20800763ca3bb6f0e11a9018e4fe39eca894fd1bf0e3133`。它用于交叉核对，不参与脚本运行或发布。

`34859` 是第 6 层“帽子”，父级是 `34857`；`34856` 是第 4 层“男士运动休闲服装配饰”。`30977` 是第 3 层的末级“旅行包、行李包”，末级并不一定是第 8 层。`3022925` 未在快照中找到。

验证命令：`node --test tests/category-area.test.cjs tests/category-names.test.cjs`；模拟 UI：`node tests/category-area-ui.cjs`。尚未在真实脚本管理器安装新版，未提交真实到货区域修改。
