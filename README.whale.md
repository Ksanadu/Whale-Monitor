# Whale Monitor · 独立小鲸鱼桌宠

基于 [Token Monitor](https://github.com/Javis603/token-monitor) 的 Windows 桌面软件，沿用 [小鲸鱼](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的角色、按压音效、气泡、拖拽、吸附与编辑器。

- Electron 原生透明置顶窗口；角色之外的区域可以点击下方应用。
- 复用 Token Monitor 的本地用量采集、模型费用统计、账户与额度界面。
- 单击小鲸鱼分两行显示「今日Token」和用量数字；英文和数字使用 Consolas，中文使用微软雅黑 UI，字号随桌宠尺寸同比放大，并按气泡空间适配；后续随机内容保留。
- 启动只显示桌宠，右键直接打开「统计与账户」。右下角齿轮内的「小鲸鱼外观」集中管理角色、大小、音效、气泡、吸附、资源及显示器；「关于」提供桌面版信息、自检、诊断和更新日志。托盘可隐藏桌宠或退出。
- 完全独立运行。无需启动 DSH 后端、插件宿主或 Web 页面，也不会调用 DSH HTTP/WebSocket 服务。
- 完成提示支持本机 DSH、Codex、OpenCode、ZCode 和 Antigravity，共用已有任务结束音和完成气泡，过滤错误、取消、子任务和历史记录，并持久去重。DSH 的提问/授权提示继续保留；[信号来源与支持范围](docs/whale-completions.md)。用量与额度仍由 Token Monitor 采集。
- 设置、账本、导入资源及凭据保存在 `%APPDATA%\Whale Monitor`，与已有 Token Monitor 和 DSH 配置分开。

## 使用

在 [Releases](https://github.com/Ksanadu/Whale-Monitor/releases) 下载 Windows x64 便携版 `Whale-Monitor-<版本>-x64-portable.exe`，或安装 `Whale-Monitor-<版本>-x64-nsis.exe`。未配置余额密钥也可查看本机费用估算。费用估算不等于实际账单；原版鲸鱼账本仍单独保留。

三横杠入口已移除。右键角色打开统计窗口，再次右键等同点击窗口 X；最小化后右键会恢复窗口。点击右下角齿轮后展开「小鲸鱼外观」或「关于」。关闭统计窗口会保留桌宠，退出请使用托盘菜单。

## 自动更新

安装版启动约 15 秒后、运行期间每 5 分钟以及电脑恢复/解锁时检查本仓库的 GitHub Releases。检测到新版本后自动下载并校验安装包，然后静默安装、重启。便携版不会覆盖自身；检测到新版本后自动打开对应 Release 下载页，同一个版本跨重启也只自动打开一次。在「统计与账户 → 设置 → 自动更新」可关闭此行为。

`whale-desktop` 或 `main` 的新提交触发 GitHub Actions，测试和构建成功后自动发布正式 Release 与更新清单，并设为 Latest。正式版本从 `0.75.0` 起，后续按已发布的正式版递增补丁号；未完成的构建不会提供给客户端安装。旧 `0.74.0-whale.1` 尚无更新程序，需要手动安装一次支持自动更新的新版本。始终只更新本仓库的 Whale Monitor，不接入 DSH 更新服务。

## 开发与打包

需要 Node.js >=22.15（建议 24）、npm，以及 Windows x64。

```powershell
npm ci
npm start
npm run test:whale
npm run verify
npm run dist:whale:win
node scripts/verify-whale-release.js
```

产物位于 `dist/whale/`，发布时需要同时上传安装包、便携版、`whale.yml`、`latest.yml` 和校验文件。`npm run monitor` 可运行原版 Token Monitor 界面。详细边界与验证说明见 [桌面版实现说明](docs/whale-desktop.md)。原项目说明保留在 [README.md](README.md)。

## 来源与许可

Token Monitor 的原始 MIT [许可证](LICENSE) 保留。小鲸鱼代码、素材来源、维护提交和原始哈希见 [ORIGIN.json](src/electron/whale/vendor/ORIGIN.json)、[LICENSE](src/electron/whale/vendor/LICENSE) 与 [PROVENANCE.md](src/electron/whale/vendor/PROVENANCE.md)。图片、动图和音效沿用上游 as-is 说明，不包含在代码 MIT 授权内。
