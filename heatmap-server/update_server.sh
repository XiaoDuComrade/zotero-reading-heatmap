#!/bin/bash
# Zotero Reading Heatmap Server - 一键更新脚本
# 用途: 将已部署的服务器从 v1.0.0 更新到 v1.1.0（新增 userColor 同步支持）
# 说明: 此脚本会保留现有数据库，仅更新 server.js 代码并重启服务
# 适配: Alibaba Cloud Linux 2/3, CentOS 7/8, Ubuntu, Debian

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 默认配置（与安装脚本一致）
INSTALL_DIR="/opt/zotero-heatmap-server"
PORT=3456

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}  Zotero Reading Heatmap Server 一键更新脚本${NC}"
echo -e "${BLUE}  v1.0.0 -> v1.1.0 (新增 userColor 同步)${NC}"
echo -e "${BLUE}======================================================${NC}"
echo ""

# 1. 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[错误] 请使用 root 权限运行此脚本 (sudo bash update_server.sh)${NC}"
  exit 1
fi

# 2. 检查安装目录是否存在
echo -e "${YELLOW}[1/4] 检查现有安装...${NC}"
if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${RED}[错误] 未找到安装目录 ${INSTALL_DIR}，请先运行 install_server.sh 进行初始安装。${NC}"
  exit 1
fi

if [ ! -f "$INSTALL_DIR/server.js" ]; then
  echo -e "${RED}[错误] 未找到 ${INSTALL_DIR}/server.js，安装可能不完整。${NC}"
  exit 1
fi

# 检查当前版本
CURRENT_VERSION=$(grep -o '"version": "[^"]*"' "$INSTALL_DIR/server.js" 2>/dev/null | head -1 | grep -o '[0-9.]*' || echo "1.0.0")
echo -e "当前版本: ${BLUE}v${CURRENT_VERSION}${NC}"
echo -e "目标版本: ${GREEN}v1.1.0${NC}"

# 3. 备份现有文件
echo -e "${YELLOW}[2/4] 备份现有文件...${NC}"
BACKUP_DIR="${INSTALL_DIR}/backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp "$INSTALL_DIR/server.js" "$BACKUP_DIR/server.js.bak"
if [ -f "$INSTALL_DIR/heatmap.db" ]; then
  cp "$INSTALL_DIR/heatmap.db" "$BACKUP_DIR/heatmap.db.bak"
  echo -e "已备份数据库到 ${BLUE}${BACKUP_DIR}/heatmap.db.bak${NC}"
fi
echo -e "已备份 server.js 到 ${BLUE}${BACKUP_DIR}/server.js.bak${NC}"

# 4. 更新 server.js
echo -e "${YELLOW}[3/4] 更新 server.js...${NC}"
cat > "$INSTALL_DIR/server.js" << 'SERVEREOF'
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
  else console.log('Database connected at:', dbPath);
});

db.serialize(() => {
  // 创建设备表（含 userColor 字段）
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    userName TEXT,
    userColor TEXT DEFAULT '#216e39',
    lastSyncAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 兼容升级：为已有的 devices 表添加 userColor 列（如果不存在）
  db.run(`ALTER TABLE devices ADD COLUMN userColor TEXT DEFAULT '#216e39'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('ALTER TABLE error:', err.message);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, inviteCode TEXT UNIQUE, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (groupId TEXT, deviceId TEXT, joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (groupId, deviceId))`);
  db.run(`CREATE TABLE IF NOT EXISTS reading_stats (deviceId TEXT, dateStr TEXT, totalSeconds INTEGER, itemsJson TEXT, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (deviceId, dateStr))`);
});

app.get('/api/health', (req, res) => res.json({ success: true, version: '1.1.0', uptime: process.uptime() }));

// 注册设备（支持 userColor）
app.post('/api/register', (req, res) => {
  const { deviceId, userName, userColor } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' });
  const color = userColor || '#216e39';
  db.run(`INSERT OR REPLACE INTO devices (id, userName, userColor, lastSyncAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    [deviceId, userName || 'Anonymous', color],
    (err) => {
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

// 获取群组成员列表（含 userColor）
app.get('/api/group/:groupId/members', (req, res) => {
  const { groupId } = req.params;
  const query = `
    SELECT d.id, d.userName, d.userColor, d.lastSyncAt, m.joinedAt
    FROM group_members m
    LEFT JOIN devices d ON m.deviceId = d.id
    WHERE m.groupId = ?
  `;
  db.all(query, [groupId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, members: rows });
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

// 下载群组数据（含 userColor）
app.get('/api/sync/download/:groupId', (req, res) => {
  const { groupId } = req.params;
  const days = parseInt(req.query.days) || 180;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const query = `
    SELECT r.deviceId, d.userName, d.userColor, r.dateStr, r.totalSeconds, r.itemsJson
    FROM reading_stats r
    JOIN group_members m ON r.deviceId = m.deviceId
    LEFT JOIN devices d ON r.deviceId = d.id
    WHERE m.groupId = ? AND r.dateStr >= ?
  `;

  db.all(query, [groupId, startDateStr], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const result = {};
    rows.forEach(row => {
      if (!result[row.deviceId]) {
        result[row.deviceId] = {
          userName: row.userName || 'Anonymous',
          userColor: row.userColor || '#216e39',
          stats: {}
        };
      }
      result[row.deviceId].stats[row.dateStr] = {
        totalSeconds: row.totalSeconds,
        items: JSON.parse(row.itemsJson || '{}')
      };
    });
    res.json({ success: true, data: result });
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Zotero Reading Heatmap Server v1.1.0 is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
SERVEREOF

echo -e "${GREEN}server.js 已更新到 v1.1.0${NC}"

# 5. 重启服务
echo -e "${YELLOW}[4/4] 重启服务...${NC}"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart zotero-heatmap
  pm2 save
  echo -e "${GREEN}PM2 服务已重启${NC}"
else
  echo -e "${RED}[警告] 未找到 PM2，请手动重启服务。${NC}"
  echo -e "可以运行: cd ${INSTALL_DIR} && node server.js"
fi

# 6. 验证更新
echo ""
sleep 2
echo -e "${YELLOW}验证更新...${NC}"
HEALTH=$(curl -s http://localhost:${PORT}/api/health 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"version":"1.1.0"'; then
  echo -e "${GREEN}验证成功！服务器已更新到 v1.1.0${NC}"
elif echo "$HEALTH" | grep -q '"success":true'; then
  echo -e "${YELLOW}服务器正在运行，但版本号可能未更新。请检查日志: pm2 logs zotero-heatmap${NC}"
else
  echo -e "${RED}验证失败，服务器可能未正常启动。请检查日志: pm2 logs zotero-heatmap${NC}"
fi

echo ""
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}  更新完成！${NC}"
echo -e "${GREEN}======================================================${NC}"
echo ""
echo -e "更新内容:"
echo -e "  - devices 表新增 ${BLUE}userColor${NC} 字段（自动兼容升级，不影响现有数据）"
echo -e "  - ${BLUE}/api/register${NC} 接口支持接收 userColor 参数"
echo -e "  - ${BLUE}/api/sync/download${NC} 接口返回每个成员的 userColor"
echo -e "  - ${BLUE}/api/group/:groupId/members${NC} 接口返回 userColor"
echo -e ""
echo -e "备份位置: ${BLUE}${BACKUP_DIR}${NC}"
echo -e "如需回滚: ${BLUE}cp ${BACKUP_DIR}/server.js.bak ${INSTALL_DIR}/server.js && pm2 restart zotero-heatmap${NC}"
echo ""
