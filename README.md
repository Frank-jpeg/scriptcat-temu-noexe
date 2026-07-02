# ScriptCat TEMU NoEXE Scripts

TEMU ScriptCat 自改版脚本，去掉本地下载器依赖，并支持 GitHub raw 自动更新。

## 安装地址

- 1 提交核价: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-1-price.user.js
- 2 开通JIT: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-2-jit.user.js
- 3 增加库存: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-3-stock.user.js
- 4 确认商品信息: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/temu-life-4-confirm.user.js
- TEMU商品信息抓取下载: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%95%86%E5%93%81%E4%BF%A1%E6%81%AF%E6%8A%93%E5%8F%96%E4%B8%8B%E8%BD%BD.user.js
- TEMU商品列表导出: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%95%86%E5%93%81%E5%88%97%E8%A1%A8%E5%AF%BC%E5%87%BA.user.js
- TEMU单店巡查脚本: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/TEMU%E5%8D%95%E5%BA%97%E5%B7%A1%E6%9F%A5%E8%84%9A%E6%9C%AC.user.js
- Temu 销售管理备货计算: https://raw.githubusercontent.com/Frank-jpeg/scriptcat-temu-noexe/main/Temu%E9%94%80%E5%94%AE%E7%AE%A1%E7%90%86%E5%A4%87%E8%B4%A7%E8%AE%A1%E7%AE%97.user.js

以后修改脚本时提高 `@version` 并推送到 GitHub，ScriptCat 的“检查更新”即可更新。
## 配置说明

脚本默认配置为空。请求使用当前 TEMU 页面登录态和当前页面 mallId；店铺没配置时默认按全托运行。

半托店铺需要在“修改配置”里添加当前店铺，并打开半托开关。提交核价脚本还需要先导入阶梯核价 JSON，否则没有价格规则可用。

## TEMU商品信息抓取下载

已抓取店铺清单支持备份到私有仓库 `jianpanlan0-svg/scriptcat-temu-backup-data` 的 `temu-scraped-shops.json`。

首次使用需要在脚本的“管理/备份已抓取店铺”里填写 GitHub Token。Token 只保存在脚本猫本地，不写入本仓库脚本代码。

保存 Token 后，脚本启动时会每天最多自动合并同步一次；手动上传或合并同步成功后，当天不会再自动同步。
