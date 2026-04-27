# 最终修复方案 - 基于 Zotero 源码分析

## 关键发现

从 Zotero 源码 `itemPaneManager.js` 第 532-538 行的官方示例：

```javascript
onRender: ({doc, body, item}) => {
    // Create elements and append them to `body`
    const div = doc.createElement('div');
    div.classList.add('my-plugin-section');
    div.textContent = item.getField('title');
    body.appendChild(div);
},
```

**官方推荐的方式是使用 `doc.createElement()` + `body.appendChild()`，而不是 `body.innerHTML`。**

虽然 body 的类型是 `HTMLDivElement`，但在 Zotero 的 XUL/XHTML 文档上下文中，
`innerHTML` 可能会被安全策略过滤掉 HTML 标签（从用户截图可以看到标签被完全剥离了）。

## bodyXHTML 选项
第 466 行：`@param {string} [options.bodyXHTML] - Pane body's innerHTML, defaults to XUL namespace.`

这说明可以通过 `bodyXHTML` 选项在注册时设置 body 的初始 HTML 内容。
但这是 XUL 命名空间的，对于 HTML 元素需要使用 `html:` 前缀。

## 修复方案

### 方案 A：纯 DOM API（推荐）
在 `onRender` 中使用 `doc.createElement()` 创建所有元素，不使用 innerHTML。
这是官方推荐的方式，最安全可靠。

### 方案 B：bodyXHTML + onRender
使用 `bodyXHTML` 设置静态结构，在 `onRender` 中填充动态数据。

### 选择方案 A
因为热力图是动态生成的（365个格子），使用纯 DOM API 更灵活。

## 关于 FTL
源码第 513 行注释：`// Must inject the corresponding ftl file`
这确认了 FTL 文件必须被注入到文档中。
