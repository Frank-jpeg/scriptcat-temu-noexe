# TEMU实拍图直传-自改版批量版 · 说明

> **本文档只对应 `temu实拍图直传自改版批量版.user.js` 一个脚本。**
>
> 仓库里另有一个 `合规中心-实拍图-自改版.user.js`，两者都做「实拍图」，但**用的是完全不同的 TEMU 接口，不能互相套用代码或结论**。改任何一个之前，先确认你在改哪个。

---

## 一句话

把**一组固定的标签图**，批量套用到**你指定的一批 SPU** 上。图片只上传一次，一次提交 50 个 SPU。

---

## 和 `合规中心-实拍图-自改版.user.js` 的区别

|  | 本脚本（批量版） | 合规中心-实拍图-自改版 |
|---|---|---|
| 提交接口 | `real_picture/batch_upload` | `real_picture/upload_new` |
| 一次提交 | **50 个 SPU** | 1 个 SPU |
| 请求体 | 扁平 `upload_image_list` | 嵌套 `real_picture_info_list` |
| 需要 `sku_id` | **不需要** | 需要（每个 SPU 都要查） |
| 需要 `cate_id_list` | **需要** | 不需要 |
| 图片来源 | 本地选图，上传一次 | 本地选图 / 模板 SPU 复制 |
| 5000 个商品 | 约 254 次请求 | 5000+ 次请求 |
| 预校验 | 无 | 有 `pre_verification` |

**选哪个：** 要给一大批 SPU 刷同一组图 → 本脚本。要按类目用不同模板、或需要预校验 → 那个。

---

## 适用范围

**能做：** 给指定 SPU 清单批量设置**标签图**（`position_type = 2`），支持「商品主体实拍图」和「商品外包装实拍图」两个区块。

**不能做：**

- 正视图 / 侧视图 / 其他图 —— 这些槽位的 `position_type` 值**未知**，见下方「未验证」
- 说明书（position 3）、EU DOC（position 5）
- 每个 SPU 用不同的图（本脚本是同一组图套用到全部）

**生效页面：** `/govern/compliant-live-photos`、`/govern/dashboard`（改脚本里的 `ALLOW_PATHS`）

---

## 面板怎么用

平时**收在屏幕右边缘**，只露一条竖标签「实拍图」。三种开合方式：点竖标签、标题栏的 ×、**双击 Ctrl**。开合状态存 localStorage，刷新后保持；从未设置过则默认收起。

跑任务时竖标签会转绿呼吸闪烁——收起状态下也能看出还在跑。

流程：粘 SPU → 选图（主体标签图 / 外包装标签图，各自可多选）→ **先「试运行（不提交）」** 核对请求体和类目路径 → 再「开始提交」。

跑完面板底部会出现一份**可复制的问题 SPU 清单**，分三组：

- 提交失败（建议重跑）
- 没查到类目（建议重跑）
- 未命中：不在实拍图待办里，重跑也不会成功

分组标题是 `#` 开头的注释行，而 SPU 解析只认纯数字，所以**整段原样粘回输入框即可重跑**，注释会被自动忽略。

---

## 接口链路

全部同源 `https://agentseller.temu.com`，走浏览器 cookie（`credentials: include`）。

### 1. 查商品 · `POST /api/flash/real_picture/list`

```
headers  Content-Type: application/json
         Mallid: <店铺ID>            ← 少了这个直接 403
body     {page:1, page_size:50, page_version:1, spu_id_list:["字符串SPU", ...]}
resp     {error_code:1000000, success:true,
          result:{total, items:[{spu_id, goods_id, spu_name, sku_info, ...}]}}
```

- `page_size` **最大 50**，填 100 返回 `error_code 1000006 系统异常`
- `spu_id_list` 里是**字符串**，不是数字
- `spu_id_list` **不能太长**，50 可以，1161 会让服务端不响应（详见「坑」）
- 不带 `spu_id_list` 就是查全部待办，`result.total` 是店铺待办总数

### 2. 取图床签名 · `POST /ms/bg-flux-ms/compliance_property/signature`

```
headers  Content-Type: application/json, Mallid
body     {tag: "flash-tag"}
resp     {success:true, result:{signature: "..."}}
```

**签名是一次性的**，用过即废。每张图都要重新取一次。

### 3. 上传图片 · `POST /api/galerie/v3/store_image?sdk_version=js-0.0.37&tag_name=flash-tag`

```
FormData  url_width_height = "true"
          image            = <File>
          upload_sign      = <上一步的签名>   ← 少了这个 401
resp      含 https://pos.file.temu.com/flash-tag/... 的图片地址
```

不需要 `Mallid`，也不需要 `anti-content`。图片单张 **≤ 3MB**。

