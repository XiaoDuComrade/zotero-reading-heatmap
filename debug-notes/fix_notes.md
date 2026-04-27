# 修复要点

## 根本原因
1. Zotero 8 的 `ItemPaneManager.registerSection()` 要求 `header.l10nID` 是必填的，且对应的 FTL 资源必须已经加载到窗口中。
2. Better Notes 的做法是在 `bodyXHTML` 中通过 `<html:link rel="localization" href="...ftl">` 来加载 FTL 资源。
3. FTL 中的 l10nID 格式必须是 `message-id = \n    .label = Text` 的形式（带 `.label` 属性），而不是简单的 `message-id = Text`。

## Better Notes 的 FTL 格式（正确）
```ftl
note-inbound-header =
    .label = Inbound Links
note-inbound-sidenav =
    .tooltiptext = Inbound Links
```

## 当前 Reading Heatmap 的 FTL 格式（错误）
```ftl
reading-heatmap-section-header = Reading Heatmap
reading-heatmap-sidenav = Heatmap
```

## Better Notes registerSection 关键点
- `bodyXHTML` 中包含 `<html:link rel="localization" href="addonRef-noteRelation.ftl">` 来加载 FTL
- `header.l10nID` 引用 FTL 中定义的 message ID
- `sidenav.l10nID` 引用 FTL 中定义的 message ID
- FTL 文件名格式: `{addonRef}-{name}.ftl`，放在 `locale/{lang}/` 目录下

## 修复方案
1. 修改 FTL 文件格式，使用 `.label` 和 `.tooltiptext` 属性
2. 在 registerSection 的 bodyXHTML 中通过 linkset 加载 FTL
3. 确保 renderer 在 init() 中被正确创建（可能是 _registerSection 抛异常导致后续代码被跳过）
4. 在 init() 中加入更好的错误处理，确保每个步骤独立
