# Batch Reject Implementation Plan

**Goal:** 新增生命周期 7，以次数 ≥ 输入值批量拒绝当前店铺待确认核价单。

**Architecture:** 独立单文件脚本；共享配置只读，共享日志通过事件发送。同源同店铺 Web Locks 串行协调报价/拒绝，epoch 作废旧报价队列。

**Tech Stack:** 原生 JavaScript、ScriptCat、Web Locks、Node 内置测试。

## 1. 生命周期 7

新增 temu-life-7-reject.user.js：校验正整数、收集及去重、固定预览集合、复查、串行提交、停止和错误状态；面板展示当前店铺及明细。使用 textContent 输出接口文本，避免 HTML 注入。

## 2. 生命周期 1

修改 temu-life-1-price.user.js：版本 2026.0930.1，日志 7 筛选；4 个报价工作单元使用同店铺锁，提交改成每轮一个批次，取消预排写请求，恢复时检测 epoch 并清空队列。请求 mallId 固定为页面初始化店铺，切店暂停。

## 3. 验证

tests/batch-reject.test.cjs 覆盖阈值边界、状态、去重、全托/半托请求、预览变化、停止、业务失败和不明结果、分页；tests/price-coordination.test.cjs 覆盖报价锁及旧队列失效。执行 node --test tests/*.test.cjs，所有 user.js 执行 node --check。用模拟浏览器页面核对面板及日志（不调用真实 TEMU 写接口）。

## 4. 文档及发布

更新 README.md / UPSTREAM.md，说明第 7 个工具和 ≥ 语义、安装/升级、互斥边界与未实店验证项。versions/ 另存 1 和 7 的带日期版本文件，内容和稳定入口一致。git diff --check，提交并推送 main，检查 raw 安装地址。
