# 生命周期 8 验证记录

版本：8 为 2026.0930.2；1 为 2026.0930.2（仅日志筛选）。

`node --test tests/batch-reject.test.cjs tests/auto-reject.test.cjs tests/category-area.test.cjs` 共 32 项通过，8 的 14 项覆盖类目 ID 匹配、单 SPU 精确查询、错误编号/缺失或冲突类目拒绝、名称缺失不冒充、旧模板合并暂停、新版多规则恢复、批次、10000 窗口、失败、暂停及切店。

`node tests/category-area-ui.cjs` 使用 Playwright 与本机模拟页面，需要 Node 能解析 playwright 且 Chromium 已安装。全部网络请求使用模拟数据。已验证：两次 SPU 查询只产生两次只读请求；两条规则同时执行；保存刷新恢复；编辑、删除；未找到商品不能保存；旧模板迁移、备份及暂停。无页面脚本异常。截图输出到系统临时目录。

手动模拟页面：`node tests/browser-server.cjs`，输出 URL 后加 `?area=1`。代表 SPU 111/222 为不同 ID 的帽子，333 为水杯。

真实接口边界：之前已只读查看到货区域列表字段。SPU 查询沿用自动实拍图已有的 productSpuIdList / catIdList 协议；本轮浏览器连接中断，catNameList 名称字段与新配置查询尚未实店核对。缺失名称时显示 ID，备注不参与匹配。未执行真实到货区域修改，统计为接口成功而非仓库分配成功。

添加规则不再扫描全店；自动运行仍需查询待改商品，每个方向最多 10000 条。窗口内没有可推进商品时明确提示未覆盖数据，不能认定全店完成。
