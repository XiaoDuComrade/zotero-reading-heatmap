# Zotero Reading Heatmap 中文说明

Zotero Reading Heatmap 是一个 Zotero 插件，用于记录 Zotero 窗口处于活跃状态时的阅读时间，并在 Zotero 右侧栏中以类似 GitHub contribution graph 的热力图方式展示阅读活动。

## 主要功能

- 记录 Zotero 活跃窗口时间，不再依赖 PDF 滚动事件。
- 支持月视图和周视图热力图。
- 支持个人视图和团队视图。
- 通过可选后端服务支持团队阅读数据同步。
- 团队视图支持 combined 聚合模式和 overlay 多成员条纹模式。
- 支持从 Zotero Style 数据中导入历史阅读记录。
- 支持 CSV 和 JSON 导出备份。

## 安装方式

1. 从仓库的 `xpi/` 目录或 GitHub Releases 下载最新 `.xpi` 文件。
2. 打开 Zotero。
3. 进入 **工具 > 附加组件**。
4. 选择 **Install Add-on From File... / 从文件安装附加组件**。
5. 选择下载的 `.xpi` 文件并重启 Zotero。

## 兼容性

| Zotero 版本 | 状态 |
|---|---|
| Zotero 7.x | 支持 |
| Zotero 8.x | 支持 |
| Zotero 9.x | manifest 范围内支持，Zotero 更新后建议重新测试 |
| Zotero 6.x 及以下 | 不支持 |

## 团队同步

团队同步需要部署可选的后端服务。参见：

- [后端部署指南](./SERVER_DEPLOYMENT_ZH.md)
- [Backend deployment guide](./SERVER_DEPLOYMENT.md)

## 维护说明

插件运行时代码目前仍集中在 `addon/chrome/content/scripts/reading-heatmap.js`，这是为了降低 Zotero 插件加载、chrome URL 和 XPI 打包路径带来的兼容风险。后续可以考虑将开发源码拆成模块，再在打包时生成 Zotero 运行所需的单文件。

`.xpi` 打包需要特别小心：`manifest.json` 必须位于压缩包根目录，不要把 `addon/` 目录本身打进去。

## 许可证

本项目使用 GNU General Public License v3.0。详见 [LICENSE](../LICENSE)。
