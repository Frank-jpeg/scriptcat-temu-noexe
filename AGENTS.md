# AGENTS.md instructions

- 始终使用简体中文回复，保持简洁。
- 当前目录是独立 Git 仓库：`Frank-jpeg/scriptcat-temu-noexe`。
- 远程仓库推送方式**因机器而异**，先确认自己在哪台：
  - **macOS 维护机**（本地目录 `/Users/mini/Desktop/codex项目/TEMU 脚本`）：用 SSH `git@github.com:Frank-jpeg/scriptcat-temu-noexe.git`，已验证可用；HTTPS 可能超时。
  - **Windows 机**：目录 `G:\temu脚本`，用 HTTPS + gh：`git -c 'credential.helper=!gh auth git-credential' push origin HEAD:main`。代理以本机实际配置为准，不写死旧端口。

## 发布规则

- 修改任意 `.user.js` 后，必须提高脚本头部 `@version`，否则 ScriptCat / 油猴可能不会更新。
- 如果同一脚本内存在 `NOEXE_UI_VERSION`、`SCRIPT_VERSION` 或 `VERSION`，版本号要和 `@version` 同步。
- `@updateURL` 和 `@downloadURL` 必须指向 `https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/...`。
- 重命名 `.user.js` 时，必须同步脚本头 `@updateURL` / `@downloadURL`、README 安装地址，并告诉用户旧脚本要重装一次。
- 旧地址 `jianpanlan0-svg/scriptcat-temu-noexe` 依赖 GitHub 转移重定向；不要在旧账号重新创建同名仓库。
- `jianpanlan0-svg/scriptcat-temu-backup-data` 是“商品信息抓取下载”脚本使用的备份数据仓库，除非用户明确要求，不要改成 `Frank-jpeg`。

## 生命周期脚本边界

- 共享配置和运行日志面板只由 `temu-life-1-price.user.js` 创建；生命周期 2-8 只发送 `goldabcd-noexe-log-event`。修改日志面板或筛选项时改生命周期 1 并提高其版本，不要把整套面板复制回 2-8。
- 生命周期 5、6 使用各自独立配置键，不能合并到生命周期 1-4 的 `goldabcd_noexe_config_v1`。
- 生命周期 7 启用后每轮结束 6 小时自动循环，阈值用 `>=`；按店铺保存阈值、类型与启用状态，刷新恢复。不可夹带改标题。用户明确不需要与提交核价互斥；不要为此改动第 1 个的报价逻辑或调度。
- 修改 1、7 或 8 时，根目录稳定入口与 `versions/` 中对应新版副本内容保持一致；旧副本不修改。拒绝核价测试见 `tests/batch-reject.test.cjs`。
- 生命周期 7、8 的按钮统一粉色，开关/运行状态用文字显示；配置面板沿用 5、6 的按钮下方紧凑白底粉边样式，不随开关切换为绿色或橙色。
- 生命周期 7、8 不拦截刷新；页面离开造成的请求中断不得保存为停用。纯扫描的超时、网络错误、HTTP 408/429/5xx 保持开启，按各自原间隔重新扫描；业务/认证/格式错误、写入失败或结果不明、7 的提交后复查失败以及手动暂停仍关闭。回归检查：`node tests/navigation-ui.cjs`、`node tests/read-recovery-ui.cjs`（需 Playwright）。
- 生命周期 8 使用独立的 `goldabcd_category_area_v1:<mallId>` 保存类目规则与启停状态；按末级类目 ID 匹配，未配置不改。配置类目只允许精确查询代表 SPU，不退回全店扫描。运行查询每页 50，最多 200 页，不越过 10000 窗口；存在未覆盖数据必须显式提示。
- 生命周期 7、8 均在每轮结束后等 6 小时再检查；手动开启立即运行，刷新恢复开启状态后 5 秒运行。
- 生命周期 8 的名称按需查询父级子类目接口，精确匹配目标 ID 后保存到独立的 `goldabcd_category_names_v1:<mallId>`；不附带全站类目库、不定时重爬。名称只用于显示，不修改匹配 ID 或扩展到子类目。接口与缓存边界见 [类目名称查询](docs/category-name-cache.md)。

## 检查命令

```bash
# Windows PowerShell：Get-ChildItem -Recurse -Filter '*.user.js' | ForEach-Object { node --check $_.FullName }
find . -name '*.user.js' -print0 | xargs -0 -n1 node --check
rg -n 'jianpanlan0-svg/scriptcat-temu-noexe|@version|@updateURL|@downloadURL|NOEXE_UI_VERSION|SCRIPT_VERSION' .
node --test tests/batch-reject.test.cjs tests/auto-reject.test.cjs tests/category-area.test.cjs tests/category-names.test.cjs
```
