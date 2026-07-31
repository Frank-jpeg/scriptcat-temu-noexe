# ScriptCat TEMU NoEXE Scripts

TEMU ScriptCat 自改版脚本，去掉本地下载器依赖，并支持 GitHub raw 自动更新。

当前仓库：`Frank-jpeg/scriptcat-temu-noexe`

## 安装地址

- 1 提交核价: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-1-price.user.js
- 2 开通JIT: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-2-jit.user.js
- 3 增加库存: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-3-stock.user.js
- 4 确认商品信息: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-4-confirm.user.js
- TEMU商品信息抓取下载: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%95%86%E5%93%81%E4%BF%A1%E6%81%AF%E6%8A%93%E5%8F%96%E4%B8%8B%E8%BD%BD.user.js
- TEMU商品列表导出: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%95%86%E5%93%81%E5%88%97%E8%A1%A8%E5%AF%BC%E5%87%BA.user.js
- TEMU单店巡查脚本: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%8D%95%E5%BA%97%E5%B7%A1%E6%9F%A5%E8%84%9A%E6%9C%AC.user.js
- Temu 销售管理备货计算: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/Temu%E9%94%80%E5%94%AE%E7%AE%A1%E7%90%86%E5%A4%87%E8%B4%A7%E8%AE%A1%E7%AE%97.user.js
- 合规中心-实拍图-自改版: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/%E5%90%88%E8%A7%84%E4%B8%AD%E5%BF%83-%E5%AE%9E%E6%8B%8D%E5%9B%BE-%E8%87%AA%E6%94%B9%E7%89%88.user.js
- TEMU实拍图直传-自改版批量版: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu%E5%AE%9E%E6%8B%8D%E5%9B%BE%E7%9B%B4%E4%BC%A0%E8%87%AA%E6%94%B9%E7%89%88%E6%89%B9%E9%87%8F%E7%89%88.user.js

以后修改脚本时提高 `@version` 并推送到 GitHub，ScriptCat 的“检查更新”即可更新。

## 维护发布

本地维护目录：`/Users/mini/Desktop/codex项目/TEMU 脚本`

Git 远程使用 SSH：

```bash
git@github.com:Frank-jpeg/scriptcat-temu-noexe.git
```

发布新版时：

1. 修改对应 `.user.js`。
2. 提高脚本头部的 `@version`。
3. 如果脚本内还有 `NOEXE_UI_VERSION` 或 `SCRIPT_VERSION`，同步改成同一版号。
4. 确认 `@updateURL` 和 `@downloadURL` 指向 `Frank-jpeg/scriptcat-temu-noexe`。
5. 提交并推送到 `main`。
6. 用新 raw 地址和旧 raw 地址各测试一次，确认旧地址仍能重定向到新仓库。

旧仓库地址 `jianpanlan0-svg/scriptcat-temu-noexe` 已转移到 `Frank-jpeg/scriptcat-temu-noexe`。不要在旧账号重新创建同名仓库，否则旧用户的自动更新重定向可能失效。

### 版本号格式：不要统一

本仓库并存两套 `@version` 格式，这是刻意保留的：

| 脚本 | 格式 | 示例 |
|---|---|---|
| `temu-life-*` 四个生命周期脚本 | 日期式（继承自上游） | `2026.0704.2` |
| 其余自写脚本 | 语义式 | `4.30.0`、`8.5.1`、`1.9.7` |

ScriptCat 靠比较 `@version` 大小决定是否更新。若把日期式改成语义式（如 `2026.0704.2` → `1.0.0`），会被判定为**降级**，不仅当次不更新，之后也再升不上去（除非版本号始终大于 `2026.x`）。

版本比较只在同一个脚本内部进行，跨脚本不比较。两套格式并存不影响任何功能。

## 上游对比

4 个生命周期脚本 fork 自 https://www.goldabcd.com/temu.html ，去掉了本地下载器依赖。上游现状、差异清单和重新对比的方法见 [UPSTREAM.md](UPSTREAM.md)。

注意本仓库的 `@version` 与上游日期无对应关系，判断是否落后要看代码，不能看版本号。

## 配置说明

脚本默认配置为空。请求使用当前 TEMU 页面登录态和当前页面 mallId；店铺没配置时默认按全托运行。

半托店铺需要在“修改配置”里添加当前店铺，并打开半托开关。提交核价脚本还需要先导入阶梯核价 JSON，否则没有价格规则可用。

`合规中心-实拍图-自改版` 不再依赖 `127.0.0.1:3000`，也不需要客户手写 JSON。

客户操作流程：打开 TEMU 实拍图页面后点左侧橙色“实拍图”抽屉按钮，选择图片来源，再在“目标SPU”里一行一个粘贴要提交的 SPU，最后点“提交这些SPU”。

图片来源有两种：

1. 模板SPU复刻：可保存多个命名模板。先填“模板名称”和“图片来源模板SPU”，点“保存模板”；使用时从“已保存模板”下拉选择，脚本读取该 SPU 已有实拍图 URL，再提交给目标 SPU。
2. 自己上传图片：在脚本面板里选择正视图、侧视图、标签图或其他图，脚本先上传到 TEMU 图床，再提交给目标 SPU。

大量 SPU 建议用面板里的“导入TXT/CSV”。TXT/CSV 一行一个 SPU；Excel 表格先另存为 CSV 再导入。脚本会按 50 个 SPU 一批查询商品，避免一次性把 5000 个 SPU 塞进单个接口请求。

## TEMU商品信息抓取下载

已抓取店铺清单支持备份到私有仓库 `jianpanlan0-svg/scriptcat-temu-backup-data` 的 `temu-scraped-shops.json`。

首次使用需要在脚本的“管理/备份已抓取店铺”里填写 GitHub Token。Token 只保存在脚本猫本地，不写入本仓库脚本代码。

保存 Token 后，脚本启动时会每天最多自动合并同步一次；手动上传或合并同步成功后，当天不会再自动同步。
