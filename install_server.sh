#!/bin/bash
# Zotero Reading Heatmap Server - 一键安装脚本
# 适配: Alibaba Cloud Linux 2/3, CentOS 7/8, Ubuntu, Debian
# 作者: Manus AI

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 默认配置
INSTALL_DIR="/opt/zotero-heatmap-server"
PORT=3456

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}  Zotero Reading Heatmap Server 一键部署脚本${NC}"
echo -e "${BLUE}======================================================${NC}"
echo ""

# 1. 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[错误] 请使用 root 权限运行此脚本 (sudo bash install_server.sh)${NC}"
  exit 1
fi

# 2. 检测操作系统和包管理器
echo -e "${YELLOW}[1/6] 检测系统环境...${NC}"
if command -v yum >/dev/null 2>&1; then
    PKG_MANAGER="yum"
    echo -e "检测到基于 RedHat/CentOS/Alibaba Cloud Linux 的系统"
elif command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt-get"
    echo -e "检测到基于 Debian/Ubuntu 的系统"
else
    echo -e "${RED}[错误] 不支持的操作系统，找不到 yum 或 apt-get。${NC}"
    exit 1
fi

# 3. 安装 Node.js 和 npm
echo -e "${YELLOW}[2/6] 检查并安装 Node.js...${NC}"
if ! command -v node >/dev/null 2>&1; then
    echo -e "正在安装 Node.js 16.x..."
    if [ "$PKG_MANAGER" == "yum" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_16.x | bash -
        yum install -y nodejs gcc-c++ make
    else
        curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
        apt-get install -y nodejs build-essential
    fi
else
    NODE_VER=$(node -v)
    echo -e "Node.js 已安装: ${GREEN}${NODE_VER}${NC}"
fi

# 4. 创建项目目录并写入代码
echo -e "${YELLOW}[3/6] 部署服务器代码...${NC}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo -e "生成 package.json..."
cat > package.json << 'EOF'
{
  "name": "zotero-reading-heatmap-server",
  "version": "1.0.0",
  "description": "Backend server for Zotero Reading Heatmap plugin",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "uuid": "^9.0.0"
  }
}
EOF

