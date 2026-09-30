# Batch Reject Implementation Plan

**Goal:** 新增生命周期 7，以次数 ≥ 输入值批量拒绝当前店铺待确认核价单。

**Architecture:** 独立单文件脚本；共享配置只读，共享日志通过事件发送。第 1 个仅增加日志筛选；按用户要求不做跨脚本互斥或报价调度改动。

**Tech Stack:** 原生 JavaScript、ScriptCat、Node 内置测试。

## 实现及验收

1. 新增 `temu-life-7-reject.user.js`：正整数输入、扫描去重、预览复查、串行拒绝、停止、错误显示。默认 9，按 ≥ 处理。
2. 修改 `temu-life-1-price.user.js`：只提高版本至 2026.0930.1 并添加日志筛选，核对业务部分与改动前逐字相同。
3. 执行 `node --test tests/batch-reject.test.cjs`，全部用户脚本运行 `node --check`，通过本地模拟页验证全托/半托及停止功能。
4. 同步 README/UPSTREAM/AGENTS/验证记录，将 1 和 7 新版本另存到 versions/，保留稳定安装入口，提交并推送 main，确认 raw 地址。
