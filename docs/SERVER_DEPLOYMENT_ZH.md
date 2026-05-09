# Zotero Reading Heatmap 后端服务器部署与对接文档

本文档详细说明了如何为 Zotero Reading Heatmap 插件（v0.5.1 及以上版本）部署配套的 Node.js 后端服务器，以实现多人阅读打卡、群组同步等核心功能。

---

## 1. 架构概述

**Zotero Reading Heatmap Server** 是一个轻量级的 Node.js 服务：
- **框架**：Express.js
- **数据库**：SQLite3（单文件存储，无需配置复杂数据库）
- **进程管理**：PM2（守护进程、开机自启）
- **核心功能**：设备注册、群组创建/加入、阅读数据上传与拉取

---

## 2. 快速部署（一键安装）

针对 **阿里云 Cloud Linux**（CentOS/Alibaba Cloud Linux/Ubuntu）等常见 Linux 发行版，我们提供了一键安装脚本。

### 2.1 运行一键安装脚本
将项目中的 `install_server.sh` 上传到您的服务器，然后执行：

```bash
chmod +x install_server.sh
sudo bash install_server.sh
```

脚本将自动完成以下工作：
1. 安装 Node.js 16.x（如果尚未安装）
2. 将后端代码部署到 `/opt/zotero-heatmap-server/`
3. 安装 `express`, `cors`, `sqlite3`, `uuid` 等 npm 依赖
4. 配置 PM2 守护进程并设置开机自启
5. 尝试开放 3456 端口（通过 firewalld 或 ufw）

### 2.2 阿里云安全组配置（必须）
由于阿里云 ECS 的安全组独立于系统防火墙，您**必须**在阿里云控制台手动开放端口：
1. 登录阿里云控制台 -> ECS 实例 -> 安全组 -> 配置规则
2. 添加**入方向**规则：
   - 协议类型：自定义 TCP
   - 端口范围：`3456/3456`
   - 授权对象：`0.0.0.0/0`

---

## 3. 手动部署（高级用户）

如果您不想使用一键脚本，或者需要在其他环境（如 Docker、Windows）部署，请参考以下步骤。

### 3.1 环境准备
- Node.js (>= 14.x)
- npm (Node Package Manager)

### 3.2 部署步骤
```bash
# 1. 复制后端代码目录
cp -r heatmap-server /opt/zotero-heatmap-server
cd /opt/zotero-heatmap-server

# 2. 安装依赖
npm install express cors sqlite3 uuid

# 3. 启动服务（测试）
node server.js
# 此时应看到输出: Server running on port 3456

# 4. 使用 PM2 守护进程运行（推荐）
npm install -g pm2
pm2 start server.js --name "zotero-heatmap"
pm2 save
pm2 startup
```

---

## 4. 插件端对接配置

服务器部署成功后，需要在 Zotero 插件中进行配置才能启用同步功能。

### 4.1 配置 Server URL
1. 打开 Zotero -> 编辑 -> 设置 -> Reading Heatmap
2. 在 **Server URL** 输入框中填入您的服务器地址，格式为：
   `http://<您的公网IP>:3456`
3. 点击下方的 **Test Connection** 按钮。
4. 如果显示绿色的 `Connected! Server v1.0.0`，说明对接成功。

### 4.2 HTTPS 配置（可选但推荐）
如果您的 Zotero 插件需要通过 HTTPS 连接服务器（提高安全性），您可以使用 Nginx 进行反向代理。

**Nginx 配置示例：**
```nginx
server {
    listen 443 ssl;
    server_name heatmap.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
配置完成后，在 Zotero 插件中将 Server URL 改为 `https://heatmap.yourdomain.com`。

---

## 5. API 接口文档

如果您需要开发第三方客户端或进行二次开发，请参考以下核心 API 接口。

| 接口路径 | 方法 | 说明 | 请求参数 |
|----------|------|------|----------|
| `/api/health` | GET | 健康检查与版本测试 | 无 |
| `/api/register` | POST | 注册设备与用户名 | `{ deviceId, userName }` |
| `/api/group/create` | POST | 创建新群组 | `{ deviceId, groupName }` |
| `/api/group/join` | POST | 通过邀请码加入群组 | `{ deviceId, inviteCode }` |
| `/api/sync/upload` | POST | 上传阅读数据 | `{ deviceId, stats: { date: {totalSeconds} } }` |
| `/api/sync/download/:groupId` | GET | 获取群组所有成员数据 | `?days=180` (可选) |

---

*文档生成时间：2026年4月27日*
*作者：Manus AI*