echo -e "生成 server.js..."
cat > server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const dbPath = path.join(__dirname, 'heatmap.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database opening error: ', err);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, userName TEXT, lastSyncAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, inviteCode TEXT UNIQUE, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (groupId TEXT, deviceId TEXT, joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (groupId, deviceId))`);
  db.run(`CREATE TABLE IF NOT EXISTS reading_stats (deviceId TEXT, dateStr TEXT, totalSeconds INTEGER, itemsJson TEXT, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (deviceId, dateStr))`);
});

app.get('/api/health', (req, res) => res.json({ success: true, version: '1.0.0' }));

app.post('/api/register', (req, res) => {
  const { deviceId, userName } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' });
  db.run(`INSERT OR REPLACE INTO devices (id, userName, lastSyncAt) VALUES (?, ?, CURRENT_TIMESTAMP)`, [deviceId, userName || 'Anonymous'], (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true });
  });
});

app.post('/api/group/create', (req, res) => {
  const { deviceId, groupName } = req.body;
  if (!deviceId || !groupName) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const groupId = uuidv4();
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  db.run(`INSERT INTO groups (id, name, inviteCode) VALUES (?, ?, ?)`, [groupId, groupName, inviteCode], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    db.run(`INSERT INTO group_members (groupId, deviceId) VALUES (?, ?)`, [groupId, deviceId], (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, group: { id: groupId, name: groupName, inviteCode } });
    });
  });
});

app.post('/api/group/join', (req, res) => {
  const { deviceId, inviteCode } = req.body;
  if (!deviceId || !inviteCode) return res.status(400).json({ success: false, error: 'Missing parameters' });
  db.get(`SELECT id, name FROM groups WHERE inviteCode = ?`, [inviteCode.toUpperCase()], (err, group) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    db.run(`INSERT OR IGNORE INTO group_members (groupId, deviceId) VALUES (?, ?)`, [group.id, deviceId], (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, group: { id: group.id, name: group.name, inviteCode: inviteCode.toUpperCase() } });
    });
  });
});

app.post('/api/sync/upload', (req, res) => {
  const { deviceId, stats } = req.body;
  if (!deviceId || !stats) return res.status(400).json({ success: false, error: 'Missing parameters' });
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare(`INSERT OR REPLACE INTO reading_stats (deviceId, dateStr, totalSeconds, itemsJson, updatedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`);
    for (const [dateStr, dayData] of Object.entries(stats)) {
      stmt.run([deviceId, dateStr, dayData.totalSeconds, JSON.stringify(dayData.items)]);
    }
    stmt.finalize();
    db.run(`UPDATE devices SET lastSyncAt = CURRENT_TIMESTAMP WHERE id = ?`, [deviceId]);
    db.run('COMMIT', (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true });
    });
  });
});

app.get('/api/sync/download/:groupId', (req, res) => {
  const { groupId } = req.params;
  const days = parseInt(req.query.days) || 180;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const query = `
    SELECT r.deviceId, d.userName, r.dateStr, r.totalSeconds, r.itemsJson
    FROM reading_stats r
    JOIN group_members m ON r.deviceId = m.deviceId
    LEFT JOIN devices d ON r.deviceId = d.id
    WHERE m.groupId = ? AND r.dateStr >= ?
  `;

  db.all(query, [groupId, startDateStr], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const result = {};
    rows.forEach(row => {
      if (!result[row.deviceId]) result[row.deviceId] = { userName: row.userName || 'Anonymous', stats: {} };
      result[row.deviceId].stats[row.dateStr] = { totalSeconds: row.totalSeconds, items: JSON.parse(row.itemsJson || '{}') };
    });
    res.json({ success: true, data: result });
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
EOF

# 5. 安装依赖
echo -e "${YELLOW}[4/6] 安装 npm 依赖...${NC}"
npm install --production

# 6. 配置 PM2 守护进程
echo -e "${YELLOW}[5/6] 配置 PM2 守护进程...${NC}"
if ! command -v pm2 >/dev/null 2>&1; then
    echo -e "正在全局安装 PM2..."
    npm install -g pm2
fi

pm2 stop zotero-heatmap 2>/dev/null || true
pm2 start server.js --name "zotero-heatmap"
pm2 save
pm2 startup | grep "sudo env" | bash || true

# 7. 配置防火墙
echo -e "${YELLOW}[6/6] 配置防火墙开放 ${PORT} 端口...${NC}"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --zone=public --add-port=${PORT}/tcp --permanent
    firewall-cmd --reload
    echo -e "已通过 firewalld 开放端口"
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow ${PORT}/tcp
    echo -e "已通过 ufw 开放端口"
else
    echo -e "${BLUE}提示: 未检测到开启的本地防火墙(firewalld/ufw)。${NC}"
fi

# 获取公网IP
PUBLIC_IP=$(curl -s ifconfig.me || echo "YOUR_SERVER_IP")

echo -e ""
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}  部署完成！Zotero Reading Heatmap Server 正在运行。${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e ""
echo -e "服务器状态: ${BLUE}pm2 status zotero-heatmap${NC}"
echo -e "查看日志:   ${BLUE}pm2 logs zotero-heatmap${NC}"
echo -e "安装目录:   ${BLUE}${INSTALL_DIR}${NC}"
echo -e ""
echo -e "${YELLOW}【重要提醒 - 阿里云安全组设置】${NC}"
echo -e "如果您使用的是阿里云 ECS，除了本地防火墙外，您${RED}必须${NC}在阿里云控制台配置安全组："
echo -e "1. 登录阿里云控制台 -> ECS实例 -> 安全组 -> 配置规则"
echo -e "2. 添加入方向规则："
echo -e "   - 协议类型: 自定义 TCP"
echo -e "   - 端口范围: ${PORT}/${PORT}"
echo -e "   - 授权对象: 0.0.0.0/0"
echo -e ""
echo -e "${YELLOW}【插件端配置】${NC}"
echo -e "在 Zotero 插件设置中，将 Server URL 填写为："
echo -e "${GREEN}http://${PUBLIC_IP}:${PORT}${NC}"
echo -e ""
EOF
chmod +x /home/ubuntu/zotero-reading-heatmap-0.5.0-build/install_server.sh
