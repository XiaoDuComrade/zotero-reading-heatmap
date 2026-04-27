const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化数据库
const dbPath = path.join(__dirname, 'heatmap.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database opening error: ', err);
  else console.log('Database connected at:', dbPath);
});

db.serialize(() => {
  // 创建设备表
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    userName TEXT,
    lastSyncAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 创建群组表
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT,
    inviteCode TEXT UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 创建群组-设备关联表
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    groupId TEXT,
    deviceId TEXT,
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (groupId, deviceId)
  )`);

  // 创建阅读数据表
  db.run(`CREATE TABLE IF NOT EXISTS reading_stats (
    deviceId TEXT,
    dateStr TEXT,
    totalSeconds INTEGER,
    itemsJson TEXT,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (deviceId, dateStr)
  )`);
});

// API: 健康检查
app.get('/api/health', (req, res) => {
  res.json({ success: true, version: '1.0.0', uptime: process.uptime() });
});

// API: 注册设备
app.post('/api/register', (req, res) => {
  const { deviceId, userName } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' });
  
  db.run(`INSERT OR REPLACE INTO devices (id, userName, lastSyncAt) VALUES (?, ?, CURRENT_TIMESTAMP)`, 
    [deviceId, userName || 'Anonymous'], 
    (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true });
  });
});

// API: 创建群组
app.post('/api/group/create', (req, res) => {
  const { deviceId, groupName } = req.body;
  if (!deviceId || !groupName) return res.status(400).json({ success: false, error: 'Missing parameters' });

  const groupId = uuidv4();
  // 生成 6 位大写字母数字邀请码
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  db.run(`INSERT INTO groups (id, name, inviteCode) VALUES (?, ?, ?)`, [groupId, groupName, inviteCode], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    
    db.run(`INSERT INTO group_members (groupId, deviceId) VALUES (?, ?)`, [groupId, deviceId], (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, group: { id: groupId, name: groupName, inviteCode } });
    });
  });
});

// API: 加入群组
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

// API: 获取群组成员列表
app.get('/api/group/:groupId/members', (req, res) => {
  const { groupId } = req.params;

  const query = `
    SELECT d.id, d.userName, d.lastSyncAt, m.joinedAt
    FROM group_members m
    LEFT JOIN devices d ON m.deviceId = d.id
    WHERE m.groupId = ?
  `;

  db.all(query, [groupId], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, members: rows });
  });
});

// API: 上传阅读数据
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

// API: 下载群组数据
app.get('/api/sync/download/:groupId', (req, res) => {
  const { groupId } = req.params;
  const days = parseInt(req.query.days) || 180;
  
  // 计算起始日期
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
    
    // 格式化返回数据：按设备分组
    const result = {};
    rows.forEach(row => {
      if (!result[row.deviceId]) {
        result[row.deviceId] = { userName: row.userName || 'Anonymous', stats: {} };
      }
      result[row.deviceId].stats[row.dateStr] = {
        totalSeconds: row.totalSeconds,
        items: JSON.parse(row.itemsJson || '{}')
      };
    });
    
    res.json({ success: true, data: result });
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Zotero Reading Heatmap Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
