# v0.4.0 修复要点

## 核心问题
Zotero 官方文档的 registerSection 示例中使用的是 `body.textContent`，而不是 `body.innerHTML`。
这说明 `body` 元素是一个 XUL 元素（在 XHTML 命名空间中），直接设置 `innerHTML` 不会渲染 HTML 标签，
而是将其作为纯文本显示。

## 解决方案
1. 使用 `document.createElementNS("http://www.w3.org/1999/xhtml", "div")` 创建 HTML 元素
2. 然后在这个 HTML div 上设置 innerHTML
3. 将这个 div 追加到 body 中

或者更简单的方式：
- 使用 `body.ownerDocument.createElementNS` 创建一个 HTML 容器
- 在容器上使用 innerHTML

Better Notes 的 link.ts 中的 bodyXHTML 包含 linkset，说明 body 确实支持 XHTML 内容，
但需要通过正确的命名空间来创建 HTML 元素。

## 关于 preferences.xhtml 无响应
preferences.xhtml 中使用 `oncommand="Zotero.ReadingHeatmap.onCreateGroup(...)"` 
但设置窗口可能在不同的上下文中运行，无法访问 Zotero.ReadingHeatmap。
需要检查是否需要通过 Services.scriptloader 加载脚本到设置窗口。
