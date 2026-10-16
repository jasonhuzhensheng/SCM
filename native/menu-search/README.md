# SayPhoto 轻搜索

独立原生菜单栏应用，主程序不需要启动。首次读取已有索引，后台每15秒最多启动一次独立识字进程；单张最长12秒、CPU低优先级、过热或内存压力时等待。识字采用Vision revision 2，避免本机新版识字引擎等待。主程序运行时停止后台索引以避免争用。

搜索支持图片文字和文件名，显示缩略图，单击用系统默认应用打开原件。搜索和打开前只读检查Photos最近删除。锁定标记保留，小工具没有移动、删除、导入或恢复文件任务的入口。

数据库独立位于 `~/Library/Application Support/SayPhoto Menu/search.sqlite`。读取 `scm/library/memories-index.json` 与锁列表，不更新主程序向量或任务记录。当前只为主库已纳入的素材补充文字索引，不消费主程序待导入队列，也不提供大模型画面语义搜索。

模型补齐只检查清单中的当前CLIP与Qwen搜索依赖；单文件256KB/s、45秒分段断点续传、失败退避，权重SHA256校验后原子移入原缓存，不加载模型。受损旧缓存移入小工具备份目录保留。完整模型不重复下载。

构建：将MenuSearch.swift复制为临时main.swift，再与ModelDownloads.swift一起使用swiftc编译，链接AppKit、Vision、ImageIO和sqlite3。运行二进制 `--self-test` 做隔离数据库测试；`--ocr /path/to/image.png` 执行限时只读OCR。打包与安装脚本位于根目录scripts/handoff/package-menu-search.cjs及install-menu-search.cjs。

登录启动由用户级LaunchAgent `local.sayphoto.menu.search` 提供，只启动小工具。右键状态栏图标可暂停/继续识字、查看模型进度或退出；退出后本次会话不自动重启，下一次登录恢复。

搜索窗口使用三列图片缩略图，点击图片打开原件；文字备注仅显示命中关键词附近的短片段，空查询不显示备注。索引状态独立展示可搜索数、识字检查数/总数及跳过数，并显示进度条与后台状态。

默认搜索现为中文图片向量检索：复用主库CLIP向量，Qwen本机转换中文查询，OCR仅用于命中关键词的短备注。后台仅补缺失向量，每五分钟最多一张，写小工具独立vectors.sqlite。主程序及其任务不会启动。构建后运行scripts/handoff/prepare-menu-semantic.cjs准备本机推理依赖，再打包；当前安装依赖本机/opt/homebrew/bin/node，不是跨机免依赖发行包。
