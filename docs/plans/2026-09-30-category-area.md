# 生命周期 8：按类目自动设置到货区域

用户要求先实现基础版，细节以后调整。沿用此前 brainstorming / Code / writing-plans 工作流，当前方案为独立单文件脚本，末级类目对应广东或义乌，首次默认关闭，按店铺保存规则和开关，启用后立即运行，每轮结束 60 秒再扫描，刷新后 5 秒恢复。

接口只读验证已完成：pageQuerySkcPickOutConfig 返回 leafCatId/leafCatName、cat4Id/cat4Name、productSkcId、expectReceiveAreaConfigType、canEditExpectReceiveArea。基础版使用 leafCatId 精确匹配，不根据名称猜测，也不加入四级类目优先级。

1. 新增 temu-life-8-area.user.js：读类目、可搜索规则表、保存启用/停用、外部开关状态、串行批量设置、共享日志事件。
2. 同一 SKC 去重，冲突记录跳过；未配置、不可编辑、已符合区域的条目不修改。全量只读扫描完成后按广东/义乌分组，每批最多 50 个，间隔 2 秒提交。
3. 第 1 个只添加日志 8 筛选并提升版本，业务逻辑不变。8 使用独立 localStorage key，不修改 1-7 配置。
4. 测试类目匹配、去重、批次边界、部分失败、停止、保存恢复；浏览器只使用模拟数据，不执行真实到货区域写入。
5. 同步 README/UPSTREAM/AGENTS，另存带版本号副本；提交推送后检查安装地址。

用户补充确认：命名模板保存整套类目→区域规则；展开查看，开始/暂停；类目名称展示、ID 匹配。同名附带上级名称但不另加判定。WorkBuddy 报告查询硬上限 10000，采用方向分轮及截断提示；无进展时不保证覆盖窗口外数据。
