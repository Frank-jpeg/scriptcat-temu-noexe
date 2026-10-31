# 第 9 个资质上传验证记录

版本：2026.1031.2。只支持 FCM（132）和 FCM DoC（1208）。

## 多模板规则

- 每个店铺可保存多个模板名称和模板 SPU，名称只作备注；保存时自动读取并校验两种资质。
- 一次运行先读取完整商品快照，再按模板末级类目分组上传；多个模板共用这次快照。
- 同一末级类目配置多个模板会在读取阶段报错并停止，避免资质来源不确定。
- 运行期间编辑、新建、删除按钮锁定；停用后才可调整模板。
- 旧版单模板配置会备份到 \`goldabcd_qualification_v1:<mallId>:backup:<时间戳>\`，迁移成一个模板并保持停用。

## 真实店铺验证（2026-10-31）

- 浏览器：2TEMU02；店铺 634418228607588。模板 48477498749，末级类目 10856。
- 模板读取：FCM 9 份报告，FCM DoC 1 份英文文件，使用 original_file_url。
- 使用本版本 createWorker.run 自动分页扫描全部 951 个商品，匹配出 846 个同末级类目待上传商品，与页面待上传数一致。
- 实测限制处理自动选出的首个商品 47475300127：FCM、FCM DoC 两项提交成功，随后 query/detail 文件原始地址逐项复查一致。其余商品未批量提交。
- 本次在线测试调用脚本同一业务 worker；安装界面的行为通过本地 Playwright 模拟页面验证。

## 协议边界

- POST /mms/arbok/product_cert/query/list：cert_types 为 [132,1208]，page_size 25。无 product_ids 时扫描，指定 product_ids 时精确复查。当前待上传为 upload_status=1、audit_status=1，且 can_upload、can_edit 为 true。不要混用 batch_upload/product_list 的状态值。
- 完整分页快照读取后才上传；重复分页、总数变化、截断、超过 10000 商品窗口时停止并提示，不以部分数据宣称完成。
- POST /mms/arbok/product_cert/query/detail：product_id、cert_type；只读取 result.product_cert_info 的实际文件字段，不递归误用示例图或主图。
- 目标已有文件/审核记录跳过；模板须适用于目标类目。FCM 使用目标自己的 real_pictures，缺图跳过；不把主图当实拍图。
- POST /bg-lich-mms/cert/product/upload：使用 productCatCertReqList，只允许上述两类。双层 success 均为 true 才进入文件复查，复查失败停用，不重复写入。
- 每请求前后、每提交前检查启动店铺和暂停状态；上传失败或结果不明停用，纯读取临时网络错误维持开启，6 小时后重试。刷新离开不改为停用。
- 运行日志只发送 goldabcd-noexe-log-event，面板由第 1 个创建。

## 自动检查

node --check temu-life-9-qualification.user.js

node --test tests/qualification.test.cjs

node tests/qualification-ui.cjs（需要 Playwright；可通过 PLAYWRIGHT_EXECUTABLE_PATH 指定已安装的测试浏览器）

8 项核心测试覆盖分页完整性、类目/状态筛选、协议映射、原始文件 URL、目标实拍图、暂停/切店、写入与复查失败、旧配置迁移、低窗口布局。UI 测试覆盖 607×710、375×400、1280×720 面板边界，无目标输入，迁移备份、循环、暂停、切店和日志事件。
