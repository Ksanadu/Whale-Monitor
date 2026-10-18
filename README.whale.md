# Whale Monitor · 独立小鲸鱼桌宠

基于 [Token Monitor](https://github.com/Javis603/token-monitor) 的 Windows 桌面软件，沿用 [小鲸鱼](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的角色、按压音效、气泡、拖拽、吸附与编辑器。

- Electron 原生透明置顶窗口；角色之外的区域可以点击下方应用。
- 复用 Token Monitor 的本地用量采集、模型费用统计、账户与额度界面。
- 小鲸鱼菜单提供「统计与账户」和「切换显示器」；托盘可隐藏桌宠或退出。
- 完全独立运行。无需启动 DSH 后端、插件宿主或 Web 页面，也不会调用 DSH HTTP/WebSocket 服务。
- 本地 DSH 会话记录用于保留原有的每轮消耗、完成、提问与授权提示；只提示启动后追加的事件，失败/中止不发完成通知。其他客户端的用量由 Token Monitor 采集。
- 设置、账本、导入资源及凭据保存在 `%APPDATA%\Whale Monitor`，与已有 Token Monitor 和 DSH 配置分开。

## 使用

Windows x64 运行便携版 `Whale-Monitor-0.74.0-whale.1-x64-portable.exe`，或安装 `Whale-Monitor-0.74.0-whale.1-x64-nsis.exe`。未配置余额密钥也可查看本机费用估算。费用估算不等于实际账单；原版鲸鱼账本仍单独保留。

菜单通过右键角色或悬浮时出现的 ☰ 打开。关闭统计窗口会保留桌宠，退出请使用托盘菜单。独立版关闭了上游应用/DSH 插件更新安装入口，请从本 fork 获取更新。

## 开发与打包

需要 Node.js >=22.15（建议 24）、npm，以及 Windows x64。

```powershell
npm ci
npm start
npm run test:whale
npm run verify
npm run dist:whale:win
```

产物位于 `dist/whale/`。`npm run monitor` 可运行原版 Token Monitor 界面。详细边界与验证说明见 [桌面版实现说明](docs/whale-desktop.md)。原项目说明保留在 [README.md](README.upstream.md)。

## 来源与许可

Token Monitor 的原始 MIT [许可证](LICENSE) 保留。小鲸鱼代码、素材来源、维护提交和原始哈希见 [ORIGIN.json](src/electron/whale/vendor/ORIGIN.json)、[LICENSE](src/electron/whale/vendor/LICENSE) 与 [PROVENANCE.md](src/electron/whale/vendor/PROVENANCE.md)。图片、动图和音效沿用上游 as-is 说明，不包含在代码 MIT 授权内。
