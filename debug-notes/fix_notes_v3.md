# 关键发现

从 Zotero 源码 itemPaneManager.js 第 61 行和第 79 行可以看到：
- `@property {HTMLDivElement} body - Section body.`

body 是一个 **HTMLDivElement**，不是 XUL 元素！

这意味着 `body.innerHTML` 应该是可以工作的。

但从用户截图来看，HTML 被当作纯文本渲染了。可能的原因：
1. body 虽然声明为 HTMLDivElement，但实际上可能在 XUL 文档上下文中
2. SVG 标签中没有正确的命名空间
3. 或者 innerHTML 赋值时有某种安全限制

从截图看，显示的内容是：
```
0minTotal0dActive0dStreak0dBestAprMayJunJul...
| 0min2025-04-29 | 0min2025-04-30 | ...
```

这看起来像是 HTML 标签被完全剥离了，只留下了文本内容。
这说明 innerHTML 赋值确实执行了，但 HTML 标签被过滤/剥离了。

这可能是 Zotero 的安全策略：在 section body 中使用 innerHTML 时，
HTML 标签会被 sanitize/strip。

## 解决方案
使用 DOM API 创建所有元素，不使用 innerHTML。
或者使用 `body.ownerDocument.createRange().createContextualFragment()` 来解析 HTML。
或者使用 DOMParser。
