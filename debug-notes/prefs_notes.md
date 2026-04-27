# Zotero 官方文档 - Preference Pane 正确写法

## 关键发现

1. `src` 应该指向一个包含 XUL/XHTML **fragment** 的文件
2. **不能有 `<!DOCTYPE>`**
3. 默认命名空间是 XUL，HTML 标签通过 `html:` 前缀访问
4. 官方示例使用 `onload` 而不是 `onpaneload`

## 官方示例

```xml
<vbox onload="MakeItRed_Preferences.init()">
  <groupbox>
    <label><html:h2>Colors</html:h2></label>
    <!-- [...] -->
  </groupbox>
</vbox>
```

## FTL 加载方式

```xml
<linkset>
  <html:link rel="localization" href="make-it-red.ftl"/>
</linkset>
```

## 偏好绑定

Zotero 7 直接绑定到偏好键，不需要 `<preference>` 标签：
```xml
<html:input type="text" preference="extensions.zotero.makeItRed.color"/>
```

## 注册方式

```js
Zotero.PreferencePanes.register({
  pluginID: 'make-it-red@zotero.org',
  src: 'prefs.xhtml',
  scripts: ['prefs.js'],
  stylesheets: ['prefs.css'],
});
```

注意：可以通过 `scripts` 选项加载外部脚本！

## 关键问题

当前 preferences.xhtml 的问题：
1. 有 `<?xml version="1.0"?>` 声明 — 可能导致解析问题
2. 有 `<?xml-stylesheet ...?>` 处理指令
3. 使用了 `onpaneload` 而不是 `onload`
4. 内嵌了 `<script>` 块 — 可能在 fragment 中不被支持

修复方案：
- 移除 XML 声明和 xml-stylesheet 处理指令
- 使用 `scripts` 选项加载外部脚本
- 或者直接移除脚本，只保留纯 XUL 表单
