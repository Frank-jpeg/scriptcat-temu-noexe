# 上游脚本对比

本仓库的 5 个生命周期脚本 fork/改造自同事 TonyTonyYang 的脚本站，去掉了本地下载器依赖，改成单文件版。本文档记录上游现状和差异，方便以后同步。

**上游地址**：https://www.goldabcd.com/temu.html
**脚本目录**：`https://www.goldabcd.com/scriptcat/<脚本名>.user.js`
**对比时间**：2026-07-28

---

## 一、核心差异：本地端口版 vs 单文件版

上游脚本靠一个本地服务提供公共函数和配置：

```js
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @require      http://127.0.0.1:3000/js/public.js?v=4
```

`public.js` 里有 `getSkey` / `postTemu` / `postLocal`，配置也从 `LOCAL_SERVER + "/getConfig"` 拉（`theName: "全局设置"` / `"阶梯核价设置"`）。所以上游脚本必须先跑那个下载器 EXE。

本仓库版本把 `public.js` 内联，配置改成脚本内的可视化面板（`GM_getValue` / `GM_setValue`，键 `goldabcd_noexe_config_v1`），因此不需要下载器。这也是文件从 6~29 KB 涨到 93~130 KB 的原因。

关键兼容点：`postTemu` 用 `headers: { "mallid": mallId }` 指定目标店铺，改全局变量 `mallId` 就能对不同店铺发请求，不用切换页面。上下游机制一致。

---

## 二、4 个已 fork 脚本的差异

对比方法：提取上游全部函数名、接口路径、请求体字段、中文提示语，逐项在本仓库对应文件中检索。

| 脚本 | 上游版本 | 本仓库文件 | 函数缺口 | 字段缺口 |
|---|---|---|---|---|
| 上新生命周期-1-提交核价 | 2026.0611.3 | `temu-life-1-price.user.js` | **`rotatingQuote`** | 无 |
| 上新生命周期-2-开通JIT | 2026.0612.1 | `temu-life-2-jit.user.js` | 无 | 无 |
| 上新生命周期-3-增加库存 | 2026.0612.1 | `temu-life-3-stock.user.js` | 无 | 无 |
| 上新生命周期-4-确认商品信息 | 2026.0611.2 | `temu-life-4-confirm.user.js` | 无 | 无 |

未匹配到的接口路径全部属于本地端口版机制，不算功能缺失：

- `/js/public`、`/getConfig`、`/isInprocessing`、`/scriptcat/` —— 本地服务
- `/api/seller/auth/userInfo` —— 上游用它枚举账号下全部店铺，本仓库改为读配置面板的 `config.malls`

未匹配到的中文串经核对全是 `console.log` 调试输出（`"没有需要核价的商品"`、`"加库存成功"`、`")已被删除"` 等），以及上游本地配置相关的 `"全局设置"`。`PriceMultiple`（倍数）本仓库有，见 `temu-life-1-price.user.js`。

### 唯一的功能缺口：`rotatingQuote`（多店轮询）

上游 1-提交核价 独有，本仓库未实现：

```js
setInterval(rotatingQuote, 1000 * 5)          // 每 5 秒一轮

async function rotatingQuote() {
    if (isInprocessing) return;               // 互斥锁
    isInprocessing = true;

    let mall = mallList[currentMallIndex];
    mallId = mall.mallId;
    window.mallId = mallId;                   // 切换目标店铺
    isSemiHosted = mall.mallMode;             // 0 全托 / 1 半托

    if (globalSetting.isEnableRotatingQuote && mallList.length > 1) currentMallIndex++;

    getConfigData = await postLocal(LOCAL_SERVER + "/getConfig", { mallId, theName: "阶梯核价设置" });
    isSemiHosted ? await timerFunForSemi() : await timerFun();
}
```

店铺列表来自 `api/seller/auth/userInfo` 的 `result.mallList`，当前页面所在店铺会被挪到第一位。

三点注意：

1. `isEnableRotatingQuote` 开关控制的不是"是否轮询"，而是"是否前进"。关掉时 `currentMallIndex` 不递增，定时器照跑但永远停在 `mallList[0]`。
2. 上游有个隐患：`rotatingQuote` 末尾的 `isInprocessing = false` 是注释掉的，解锁动作在 `timerFun` 内部。若 `timerFun` 某条分支提前 return 而未解锁，轮询会永久卡死。
3. 若要移植到本仓库，`postTemu` 的 `mallid` 请求头机制已兼容，只需补：店铺列表来源（抄 `userInfo` 接口，或用配置面板已有的 `config.malls`，字段 `mallId`/`mallName`/`isSemiHosted` 结构对得上）、轮询调度与互斥锁、面板开关。

### 本仓库反而多出的功能

`temu-life-4-confirm.user.js` 有上游 4-确认商品信息 没有的接口：

```
lich-mms/audit/edit/task/product/batchAdd
lich-mms/audit/edit/task/product/pageQuery
visage-agent-seller/product/edit/task/reply
```

### 对比方法的局限

上述比对覆盖函数名、接口路径、请求体字段、中文提示语四个维度。若上游在已有函数内部改动了纯数值逻辑（核价系数、重试次数判断等），这套方法检测不到。需要彻底确认时应逐行精读 `timerFun` / `timerFunForSemi`。

