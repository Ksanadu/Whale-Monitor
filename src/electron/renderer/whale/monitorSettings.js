'use strict';

(function () {
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function section(title, id, iconName) {
    const root = element('details', 'whale-settings-section');
    root.id = id;
    const summary = element('summary', 'settings-section-toggle');
    const heading = element('span', 'settings-section-heading');
    const icon = element('span', `settings-section-icon settings-section-icon-${iconName}`);
    icon.setAttribute('aria-hidden', 'true');
    heading.append(icon, element('span', '', title));
    summary.append(heading, element('span', 'settings-section-disclosure'));
    const body = element('div', 'whale-settings-body');
    root.append(summary, body);
    return {root, body};
  }
  function row(host, title, control) {
    if (control.matches('input,select')) control.setAttribute('aria-label', title);
    const item = element('div', 'settings-item');
    item.append(element('span', 'settings-item-text', title), control);
    host.append(item);
    return item;
  }
  function button(text, action) {
    const node = element('button', 'whale-settings-action', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function input(type) {
    const node = element('input');
    node.type = type;
    return node;
  }
  function setLabel(selector, value) {
    const node = document.querySelector(selector);
    if (!node) return;
    node.removeAttribute('data-i18n');
    node.textContent = value;
  }
  function mount(panel, displayGroup) {
    const api = window.tokenMonitor;
    const appearance = section('小鲸鱼外观', 'whaleAppearanceSettings', 'whale');
    appearance.body.append(displayGroup);
    panel.prepend(appearance.root);
    const note = element('p', 'settings-note', '右键桌宠打开统计与账户，在这里调整外观与交互。');
    appearance.body.append(note);
    const status = element('p', 'settings-note whale-settings-status');
    status.setAttribute('role', 'status');
    const role = element('select');
    role.id = 'whaleRoleInput';
    role.setAttribute('aria-label', '小鲸鱼角色');
    row(appearance.body, '角色', role);
    const scaleControls = element('div', 'whale-scale-controls');
    const scale = input('range'), scaleNumber = input('number');
    scale.id = 'whaleSizeInput';
    for (const control of [scale, scaleNumber]) {
      control.min = '1'; control.max = '20'; control.step = '1';
      control.setAttribute('aria-label', '桌宠大小');
    }
    scaleControls.append(scale, scaleNumber);
    row(appearance.body, '大小', scaleControls);
    const bubble = input('checkbox'); bubble.id = 'whaleBubbleInput';
    row(appearance.body, '气泡全局开关', bubble);
    const gap = input('checkbox'); gap.id = 'whaleScrollGapInput';
    row(appearance.body, '避让屏幕右侧边缘', gap);
    const gapPx = input('number'); gapPx.min = '0'; gapPx.max = '1000'; gapPx.step = '1';
    row(appearance.body, '避让宽度（px）', gapPx);
    const controls = [role, scale, scaleNumber, bubble, gap, gapPx];
    let busy = false;
    function render(snapshot) {
      const choices = [{id: 'default', name: '小鲸鱼'}, ...(snapshot.roles || []).filter(item => item.id !== 'default')];
      role.replaceChildren(...choices.map(item => {
        const option = element('option', '', item.name); option.value = item.id; return option;
      }));
      role.value = snapshot.role;
      scale.value = scaleNumber.value = String(Math.round((snapshot.scale - 0.6) * 10) + 1);
      bubble.checked = snapshot.bubble;
      gap.checked = snapshot.scrollGap;
      gapPx.value = String(snapshot.scrollGapPx);
      gapPx.disabled = !snapshot.scrollGap;
    }
    async function command(name = 'snapshot', value) {
      if (busy) return;
      busy = true;
      for (const control of controls) control.disabled = true;
      try {
        const snapshot = await api.whaleSettings(name, value);
        for (const control of controls) control.disabled = false;
        render(snapshot);
        status.textContent = name === 'snapshot' ? '' : ['sound', 'pressBubble', 'snap', 'resources', 'importRole'].includes(name) ? '编辑器已打开，完成后可回到这里继续设置。' : '已应用';
      } catch (error) {
        for (const control of controls) control.disabled = false;
        status.textContent = error.message || '操作失败，请重试';
      } finally { busy = false; }
    }
    role.addEventListener('change', () => void command('role', role.value));
    scale.addEventListener('input', () => { scaleNumber.value = scale.value; });
    scale.addEventListener('change', () => void command('scale', (Number(scale.value) + 5) / 10));
    scaleNumber.addEventListener('change', () => void command('scale', (Number(scaleNumber.value) + 5) / 10));
    bubble.addEventListener('change', () => void command('bubble', bubble.checked));
    gap.addEventListener('change', () => void command('scrollGap', gap.checked));
    gapPx.addEventListener('change', () => void command('scrollGapPx', Number(gapPx.value)));
    for (const [title, label, name] of [
      ['导入角色', '选择图片并裁剪', 'importRole'],
      ['音效与提示', '音效 / 提示泡泡设置', 'sound'],
      ['按压气泡', '按压泡泡设置', 'pressBubble'],
      ['吸附与翻转', '自定义', 'snap'],
      ['资源管理', '管理角色、图片与音频', 'resources']
    ]) row(appearance.body, title, button(label, () => void command(name)));
    appearance.body.append(status);
    appearance.root.addEventListener('toggle', () => { if (appearance.root.open) void command(); });
    addEventListener('focus', () => { if (appearance.root.open && !panel.classList.contains('hidden')) void command(); });

    const about = section('关于', 'whaleAboutSettings', 'about');
    const previousAbout = document.querySelector('.about-settings');
    if (previousAbout) about.body.append(previousAbout);
    panel.append(about.root);
    setLabel('.about-settings [data-i18n="settings.about.title"]', 'Whale Monitor · 小鲸鱼桌面版');
    setLabel('.about-settings [data-i18n="settings.about.description"]', '独立 Windows 桌宠与本地 Token 用量统计软件，无需 DSH 后端。');
    setLabel('#openWebsiteButton', '更新日志');
    setLabel('#openRepositoryButton', '项目仓库');
    setLabel('#reportIssueButton', '反馈问题');
    const runtime = element('div', 'whale-about-runtime');
    about.body.prepend(runtime);
    const actions = element('div', 'settings-actions whale-about-actions');
    const aboutStatus = element('p', 'settings-note'); aboutStatus.setAttribute('role', 'status');
    let aboutData, aboutBusy = false;
    function info(host, label, value) {
      const item = element('div', 'whale-about-row');
      item.append(element('span', '', label), element('span', '', value));
      host.append(item);
    }
    async function refreshAbout() {
      if (aboutBusy) return;
      aboutBusy = true;
      aboutStatus.textContent = '正在读取桌面版信息并自检…';
      try {
        aboutData = await api.getWhaleAbout();
        const versionLabel = document.getElementById('aboutVersion');
        if (versionLabel) versionLabel.textContent = `v${aboutData.version}`;
        runtime.replaceChildren(element('h3', '', '版本与运行信息'));
        for (const [label, value] of [
          ['程序', `${aboutData.name} ${aboutData.version} · ${aboutData.channel}`],
          ['平台', `${aboutData.platform} ${aboutData.arch}`],
          ['发行形式', {installed: '安装包版', portable: '便携版', unpackaged: '开发运行'}[aboutData.installation]],
          ['运行时间', `${Math.floor(aboutData.uptime / 3600)} 小时 ${Math.floor(aboutData.uptime % 3600 / 60)} 分`],
          ['运行环境', `Electron ${aboutData.electron} / Chromium ${aboutData.chrome} / Node ${aboutData.node}`],
          ['程序位置', aboutData.executable], ['数据位置', aboutData.dataDir],
          ['桌宠', aboutData.visible ? '正在显示' : '已隐藏'],
          ['当前屏幕', `${aboutData.display.index} / ${aboutData.display.count}`],
          ['今日 Token', aboutData.todayTokens == null ? '—' : new Intl.NumberFormat('en-US').format(aboutData.todayTokens)]
        ]) info(runtime, label, value);
        runtime.append(element('h3', '', '构建与本地文件'));
        for (const file of aboutData.files) {
          const item = element('div', 'whale-about-file');
          item.append(element('strong', '', file.label), element('span', '', file.found ? `${file.bytes.toLocaleString()} B · ${new Date(file.modified).toLocaleString()}` : '尚未生成'), element('code', '', file.path));
          runtime.append(item);
        }
        runtime.append(element('h3', '', '状态与自检'));
        for (const check of aboutData.checks) info(runtime, check.route, check.ok ? '通过' : '失败');
        runtime.append(element('p', 'settings-note', aboutData.credits), element('p', 'settings-note', aboutData.license));
        aboutStatus.textContent = `本地自检${aboutData.checks.every(check => check.ok) ? '通过' : '存在异常'} · ${new Date(aboutData.checkedAt).toLocaleString()}`;
        if (about.root.open) about.root.scrollIntoView({block: 'start'});
      } catch (error) { aboutStatus.textContent = error.message || '读取失败，请重试'; }
      finally { aboutBusy = false; }
    }
    actions.append(button('刷新信息与自检', () => void refreshAbout()), button('复制全部信息', async () => {
      if (!aboutData) await refreshAbout();
      if (aboutData) { await api.copyText(JSON.stringify(aboutData, null, 2)); aboutStatus.textContent = '已复制桌面版信息'; }
    }), button('检查桌面版更新', async () => {
      try {
        aboutStatus.textContent = '正在检查 GitHub Releases…';
        const result = await api.checkAppUpdateNow();
        if (result.lastError || result.installError) throw new Error(result.lastError || result.installError);
        aboutStatus.textContent = result.hasUpdate ? '发现新版本，请查看“应用更新”中的进度或下载页。' : '当前已是最新版本';
      } catch (error) { aboutStatus.textContent = error.message || '检查更新失败'; }
    }));
    about.body.append(actions, aboutStatus);
    about.root.addEventListener('toggle', () => {
      if (about.root.open) {
        void refreshAbout();
        about.root.scrollIntoView({block: 'start'});
      }
    });
  }
  window.WhaleMonitorSettings = {mount};
})();
