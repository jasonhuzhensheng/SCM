# SCM 拾光 · 简洁界面

基于 SCM 0.2.7 的中文界面改版。以搜索、添加素材和预览为核心，复用原有本地检索、索引及文件管理接口。

## 使用桌面版

已生成的应用位于 `/Applications/SCM 拾光.app`。先退出原版 SCM，再打开新版。两者使用同一份 SCM 素材库与模型缓存，不应同时运行；安装只替换应用包，不重建用户素材库。

- 顶部“添加素材”：选择照片、视频或文件夹，也支持拖放。
- 搜索框：输入描述并回车；可切换画面、视频片段、图片文字与视频对白。中文画面/视频片段描述先由已安装的本地语言模型翻译成英文，再检索；界面显示英文检索词。图片文字、对白和文件名的字面匹配保留原文。翻译不可用或超时会显示提示。
- 左侧：按类型、来源文件夹和收藏筛选。
- 单击素材预览；方向键切换，Esc 关闭；可查看详情和在 Finder 中定位。
- 设置：切换搜索模型、管理自动添加文件夹。更多高级功能可进入原版界面；原版右上角可返回简洁版。

界面及导入响应性已调整；中文语义搜索复用本机已安装的语言模型进行翻译，没有更换图片搜索模型。更换模型仍会重建索引。收藏与最近搜索单独保存在本机。

## 界面预览

```sh
npm run preview:simple
```

浏览器访问输出的本机地址。浏览器版本明确标记为示例预览，使用公开示例照片，搜索仅匹配标题和标签；本地导入、Finder、模型切换只在 Electron 桌面版工作。`?empty=1` 可查看首次使用的空素材库状态。示例照片来自 https://picsum.photos ，预览不读取用户媒体。

## 构建

```sh
npm install
npm run build
npx tsc --noEmit
npm run package:simple -- /Applications/SCM.app /private/tmp/SCM-Simple.app
```

打包脚本复用已安装的同版本 SCM 运行时，叠加新界面及本地后端修复，更新 ASAR 完整性校验并进行本地签名。输出路径必须不存在；建议先输出到 `/private/tmp`，避免云同步目录附加 Finder 元数据干扰签名。

## 已验证

- Vite 生产构建、TypeScript 类型检查。
- 浏览器中的搜索/清空、收藏/筛选、文件夹筛选、网格/列表切换、预览翻页与详情、设置页、无结果提示。
- 1280px 桌面和 390px 窄窗口布局；窄窗口无横向溢出。
- Electron 隔离临时素材库启动：新版标题、本地索引读取、缺失文件 404；原项目 smoke 检查成功。
- 本地应用签名验证。

未以用户素材重新测试 AI 准确率或完整视频转写；新增功能的单元测试不代表实际照片的匹配准确率。

## 批量复制、移动与删除

在结果栏点击“批量选择”，勾选素材或全选当前结果。同一视频的多个片段按一个完整文件处理。

- “复制到…”／“移动到…”默认打开目标文件夹选择入口。已安装 Google Drive 客户端时，直接选择其同步文件夹，无需 OAuth；也支持其他本机文件夹或外接硬盘。每批创建独立文件夹，不覆盖现有文件。
- 本机传输会校验目标与源文件内容。移动仅删除软件素材库副本及搜索记录，保留导入前的原文件；本地复制完成不代表云端同步完成，云端状态请查看 Google Drive 客户端。
- “删除选中的原文件…”经确认后将原文件移到系统废纸篓，并清理素材库副本及搜索记录。右键菜单可选择删除原文件或仅删除素材库副本，预览工具栏也提供删除按钮。网盘目录的删除可能同步到云端。
- 失败文件保留并显示原因。自动同步不会重新导入未改变的已移出来源，手动重新导入仍可恢复。

设置中保留“高级：直接上传云端（OAuth）”。需自行创建 Google Cloud 桌面应用 OAuth 客户端并导入配置。授权采用 PKCE、系统浏览器、本机回调及 drive.file 范围，配置和令牌由 Electron safeStorage 加密保存。直接云端移动在上传及远端大小／MD5 校验通过后清理素材库副本。未验证真实账号授权及云端上传。

## 相似照片

打开照片后点击“查找相似照片”，或在照片上右键选择同名选项。使用现有整图向量进行余弦相似度排序，不需要重新建立索引。最多展示 500 个候选（含参考照片），可调整匹配范围；默认不选中任何结果。相似结果不代表重复文件，确认画面后再批量删除或移动。尚未建立向量索引的照片需等待索引完成，模型切换期间暂不可检索。

## 索引速度

导入文件信息改为有上限的并行读取；索引工作进程最多预解码下一张照片，并缓存同模型下相同文件名短语的结果；本机复制优先尝试文件系统快速克隆，不支持时自动正常复制。保留原有模型、图片输入尺寸和串行模型推理。未对用户完整素材库测量端到端加速比例。

验证命令：

```sh
node test/index-performance.test.js
node test/import-copy.test.js
node test/import-order.test.js
node test/import-scan.test.js
node test/folder-transfer.test.js
node test/drive-transfer.test.js
node test/drive-moved-source.test.js
node test/simple-delete.test.js
node test/batch-delete-ui.test.js
node test/similar-photos.test.js
node test/photo-location.test.js
node test/map-tiles.test.js
node test/search-translation.test.js
node test/search-translation-routing.test.js
node test/google-drive.test.js
```

OAuth 测试仅使用模拟服务及本机回调端口；测试不操作用户素材。

## 地图找照片

点击“地图找照片”，首次分批读取素材库照片的 EXIF GPS，显示进度并缓存。拖动地图、加减缩放，单击地图或蓝色照片地点选中心，选择 0.5～500 公里的附近范围；也可直接输入经纬度。结果支持距离排序、与文字／文件夹筛选叠加、批量选择和 Drive 上传。关闭地图即可恢复普通浏览。

没有 GPS 的照片不会出现在地点结果中，不根据图片内容猜测坐标。JPEG、PNG、WebP、TIFF、HEIC/HEIF、AVIF 的元数据读取取决于原文件及当前 sharp 解码器支持；视频地点暂不读取。底图需要网络，使用 OpenStreetMap，缓存至少七天；照片、GPS 索引和距离计算都在本机，底图服务仅接收所查看区域的瓦片请求。界面最多显示 500 个可见照片地点标记，距离筛选仍包含全部带 GPS 的照片。

验证：EXIF 双字节序、半球、损坏数据、缓存更新与删除、跨日期变更线距离、底图缓存与离线降级；实际生成 JPEG 的 sharp 元数据读取；浏览器示例地点的地图及筛选交互。未对用户照片 GPS 完整率做统计。

底图规范：[OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)。