### 4. 查类目 · `POST /api/kiana/mms/robin/searchForChainSupplier`

```
headers  Content-Type: application/json, Mallid
body     {productSpuIdList:[数字SPU, 最多100], pageNum:1, pageSize:100, supplierTodoTypeList:[]}
resp     {result:{dataList:[{productId, catIdList:[一级, 二级, ..., 叶子]}]}}
```

⚠ 这个接口族用**驼峰** `errorCode`，不是 `error_code`。

### 5. 提交 · `POST /api/flash/real_picture/batch_upload`

```
headers  Content-Type: application/json, Mallid
body     {
           confirm_type: 4,
           spu_ids: [数字SPU, 最多50],
           batch_upload_task_type: 1,
           cate_id_list: [单个类目ID],          ← 一次只能带一个类目
           upload_image_list: [
             {position: 1, position_type: 2, image: "图片URL"},
             {position: 2, position_type: 2, image: "图片URL"}
           ]
         }
```

因为 `cate_id_list` 一次只能带一个类目，脚本必须**先按类目分组，再按 50 切批**。

---

## 相关但本脚本没有用的能力

**这一节记的是「存在、已确认、但我们没实现」的东西**，免得下次有人以为不支持而重新去挖。

### 按识别状态筛选 · `check_type_status_list`

`real_picture/list` 支持这个字段，等价于页面上的「识别状态」筛选器：

| 值 | 含义 |
|---|---|
| 1 | 待传图 |
| 4 | 图中标签有异常 |
| 5 | 识别成功 |

同仓库的 `合规中心-实拍图-自改版` 用它做「按状态提交」——**不给 SPU 清单**，直接翻页扫出该状态下的全部商品（它自己设了 `TOPCOUNT = 5000` 的上限）一次刷完。

本脚本只做「按指定 SPU 清单」。要加这个能力，就是多一个下拉 + 把 `spu_id_list` 换成 `check_type_status_list`。

### 提交前的合规门禁 · `compliance_property/page_query`

```
POST /ms/bg-flux-ms/compliance_property/page_query
     {page_num:1, page_size, type:2, spu_id_list:[...]}
  → result.data[].wait_task_show_dtolist = [{show_name, status}, ...]
```

`合规中心-实拍图-自改版` 用它检查 `show_name == "制造商信息"` 的 `status` 是否为 `3`（已完成），不是就跳过该 SPU——制造商信息没填完的商品，实拍图传上去也过不了审，白传。

注意 `spu_id_list` 是**数组**，可以批量查，不必像那个脚本一样逐个。

本脚本没做这层检查（使用者明确表示不需要）。

### `can_edit` 字段

`list` 响应里每个 item 都带 `can_edit`。为 `false` 表示商品被锁定或审核中，传了也是白传。**不用多发任何请求**就能筛掉。

本脚本目前没检查这个字段。

---

## 参数含义

### `position` —— 哪个区块

| 值 | 含义 |
|---|---|
| 1 | 商品主体实拍图 |
| 2 | 商品外包装实拍图 |
| 3 | 说明书 |
| 5 | EU DOC |

三方交叉确认：真实抓包、佳同插件的四个数组、`list` 响应里的 `position_detail: [1,2,3,5]`。

### `position_type` —— 区块内的槽位

| 值 | 含义 | 依据 |
|---|---|---|
| 2 | 标签图 | 真实抓包确认 |
| ? | 正视图 / 侧视图 / 其他图 | **未知** |

### `cate_id_list` —— 商品类目

推测是告诉后端「用哪套合规规则校验这批图」—— `list` 响应里的规则清单（欧盟纺织品标签、GPSR、土耳其标签…）都是按类目定的。

脚本逐个查出真实类目再分组，不会张冠李戴。查不到类目的 SPU 会**跳过**（宁可不传，不拿瞎猜的类目提交）。

---

## 踩过的坑

| 症状 | 原因 | 解法 |
|---|---|---|
| `403 No Permission to Access`（code 400020037） | 缺 `Mallid` 请求头 | 从 `localStorage['agentseller-mall-info-id']` 取 |
| `401` | `store_image` 缺 `upload_sign` | 先调 signature 接口 |
| `401 The signature already used` | 签名一次性，被复用了 | 每张图单独取签名，别提到循环外 |
| `code=undefined`，类目查询失败 | `/api/kiana/*` 用驼峰 `errorCode` | 校验时两种命名都认 |
| `page_size=100` 返回系统异常 | 硬上限就是 50 | 别调大 |
| 佳同卡在「获取列表数据中」不动 | `spu_id_list` 塞了 1161 个，服务端不响应 | 50 一批 |

