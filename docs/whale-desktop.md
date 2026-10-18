# 独立桌面版实现说明

## 进程与数据边界

`src/electron/whale/entry.js` 是独立桌面入口。它先设置独立 userData 和采集缓存目录，再启动 Token Monitor 主进程。`--token-monitor` 保留上游启动方式。独立版不会导入现有 Token Monitor 的账号或设置，不写入 DSH 配置目录。

桌宠页面由 `whale://app/` 本地协议提供。保留的 `/dsh-whale/*` 是原版 UI 与进程内适配器之间的路径名称，没有 HTTP 监听端口。原插件的事件与资源处理代码在 Electron 主进程内运行；角色导入、音效、泡泡、记账等处理因此可以保留。余额/额度查询仍会在用户配置账户后访问对应服务商；「独立」指没有 DSH 服务依赖，并非禁止软件联网。

桌宠 renderer 开启 sandbox/contextIsolation，关闭 Node，preload 仅公开区域上报、打开统计界面、切换显示器。IPC 检查发送窗口和主 frame。资源请求只接受本地应用 origin，CSP 禁止 renderer 连接外部后端。密钥经 Token Monitor CredentialStore 保存在独立目录，普通设置接口不返回密钥。

Windows 使用工作区大小的透明窗口和原生 setShape，将可见角色、气泡、菜单、编辑器投影为原生窗口区域。菜单/编辑器打开时允许键盘焦点，平时保持不激活。显示器切换保存 displayId；显示器拔出时退回主屏。只验证 Windows x64，其他平台没有桌宠支持承诺。

## 采集与提醒

全局 USD 费用来自 Token Monitor 最新 today 快照。它只影响展示，不送入原鲸鱼的 CNY 账本预算提醒。余额没有配置时显示本机费用估算，而不伪造余额为零。原鲸鱼账本和服务商余额仍走保留的处理逻辑。

独立 worker 每 2.5 秒读取本地 DSH 会话文件，复用 Token Monitor 的文件版本选择、zstd 解码规则。只读本地记录，不订阅 DSH 后端。启动历史、截断、替换和继承的 seed 内容不重放；只有完整提交的新增 JSONL 记录会转成事件。最多观察最近 128 个会话，单文件上限 32 MiB。超过上限的会话不提供桌宠提醒，用量采集仍由 Token Monitor 负责。

完成快照保留维护版修复：仅 `reason.kind === completed` 推进通知序号，失败/取消仍可记账；静音子智能体不能覆盖主会话完成快照；首次轮询只建立基线。提醒范围目前为本地 DSH 事件；Claude/Codex 等客户端复用统计与额度能力，未新增它们的桌宠完成事件适配。

## 构建与验证

`scripts/whale-builder.config.js` 独立设置应用 id、名称、版本、图标、安装目录身份与便携/NSIS 产物。保留根包上游元数据，避免影响原有 Worker/macOS 发布脚本。独立版阻止上游应用更新下载安装，也不检查 DSH npm 插件更新。

新增回归覆盖：独立设置与资源接口、凭据隔离、失败/取消不通知、USD 与 CNY 预算分离、启动静默、尾部半条记录、截断后的重新计序、版本化日志、子智能体及无服务器 worker。

本机执行过完整 `npm run verify`：既有 6 项失败在未修改的上游提交 `cbed5915e294abb4a210f7ebb385e9415f706821` 全部复现（三项创建符号链接的 EPERM、Antigravity 本机目录假设、Cherry Studio/Goose 两项 shm 监听时序）。不能将全量结果描述为全部通过。独立桌宠测试及 lint 单独通过；上游相关启动和更新检查通过。

人工验证使用隔离的 `WHALE_MONITOR_DATA_DIR`，检查真实窗口、角色菜单和设置编辑器。开发诊断可用 `WHALE_DESKTOP_TEST_WINDOW=1` 让桌宠在任务栏/窗口枚举中可见；打包程序忽略该标志。
