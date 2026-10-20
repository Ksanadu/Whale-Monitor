# 独立完成提醒

桌宠的任务结束音、音量、完成气泡开关及已有音效选择同时作用于 DSH、Codex、OpenCode、ZCode 和 Antigravity。新增来源使用独立完成队列，不将金额或用量写入 DSH 账本，也不修改 Token Monitor 的统计。未知本轮 Token 显示「—」，不会伪造为零。

## 来源与成功条件

- Codex 本地 rollout：复用 provider 的有界增量索引与来源标识，只接收 `task_complete`；排除中断、显式错误及 subagent/guardian/父会话标识。完成时间兼容秒级数字/数字字符串、毫秒及 ISO 时间，统一为 epoch 毫秒后判断新事件。事件按原生 turn id 去重；本轮 Token 使用同一轮开始/完成之间的累计差，缺少基线时留空。发现范围沿用 provider 的当前/前一天目录及近期本地线程目录索引，不递归扫描全部历史。
- Codex 桌面本机执行：复用已有 App Server 只读订阅及本机 `exec-server --environment-id` 校验；不使用 cwd 推断设备归属。只通知订阅后观察到开始、随后明确 `status=completed` 且无错误的轮次。云端、其他电脑、子任务、临时线程与已有原生 rollout 的任务均不订阅；连接重建不回放历史。需要本机已登录 Codex 且有可识别的本机执行器，没有执行器时不连接服务器。该通道不打开用量账本或竞争用量采集租约，不改变 Codex Dots 用量采集开关，也不启动任务、发送输入或回答审批。Windows 转义引号兼容修复后，实机已识别执行器并连接服务器，当前登录账户未返回匹配任务；订阅成功/失败路径使用隔离 socket 测试验证。本地 rollout 通道独立工作，不依赖该订阅。
- OpenCode：只读现有 `opencode*.db`，沿用 provider 的当前/旧版存储识别和优先级。根会话的一轮用户输入以带完成时间、无错误的最终 `finish=stop` 为成功，兼容桌面版 `idle_outcome=succeeded`，并检查该轮 `idle` 消息的成功/取消边界；`tool-calls`、错误、取消、输出截断、过滤、压缩摘要及子会话均不提示。同一用户轮的多次请求用量合并，保留原有 Token 口径。
- ZCode：只读 `~/.zcode/cli/db/db.sqlite` 的 `turn_usage`，只接收 `completed` 且无取消、错误、上下文超限或工具错误的根轮次；排除父会话及 workflow 子任务链接。旧版数据库没有 `turn_usage` 时使用兼容的消息完成投影。
- Antigravity：只读 provider 已发现的 `conversation_summaries.db` 及对应 `conversations/<id>.db`。根会话必须明确空闲、未 killed、无未结束工作，并在本次用户输入之后以 DONE 的最终响应/通知/结束步骤收尾；该轮任何错误、取消、中断或错误消息都会抑制通知。只进入空闲或完成一个工具步骤不构成成功。枚举来自本机 language server 内嵌 protobuf 定义，不猜测数值。父会话与 nesting depth 排除子任务。

## 生命周期、去重与资源边界

独立 worker 每 2.5 秒读取已提交的本地信号，启动时静默对齐历史，截断和文件替换不重放旧 turn id。Antigravity 使用用户输入步骤作为稳定轮次键，重命名、目录索引刷新不会制造完成事件；启动时已观察到运行的任务完成后可以提示。

`whale/agent-completions-seen.json` 仅保存散列事件 ID 和淘汰时间边界，不保存提示词、回答、密钥或工具输出。先原子保存去重记录，再向主进程发布；保存失败时不发布。记录有上限，淘汰边界阻止旧完成重新进入。各来源失败彼此隔离；未知或无法证明成功的状态跳过，稍后重试读取。

主进程队列保留最近 128 项，renderer 通过本地协议按序号读取；启动或 epoch 变化先对齐，网络/渲染重试不会重复播放。多项完成均保留各自的 Token 快照；同批不同事件使用不同声音认领键，避免原有 180ms 单片段节流吞掉合法完成。声音与气泡仍尊重用户开关。

Codex 复用 provider 的最多 256 个近期索引；OpenCode 每库最多 128 个根会话、每会话最多 512 条消息；ZCode 最多 512 条完成轮次；Antigravity 每库最多 128 个根会话、每轮最多 2048 个步骤。越界或不兼容 schema 不作为成功证据。读取和解码均在 worker，退出时关闭订阅、取消进程探测并有强制终止兜底。

## 验证

```powershell
node --test tests/electron/whaleAgent*.test.js tests/shared/codexLocalUsage.test.js tests/shared/codexSession*.test.js tests/shared/opencode*.test.js
npm run verify
```

使用隔离 JSONL/SQLite 固定数据验证四种来源的成功、错误、取消、子任务和重复记录；覆盖同批完成、重启、截断、历史索引刷新与去重上限。真实 Electron 中观察独立完成队列触发已有结束音路径、气泡队列保留各自 Token、未知数量显示「—」、连续轮询不重播且 DSH 完成序号不改变。仅验证 Windows；其他平台及未落地本机记录/无法校验本机归属的云端任务不在支持范围。