### 关于 `anti-content`

TEMU 页面自己发请求时带 `anti-content`（反爬 token，由它的 JS 生成）。**但接口不强制要求** —— 本脚本和佳同插件都不发，一样能通。

如果哪天开始 403 且 `Mallid` 没问题，优先怀疑 TEMU 加严了这个校验。届时本脚本这条路基本走不通。

**退路是现成的**：另有一个「借佳同插件的口」的脚本——不自己发请求，而是把 SPU 清单写进插件读取的 `localStorage["temu_compliance_liveImg_requestBody"]` 的 `spu_id_list` 字段，再触发插件自己的按钮（`#jtyt-cj-realPhoto-btn1`），由插件完成上传。因为请求是插件发的，不受这里的限制。

代价：`spu_id_list` 一长服务端就不响应（50 可以、1161 会挂），所以只能分批；而且每批都要在插件弹窗里重新传一次图。

该脚本**未纳入本仓库**，在维护者本地：`E:\claude项目\temu-实拍图-指定SPU.user.js`。

---

## 未验证的假设

**下面这些是推测或未测项，不要当成已确认的事实。**

### 1. `cate_id_list` 是否必需 —— 无答案

从没测过「不传会怎样」。保留它的理由是：佳同宁可多分批也要按类目分组，这是**有成本**的做法，不像白做的。

想验证就拿 1 个 SPU 分别试：不带 / 空数组 / 正确类目，对比返回。

### 2. `catIdList` 取哪一级 —— 取叶子，实测可用但存在分歧

- 本脚本和佳同：取 `catIdList[length-1]`（叶子）
- `合规中心-实拍图-自改版`：取 `catIdList[0]`（一级）

取叶子跑通了 390 个商品全部成功，但**没有和抓包数据做过位置对照**。两份实现不一致这件事本身值得留意。

### 3. 半托管店铺 —— 未测

`searchForChainSupplier` 是全托管的接口。半托管可能要换成 `searchForSemiSupplier`（佳同插件里两个都有）。

`list` 响应的 `result.is_semi_managed_mall` 字段可以用来判断。

### 4. 其他槽位的 `position_type` —— 未知

只确认了标签图 = 2。要支持正视图/侧视图，得手动在 TEMU 页面往那个槽位传一张图，抓 `batch_upload` 请求看 `position_type` 的值。

---

## 实测数据

| 规模 | 结果 |
|---|---|
| 1 个 SPU | 全链路通过 |
| 390 个 SPU | 8 个提交批次（= 390÷50，同类目），**全部成功，0 失败** |
| 每商品图片数 | 两个区块各 2 张标签图，`upload_image_list` 共 4 条——后端接受同一 position 放多张 |
| 5000 个 SPU | 预估约 254 次请求：图片 4 + 查商品 100 + 查类目 50 + 提交 100 |

并发 `CONCURRENCY = 4`，实测未触发 429。调大能更快，但 429 退避一次是 20~30 秒，不划算。

---

## 资料来源

1. **真实抓包** —— `list` / `batch_upload` / `store_image` 的完整请求，确定了字段名和 `position` 语义
2. **佳同跨境-TEMU店铺助手（v3.8.1）逆向** —— 插件的 `main.js` 混淆后解出，`batch_upload` 的分批策略、限流退避参数来自这里。

   解混淆产物已删除。要重来的话方法很简单（插件用 javascript-obfuscator 混淆，三步就能读）：

   1. `\uXXXX` / `\xXX` 转义还原成明文 —— **中文字符串是明文的**，还原后直接能搜到功能名
   2. `"abc".split("").reverse().join("")` 这类反转字符串还原
   3. `0xAAAA^0xBBBB` 常量异或折叠成十进制

   做完这三步，接口地址、请求体字段、中文提示语全部可读；变量名仍是 `_0x1a2b3c` 那种（混淆时已丢弃，恢复不了），但不影响读逻辑。

   插件目录：`C:\Users\Lan\Downloads\佳同temu插件381-0725-2-无需解压直接拖入\`，
   主要看 `main.js`（3.4MB）、`temu.js`、`background.js`。
3. **`合规中心-实拍图-自改版.user.js`** —— 同仓库，`searchForChainSupplier` 和 signature 两个接口是从它这里确认的

---

## 改动须知

**改完必须提高脚本头部的 `@version`**，否则 ScriptCat / 油猴不会拉更新。这是本仓库的规矩，见 `AGENTS.md`。

`@updateURL` / `@downloadURL` 必须指向 `Frank-jpeg/scriptcat-temu-noexe`。

提交前跑一遍：

```bash
find . -name '*.user.js' -print0 | xargs -0 -n1 node --check
```
