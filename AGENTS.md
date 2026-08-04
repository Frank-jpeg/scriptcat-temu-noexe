# AGENTS.md instructions

- 始终使用简体中文回复，保持简洁。
- 当前目录是独立 Git 仓库：`Frank-jpeg/scriptcat-temu-noexe`。
- 远程仓库推送方式**因机器而异**，先确认自己在哪台：
  - **macOS 维护机**（本地目录 `/Users/mini/Desktop/codex项目/TEMU 脚本`）：用 SSH `git@github.com:Frank-jpeg/scriptcat-temu-noexe.git`，已验证可用；HTTPS 可能超时。
  - **Windows 机**：SSH 密钥未配置，会 `Permission denied (publickey)`。改用 HTTPS + gh 令牌，并挂代理：
    ```bash
    export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897
    git remote set-url origin https://github.com/Frank-jpeg/scriptcat-temu-noexe.git
    git -c credential.helper='!gh auth git-credential' push origin main
    ```

## 发布规则

- 修改任意 `.user.js` 后，必须提高脚本头部 `@version`，否则 ScriptCat / 油猴可能不会更新。
- 如果同一脚本内存在 `NOEXE_UI_VERSION` 或 `SCRIPT_VERSION`，版本号要和 `@version` 同步。
- `@updateURL` 和 `@downloadURL` 必须指向 `https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/...`。
- 重命名 `.user.js` 时，必须同步脚本头 `@updateURL` / `@downloadURL`、README 安装地址，并告诉用户旧脚本要重装一次。
- 旧地址 `jianpanlan0-svg/scriptcat-temu-noexe` 依赖 GitHub 转移重定向；不要在旧账号重新创建同名仓库。
- `jianpanlan0-svg/scriptcat-temu-backup-data` 是“商品信息抓取下载”脚本使用的备份数据仓库，除非用户明确要求，不要改成 `Frank-jpeg`。

## 生命周期脚本边界

- 共享配置和运行日志面板只由 `temu-life-1-price.user.js` 创建；生命周期 2-6 只发送 `goldabcd-noexe-log-event`。修改日志面板或筛选项时改生命周期 1 并提高其版本，不要把整套面板复制回 2-6。
- 生命周期 5、6 使用各自独立配置键，不能合并到生命周期 1-4 的 `goldabcd_noexe_config_v1`。

## 检查命令

```bash
find . -name '*.user.js' -print0 | xargs -0 -n1 node --check
rg -n 'jianpanlan0-svg/scriptcat-temu-noexe|@version|@updateURL|@downloadURL|NOEXE_UI_VERSION|SCRIPT_VERSION' .
```