---

## 三、上游有、本仓库未 fork 的生命周期脚本

| 脚本 | 版本 | 大小 |
|---|---|---|
| 上新生命周期-1-拒绝核价（全托+半托） | 2026.0331.1 | 14 KB |
| 上新生命周期-1-单次核价（全托+半托） | 2026.0528.1 | 20 KB |

两者版本日期均早于本仓库 fork 时间，属于当初未取，而非上游新增。

---

## 四、上游全部脚本清单（35 个）

按版本日期倒序。生命周期系列自本仓库 fork 后未再更新，上游近期改动集中在上架、合规、采集三块。

| 版本 | 脚本 | 说明 |
|---|---|---|
| 2026.0727.1 | 销售管理-备货商品销售记录 | |
| 2026.0727.1 | 商品列表-上架商品-创建模板 | 全托+半托 |
| 2026.0727.1 | 商品列表-半托上架商品 | 半托 |
| 2026.0727.1 | **合规中心-商品合规-自动版** | 全托+半托，已 fork 为 `temulife5-自动商品合规.user.js` |
| 2026.0725.1 | 商品列表-快速更新商品图片-只更新指定图片 | |
| 2026.0724.1 | 媒体平台图片采集-精准采集-Temu | |
| 2026.0709.1 | 全局-重要数据监控 | |
| 2026.0701.1 | 商品列表-上架商品-动态SKU | 全托，用于上架采集的商品，SKC 图片数量与 SKU 不固定 |
| 2026.0621.1 | 我的备货单-获取订单数据 | |
| 2026.0620.1 | 营销活动(全部)-自动报名-全托管 | |
| 2026.0617.1 | 商品列表-上架商品-多并发 | 全托 |
| 2026.0612.2 | 合规中心-实拍图-自动版 | 全托+半托 |
| 2026.0612.1 | **上新生命周期-3-增加库存** | 全托+半托，已 fork |
| 2026.0612.1 | **上新生命周期-2-开通JIT** | 已 fork |
| 2026.0611.3 | **上新生命周期-1-提交核价** | 全托+半托，已 fork |
| 2026.0611.2 | **上新生命周期-4-确认商品信息** | 全托+半托，已 fork |
| 2026.0611.1 | 合规中心-实拍图 | 全托+半托 |
| 2026.0610.1 | 商品广告-自动化控制广告ROAS | 全托 |
| 2026.0609.1 | 商品广告-自动报广告 | 全托 |
| 2026.0607.1 | 合规中心-商品合规 | 全托+半托 |
| 2026.0528.1 | 上新生命周期-1-单次核价 | 全托+半托，未 fork |
| 2026.0518.2 | 销售管理-修改期望到货区域 | |
| 2026.0517.1 | 媒体平台图片采集-Pinterest | |
| 2026.0514.1 | 合规中心-包装清单与清关属性维护 | |
| 2026.0507.1 | 营销活动(单个)-自动报名-半托管 | |
| 2026.0331.1 | 上新生命周期-1-拒绝核价 | 全托+半托，未 fork |
| 2026.0314.2 | 商品列表-批量设置定制区域 | |
| 2026.0307.1 | 商品列表-批量替换标题中的指定文本 | |
| 2026.0302.1 | 媒体平台图片采集-小红书 | |
| 2026.0302.1 | 媒体平台图片采集-Temu | |
| 2026.0228.2 | 首页-批量下架简易版 | |
| 2026.0111.1 | 首页-全店批量下架 | |
| 2025.1115.1 | 商品列表-快速更新商品图片 | |
| 2025.1114.1 | 商品广告-半托自动报广告 | |
| （无版本号） | 营销活动(单个)-自动报名-全托管 | |

---

## 五、以后怎么重新对比

```bash
# 1. 抓取脚本列表
curl -sL https://www.goldabcd.com/temu.html -o /tmp/temu.html
grep -oE 'href="https://www\.goldabcd\.com/scriptcat/[^"]+\.user\.js"' /tmp/temu.html \
  | sed 's/href="//;s/"$//' | sort -u > /tmp/urls.txt

# 2. 下载并列出版本
mkdir -p /tmp/upstream && cd /tmp/upstream
while read -r u; do curl -sL "$u" -o "$(basename "$u")"; done < /tmp/urls.txt
for f in *.user.js; do
  printf "%s\t%s\n" "$(grep -m1 '@version' "$f" | awk '{print $NF}')" "$f"
done | sort -r

# 3. 与本仓库对比（以 2-开通JIT 为例）
#    提取上游函数名，逐个在本仓库文件中检索
grep -ohE "(async )?function [a-zA-Z_][a-zA-Z0-9_]*" "上新生命周期-2-开通JIT.user.js" \
  | awk '{print $NF}' | sort -u | while read -r fn; do
    grep -q "\b$fn\b" "temu-life-2-jit.user.js" || echo "缺少函数: $fn"
  done
```

上游 `@version` 可以信（对方按日期规范维护），本仓库 `@version` **不可信**（fork 后自行改过，与上游日期无对应关系）。判断是否落后，看代码而非版本号。
