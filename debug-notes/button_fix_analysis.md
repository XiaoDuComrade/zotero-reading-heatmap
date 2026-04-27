# Test Connection 和 Create Group 按钮无响应 - 问题分析

## 问题现象
在 Zotero 设置面板中，点击 "Test Connection" 和 "Create Group" 按钮没有任何反应。

## 根因分析

经过对所有相关文件的完整审查，发现了以下问题：

### 问题 1：`_bindButton` 中的双重事件监听器冲突（prefs.js 第 99-124 行）

`_bindButton` 方法同时注册了 `command` 和 `click` 两个事件，并使用 `_commandFired` 标志位来防止双重触发。
但问题在于：它注册了**两个** `command` 监听器：

```js
// 第一个 command 监听器（第 106 行）：调用 handler 并 preventDefault
btn.addEventListener("command", function(e) {
  e.preventDefault();   // <--- 问题！阻止了默认行为
  handler();
});

// 第二个 command 监听器（第 120 行，capture 阶段）：设置 _commandFired 标志
btn.addEventListener("command", function() {
  btn._commandFired = true;
  setTimeout(function() { btn._commandFired = false; }, 100);
}, true);
```

**关键问题**：
1. 第一个 `command` 监听器调用了 `e.preventDefault()`，这在 XUL `command` 事件中可能阻止事件的正常传播
2. capture 阶段的监听器先于 bubble 阶段执行，所以 `_commandFired` 在 handler 执行前就被设置为 `true`
3. 如果 `command` 事件触发后，紧接着也触发了 `click` 事件，`click` 处理器检查到 `_commandFired = true` 就会跳过执行——这是正确的
4. 但如果 Zotero 8 的 XUL button 在某些上下文中**只触发 `click` 而不触发 `command`**，那么 `click` 处理器本身不会被阻止，应该能正常工作

### 问题 2：preferences.xhtml 中缺少 `html:` 命名空间声明

当前 `preferences.xhtml` 的根元素：
```xml
<vbox xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
      xmlns:html="http://www.w3.org/1999/xhtml"
      id="reading-heatmap-prefs"
      onload="ReadingHeatmapPrefs.init();">
```

这里的 `onload` 属性是关键。在 Zotero 的 PreferencePanes 系统中，`src` 指向的 XHTML 文件是作为 **fragment** 加载的，而不是作为完整文档。这意味着：

- `onload` 事件可能**不会触发**，因为 fragment 不是一个独立的文档
- 如果 `onload` 不触发，`ReadingHeatmapPrefs.init()` 就永远不会被调用
- 所有按钮的事件监听器都不会被绑定
- 因此所有按钮都没有反应

### 问题 3：`prefs.js` 通过 `scripts` 选项加载，但 `init()` 依赖 `onload`

`_registerPrefsPane` 正确地通过 `scripts` 选项加载了 `prefs.js`：
```js
Zotero.PreferencePanes.register({
  scripts: [this.rootURI + "chrome/content/preferences/prefs.js"],
  ...
});
```

脚本会被加载并执行，`ReadingHeatmapPrefs` 对象会被定义。但 `init()` 方法需要通过 `onload` 触发。

## 修复方案

### 修复 1：确保 `init()` 被正确调用

在 Zotero PreferencePanes 中，fragment 的 `onload` 可能不会触发。需要改为在脚本加载时自动初始化，或使用 Zotero 支持的生命周期钩子。

**方案 A**：在 `prefs.js` 末尾添加自动初始化逻辑：
```js
// 在脚本加载时，等待 DOM 就绪后自动初始化
if (document.getElementById("reading-heatmap-prefs")) {
  ReadingHeatmapPrefs.init();
} else {
  document.addEventListener("DOMContentLoaded", function() {
    ReadingHeatmapPrefs.init();
  });
  // 也监听 load 作为后备
  window.addEventListener("load", function() {
    if (document.getElementById("reading-heatmap-prefs")) {
      ReadingHeatmapPrefs.init();
    }
  });
}
```

### 修复 2：简化 `_bindButton` 事件绑定

移除 `e.preventDefault()` 调用，简化双重事件防护逻辑。
