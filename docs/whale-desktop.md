# 独立桌面版实现说明

## 进程与数据边界

`src/electron/whale/entry.js` 是独立桌面入口。它先设置独立 userData 和采集缓存目录，再启动 Token Monitor 主进程。`--token-monitor` 保留上游启动方式。独立版不会导入现有 Token Monitor 的账号或设置，不写入 DSH 配置目录。

桌宠页面由 `whale://app/` 本地协议提供。保留的 `/dsh-whale/*` 是原版 UI 与进程内适配器之间的路径名称，没有 HTTP 监听端口。原插件的事件与资源处理代码在 Electron 主进程内运行；角色导入、音效、泡泡、记账等处理因此可以保留。余额/额度查询仍会在用户配置账户后访问对应服务商；「独立」指没有 DSH 服务依赖，并非禁止软件联网。

桌宠 renderer 开启 sandbox/contextIsolation，关闭 Node，preload 仅公开区域上报、打开统计界面、切换显示器。IPC 检查发送窗口和主 frame。资源请求只接受本地应用 origin，CSP 禁止 renderer 连接外部后端。密钥经 Token Monitor CredentialStore 保存在独立目录，普通设置接口不返回密钥。

Windows 使用工作区大小的透明窗口和原生 setShape，将可见角色、气泡、菜单、编辑器投影为原生窗口区域。菜单/编辑器打开时允许键盘焦点，平时保持不激活。显示器切换保存 displayId；显示器拔出时退回主屏。只验证 Windows x64，其他平台没有桌宠支持承诺。

## 采集与提醒

单击默认气泡显示「今日本机用量」：Token 合计和 USD 估算费用来自 Token Monitor 最新 today 快照，涵盖已识别客户端，不再使用 DeepSeek 余额/峰谷价格卡。尚未拿到 Token 数据显示「—」，明确的零用量才显示 0。恢复默认也使用本机用量卡；已保存且完全未修改的旧出厂首卡会升级，用户自定义卡与后续点击序列、泡泡框保留。

气泡使用本机 Codex 在 Windows 下的系统无衬线字体：英文 Segoe UI，中文回退 Microsoft YaHei UI，不分发 Codex 的专有字体文件。默认用量卡缩小字号，并按文字区实际宽高统一缩放；数字及 Tokens 单位保持一行，统计变化、角色缩放和显示器尺寸变化后重新计算。自定义框使用其保存的文字安全区。

全局 USD 费用只影响展示，不送入原鲸鱼的 CNY 账本预算提醒。余额没有配置时显示本机费用估算，而不伪造余额为零。原鲸鱼账本和服务商余额仍走保留的处理逻辑。

独立 worker 每 2.5 秒读取本地 DSH 会话文件，复用 Token Monitor 的文件版本选择、zstd 解码规则。只读本地记录，不订阅 DSH 后端。启动历史、截断、替换和继承的 seed 内容不重放；只有完整提交的新增 JSONL 记录会转成事件。最多观察最近 128 个会话，单文件上限 32 MiB。超过上限的会话不提供桌宠提醒，用量采集仍由 Token Monitor 负责。

完成快照保留维护版修复：仅 `reason.kind === completed` 推进通知序号，失败/取消仍可记账；静音子智能体不能覆盖主会话完成快照；首次轮询只建立基线。提醒范围目前为本地 DSH 事件；Claude/Codex 等客户端复用统计与额度能力，未新增它们的桌宠完成事件适配。

## 构建与验证

`scripts/whale-builder.config.js` 独立设置应用 id、名称、版本、图标、安装目录身份与便携/NSIS 产物。保留根包上游元数据，避免影响原有 Worker/macOS 发布脚本。独立更新只指向本仓库，仍不检查 DSH npm 插件更新。

## 自动更新与发布

`whale/updater.js` 在主进程检查 GitHub Releases。启动延迟 15 秒，之后每 5 分钟以及系统恢复/解锁时检查。只考虑已发布、有对应版本的两个 Windows 程序附件的 Release；安装版还要求 `whale.yml` 已上传。比较 SemVer，包含本项目的 whale 预览版，不降级。原始提交不能执行，必须先由 Actions 构建成完整 Release。

NSIS 的 `customInstall` 在安装目录写入绑定本应用 id 的 `whale-installation.json`；只有带此标记的安装版才能自动安装。便携环境变量始终优先，解压目录和开发运行不会误装。便携版只打开固定仓库对应 Release URL，已自动打开的版本记在独立数据目录的 `whale-updates.json`，跨重启去重；浏览器打开失败可重试。

安装版复用 electron-updater 的 NsisUpdater，将 manifest 固定到已选择的 Release tag。先检查版本、安装包名、大小和 SHA-512 格式，再由更新器验证下载内容。禁止 Web installer 和差分下载；下载失败不退出应用。校验后通过原有更新退出交接机制静默安装并重启；安装失败/超时不会在当前进程反复启动安装器。当前发行包没有 Authenticode 证书，构建配置关闭证书名校验；更新来源由固定 GitHub HTTPS 地址和发布清单 SHA-512 约束。签名发行后应启用证书校验。

`automaticAppUpdates` 在旧独立版首次升级时迁移为开启，`whaleUpdatesConfigured` 标记后续不再覆盖用户选择。设置界面中的自动更新开关同时控制安装版自动安装与便携版自动打开网页。

`.github/workflows/whale-release.yml` 仅在本 fork 的 `whale-desktop`/`main` 提交及手动触发时发布。版本使用 `0.74.0-whale.<run_number+2>`，不提交版本号避免循环构建。发布前执行 lint、桌宠/更新相关回归、Windows 打包及 SHA-512/大小检查，所有附件先上传草稿，再公开发布，避免客户端看到半成品。`WHALE_BUILD_VERSION` 只改变打包元数据，不改上游共享包版本。

新增回归覆盖：独立设置与资源接口、凭据隔离、失败/取消不通知、USD 与 CNY 预算分离、启动静默、尾部半条记录、截断后的重新计序、版本化日志、子智能体及无服务器 worker。

本机执行过完整 `npm run verify`：既有 6 项失败在未修改的上游提交 `cbed5915e294abb4a210f7ebb385e9415f706821` 全部复现（三项创建符号链接的 EPERM、Antigravity 本机目录假设、Cherry Studio/Goose 两项 shm 监听时序）。不能将全量结果描述为全部通过。独立桌宠测试及 lint 单独通过；上游相关启动和更新检查通过。

人工验证使用隔离的 `WHALE_MONITOR_DATA_DIR`，检查真实窗口、角色菜单和设置编辑器。开发诊断可用 `WHALE_DESKTOP_TEST_WINDOW=1` 让桌宠在任务栏/窗口枚举中可见；打包程序忽略该标志。
