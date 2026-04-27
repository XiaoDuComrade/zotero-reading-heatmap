
/**
 * Reading Heatmap - Main Plugin Script v0.5.1
 * All modules bundled into one file for simplicity.
 * 
 * IMPORTANT: All UI rendering uses DOM API (createElement / createElementNS)
 * instead of innerHTML, because Zotero 8's ItemPane section body strips HTML tags
 * when innerHTML is used.
 * 
 * Changes in v0.5.1:
 * - Sidebar: removed Import/Export buttons, added Group/Personal view toggle
 * - Settings: added Test Server button
 * - Fixed group management buttons (command -> click event)
 * - Full group sync: download + render group members' heatmaps
 * - SyncManager: testServer(), improved error handling
 */

// ============================================================
// SECTION 1: StorageManager
// ============================================================

class StorageManager {
  constructor() {
    this.data = null;
    this.filePath = null;
    this.saveTimer = null;
    this.dirty = false;
    this.FILENAME = "zotero-reading-heatmap.json";
  }

  async init() {
    this.filePath = PathUtils.join(Zotero.DataDirectory.dir, this.FILENAME);
    await this._load();
    Zotero.debug("[ReadingHeatmap:Storage] Initialized at " + this.filePath);
  }

  async _load() {
    try {
      if (await IOUtils.exists(this.filePath)) {
        var content = await IOUtils.readUTF8(this.filePath);
        this.data = JSON.parse(content);
        Zotero.debug("[ReadingHeatmap:Storage] Loaded existing data");
      } else {
        this._initEmpty();
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Storage] Load error: " + e);
      this._initEmpty();
    }
  }

  _initEmpty() {
    this.data = {
      deviceId: Zotero.Utilities.randomString(32),
      userName: "",
      dailyStats: {},
      groups: {},
    };
    this._save();
  }

  getToday() {
    var now = new Date();
    return now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
  }

  formatDate(date) {
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  addReadingTime(itemKey, title, seconds) {
    var today = this.getToday();
    if (!this.data.dailyStats[today]) {
      this.data.dailyStats[today] = { totalSeconds: 0, items: {} };
    }
    var dayData = this.data.dailyStats[today];
    dayData.totalSeconds += seconds;
    if (!dayData.items[itemKey]) {
      dayData.items[itemKey] = { seconds: 0, title: title };
    }
    dayData.items[itemKey].seconds += seconds;
    dayData.items[itemKey].title = title;
    this.dirty = true;
    this._scheduleSave();
  }

  addReadingTimeToDate(dateStr, itemKey, title, seconds) {
    if (!this.data.dailyStats[dateStr]) {
      this.data.dailyStats[dateStr] = { totalSeconds: 0, items: {} };
    }
    var dayData = this.data.dailyStats[dateStr];
    dayData.totalSeconds += seconds;
    if (!dayData.items[itemKey]) {
      dayData.items[itemKey] = { seconds: 0, title: title };
    }
    dayData.items[itemKey].seconds += seconds;
    dayData.items[itemKey].title = title;
    this.dirty = true;
  }

  getDailyStats(days) {
    days = days || 365;
    var result = {};
    var now = new Date();
    for (var i = 0; i < days; i++) {
      var date = new Date(now);
      date.setDate(date.getDate() - i);
      var dateStr = this.formatDate(date);
      result[dateStr] = this.data.dailyStats[dateStr] || { totalSeconds: 0, items: {} };
    }
    return result;
  }

  getMonthlyStats(year, month) {
    var result = {};
    var daysInMonth = new Date(year, month, 0).getDate();
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      result[dateStr] = this.data.dailyStats[dateStr] || { totalSeconds: 0, items: {} };
    }
    return result;
  }

  getMonthlySummary(year, month) {
    var stats = this.getMonthlyStats(year, month);
    var totalSeconds = 0, activeDays = 0, maxSeconds = 0;

    for (var dateStr in stats) {
      var dayData = stats[dateStr];
      if (dayData && dayData.totalSeconds > 0) {
        totalSeconds += dayData.totalSeconds;
        activeDays++;
        if (dayData.totalSeconds > maxSeconds) maxSeconds = dayData.totalSeconds;
      }
    }

    var daysInMonth = new Date(year, month, 0).getDate();
    var currentStreak = 0, maxStreak = 0, tempStreak = 0;
    var today = new Date();
    var todayStr = this.formatDate(today);

    for (var day = 1; day <= daysInMonth; day++) {
      var ds = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      if (ds > todayStr) break;
      if (stats[ds] && stats[ds].totalSeconds > 0) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    var endDay = (year === today.getFullYear() && month === today.getMonth() + 1) 
      ? today.getDate() : daysInMonth;
    for (var d = endDay; d >= 1; d--) {
      var ds2 = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (stats[ds2] && stats[ds2].totalSeconds > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    return { totalSeconds, activeDays, maxSeconds, currentStreak, maxStreak };
  }

  /**
   * Compute monthly summary from arbitrary stats object (for group data)
   */
  computeSummaryFromStats(stats, year, month) {
    var totalSeconds = 0, activeDays = 0, maxSeconds = 0;
    for (var dateStr in stats) {
      var dayData = stats[dateStr];
      if (dayData && dayData.totalSeconds > 0) {
        totalSeconds += dayData.totalSeconds;
        activeDays++;
        if (dayData.totalSeconds > maxSeconds) maxSeconds = dayData.totalSeconds;
      }
    }

    var daysInMonth = new Date(year, month, 0).getDate();
    var currentStreak = 0, maxStreak = 0, tempStreak = 0;
    var today = new Date();
    var todayStr = this.formatDate(today);

    for (var day = 1; day <= daysInMonth; day++) {
      var ds = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      if (ds > todayStr) break;
      if (stats[ds] && stats[ds].totalSeconds > 0) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    var endDay = (year === today.getFullYear() && month === today.getMonth() + 1)
      ? today.getDate() : daysInMonth;
    for (var d = endDay; d >= 1; d--) {
      var ds2 = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (stats[ds2] && stats[ds2].totalSeconds > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    return { totalSeconds, activeDays, maxSeconds, currentStreak, maxStreak };
  }

  getSummary() {
    var stats = this.getDailyStats(365);
    var totalSeconds = 0, activeDays = 0, maxSeconds = 0;
    var currentStreak = 0, maxStreak = 0;
    var today = new Date();
    var streakBroken = false;

    for (var i = 0; i < 365; i++) {
      var date = new Date(today);
      date.setDate(date.getDate() - i);
      var dateStr = this.formatDate(date);
      var dayData = stats[dateStr];
      if (dayData && dayData.totalSeconds > 0) {
        totalSeconds += dayData.totalSeconds;
        activeDays++;
        if (dayData.totalSeconds > maxSeconds) maxSeconds = dayData.totalSeconds;
        if (!streakBroken) currentStreak++;
      } else if (i > 0) {
        streakBroken = true;
      }
    }

    var tempStreak = 0;
    for (var j = 364; j >= 0; j--) {
      var d = new Date(today);
      d.setDate(d.getDate() - j);
      var ds = this.formatDate(d);
      if (stats[ds] && stats[ds].totalSeconds > 0) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    return { totalSeconds, activeDays, maxSeconds, currentStreak, maxStreak };
  }

  _scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = Zotero.setTimeout(() => {
      this._save();
      this.saveTimer = null;
    }, 5000);
  }

  async _save() {
    if (!this.data) return;
    try {
      await IOUtils.writeUTF8(this.filePath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Storage] Save error: " + e);
    }
  }

  async forceSave() {
    if (this.saveTimer) {
      Zotero.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this._save();
  }

  getDeviceId() { return this.data.deviceId; }
  getUserName() { return this.data.userName || "Anonymous"; }
  setUserName(name) { this.data.userName = name; this._scheduleSave(); }
  getGroups() { return this.data.groups || {}; }
  addGroup(id, info) { this.data.groups[id] = info; this._scheduleSave(); }
  removeGroup(id) { delete this.data.groups[id]; this._scheduleSave(); }
}


// ============================================================
// SECTION 2: ReadingTracker
// ============================================================

class ReadingTracker {
  constructor(storage) {
    this.storage = storage;
    this.pollInterval = null;
    this.notifierID = null;
    this.isTracking = false;
    this.currentItemKey = null;
    this.currentItemTitle = null;
    this.lastPosition = { left: 0, top: 0 };
    this.idleCount = 0;
    this.POLL_INTERVAL_MS = 10000;
    this.IDLE_THRESHOLD = 6;
    this.accumulatedSeconds = 0;
  }

  init() {
    this.notifierID = Zotero.Notifier.registerObserver(
      { notify: (event, type, ids, extraData) => this._onNotify(event, type, ids, extraData) },
      ["tab"]
    );
    this._checkCurrentTab();
    Zotero.debug("[ReadingHeatmap:Tracker] Initialized");
  }

  shutdown() {
    this._stopPolling();
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
    this._flushAccumulated();
  }

  _onNotify(event, type, ids, extraData) {
    if (type === "tab") {
      Zotero.setTimeout(() => this._checkCurrentTab(), 500);
    }
  }

  _checkCurrentTab() {
    try {
      var win = Zotero.getMainWindow();
      if (!win || !win.Zotero_Tabs) return;
      var tab = win.Zotero_Tabs._getTab(win.Zotero_Tabs.selectedID);
      if (tab && tab.type === "reader") {
        this._onReaderTabActivated(win.Zotero_Tabs.selectedID);
      } else {
        this._onReaderTabDeactivated();
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Tracker] Check tab error: " + e);
    }
  }

  _onReaderTabActivated(tabId) {
    try {
      this._flushAccumulated();
      var reader = Zotero.Reader.getByTabID(tabId);
      if (!reader) return;
      var item = Zotero.Items.get(reader.itemID);
      if (!item) return;
      var parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : item;
      this.currentItemKey = parentItem.key;
      this.currentItemTitle = parentItem.getField("title") || "Untitled";
      this.isTracking = true;
      this.idleCount = 0;
      this.accumulatedSeconds = 0;
      this._startPolling();
      Zotero.debug("[ReadingHeatmap:Tracker] Tracking: " + this.currentItemTitle);
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Tracker] Activate error: " + e);
    }
  }

  _onReaderTabDeactivated() {
    this._flushAccumulated();
    this._stopPolling();
    this.isTracking = false;
    this.currentItemKey = null;
    this.currentItemTitle = null;
  }

  _startPolling() {
    if (this.pollInterval) return;
    this.pollInterval = Zotero.setInterval(() => this._poll(), this.POLL_INTERVAL_MS);
  }

  _stopPolling() {
    if (this.pollInterval) {
      Zotero.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  _poll() {
    if (!this.isTracking || !this.currentItemKey) return;
    try {
      var win = Zotero.getMainWindow();
      if (!win || !win.Zotero_Tabs) return;
      var tab = win.Zotero_Tabs._getTab(win.Zotero_Tabs.selectedID);
      if (!tab || tab.type !== "reader") {
        this._onReaderTabDeactivated();
        return;
      }

      var currentPosition = { left: 0, top: 0 };
      try {
        var reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
        if (reader && reader._internalReader && reader._internalReader._primaryView) {
          var view = reader._internalReader._primaryView;
          if (view._iframeWindow && view._iframeWindow.document) {
            var container = view._iframeWindow.document.getElementById("viewerContainer");
            if (container) {
              currentPosition = { left: container.scrollLeft || 0, top: container.scrollTop || 0 };
            }
          }
        }
      } catch (ex) {
        currentPosition = { left: Math.random(), top: Math.random() };
      }

      var positionChanged = currentPosition.left !== this.lastPosition.left ||
                            currentPosition.top !== this.lastPosition.top;

      if (positionChanged) {
        this.idleCount = 0;
        this.lastPosition = { ...currentPosition };
        this.accumulatedSeconds += this.POLL_INTERVAL_MS / 1000;
      } else {
        this.idleCount++;
        if (this.idleCount < this.IDLE_THRESHOLD) {
          this.accumulatedSeconds += this.POLL_INTERVAL_MS / 1000;
        }
      }

      if (this.accumulatedSeconds >= 60) {
        this._flushAccumulated();
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Tracker] Poll error: " + e);
    }
  }

  _flushAccumulated() {
    if (this.accumulatedSeconds > 0 && this.currentItemKey) {
      this.storage.addReadingTime(
        this.currentItemKey,
        this.currentItemTitle,
        Math.round(this.accumulatedSeconds)
      );
      Zotero.debug("[ReadingHeatmap:Tracker] Flushed " + Math.round(this.accumulatedSeconds) + "s for " + this.currentItemTitle);
      this.accumulatedSeconds = 0;
      if (Zotero.ReadingHeatmap && Zotero.ReadingHeatmap._refreshPanel) {
        Zotero.ReadingHeatmap._refreshPanel();
      }
    }
  }
}


// ============================================================
// SECTION 3: SyncManager
// ============================================================

class SyncManager {
  constructor(storage) {
    this.storage = storage;
    this.syncTimer = null;
    this.baseURL = "";
    this.SYNC_INTERVAL_MS = 5 * 60 * 1000;
    this.DEFAULT_SERVER = "";
    this._cachedGroupData = {};  // Cache downloaded group data
  }

  init() {
    this.baseURL = this._getServerURL();
    if (this.baseURL) {
      this._registerDevice();
      this._startSyncTimer();
    }
  }

  shutdown() {
    this._stopSyncTimer();
    if (this.baseURL) {
      this._uploadStats();
    }
  }

  _getServerURL() {
    try {
      var url = Zotero.Prefs.get("extensions.reading-heatmap.server.url", true) || "";
      // Remove trailing slash
      return url.replace(/\/+$/, "");
    } catch (e) { return ""; }
  }

  /**
   * Refresh server URL from prefs (called when settings change)
   */
  refreshServerURL() {
    this.baseURL = this._getServerURL();
  }

  /**
   * Test server connection. Returns { success, message, latency }
   */
  async testServer(url) {
    var testURL = (url || this.baseURL || "").replace(/\/+$/, "");
    if (!testURL) {
      return { success: false, message: "Server URL is empty." };
    }
    var startTime = Date.now();
    try {
      var r = await Zotero.HTTP.request("GET", testURL + "/api/health", {
        responseType: "json",
        timeout: 10000,
      });
      var latency = Date.now() - startTime;
      if (r.status === 200 && r.response && r.response.success) {
        return {
          success: true,
          message: "Connected! Server v" + (r.response.version || "unknown") + " (latency: " + latency + "ms)",
          latency: latency,
        };
      } else {
        return { success: false, message: "Server responded with status " + r.status };
      }
    } catch (e) {
      return { success: false, message: "Connection failed: " + e.message };
    }
  }

  async _registerDevice() {
    try {
      if (!this.baseURL) return;
      await this._post("/api/register", {
        deviceId: this.storage.getDeviceId(),
        userName: this.storage.getUserName(),
      });
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] Register error: " + e);
    }
  }

  async createGroup(groupName) {
    this.refreshServerURL();
    if (!this.baseURL) {
      Zotero.debug("[ReadingHeatmap:Sync] No server URL configured");
      return null;
    }
    try {
      var result = await this._post("/api/group/create", {
        deviceId: this.storage.getDeviceId(), groupName: groupName
      });
      if (result && result.success) {
        this.storage.addGroup(result.group.id, {
          name: result.group.name,
          inviteCode: result.group.inviteCode,
          joinedAt: new Date().toISOString().split("T")[0],
        });
        return result.group;
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] Create group error: " + e);
    }
    return null;
  }

  async joinGroup(inviteCode) {
    this.refreshServerURL();
    if (!this.baseURL) {
      Zotero.debug("[ReadingHeatmap:Sync] No server URL configured");
      return null;
    }
    try {
      var result = await this._post("/api/group/join", {
        deviceId: this.storage.getDeviceId(), inviteCode: inviteCode.toUpperCase()
      });
      if (result && result.success) {
        this.storage.addGroup(result.group.id, {
          name: result.group.name,
          inviteCode: result.group.inviteCode,
          joinedAt: new Date().toISOString().split("T")[0],
        });
        return result.group;
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] Join group error: " + e);
    }
    return null;
  }

  async _uploadStats() {
    try {
      if (!this.baseURL) return;
      if (Object.keys(this.storage.getGroups()).length === 0) return;
      var stats = this.storage.getDailyStats(30);
      var filtered = {};
      for (var date in stats) {
        if (stats[date].totalSeconds > 0) filtered[date] = stats[date];
      }
      if (Object.keys(filtered).length === 0) return;
      await this._post("/api/sync/upload", { deviceId: this.storage.getDeviceId(), stats: filtered });
      Zotero.debug("[ReadingHeatmap:Sync] Upload completed");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] Upload error: " + e);
    }
  }

  async downloadGroupStats(groupId) {
    try {
      if (!this.baseURL) return null;
      var result = await this._get("/api/sync/download/" + groupId + "?days=180");
      if (result && result.success) {
        this._cachedGroupData[groupId] = result.data;
        Zotero.debug("[ReadingHeatmap:Sync] Downloaded group data for " + groupId);
        return result.data;
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] Download error: " + e);
    }
    return null;
  }

  /**
   * Get cached group data, or download if not available
   */
  async getGroupData(groupId) {
    if (this._cachedGroupData[groupId]) {
      return this._cachedGroupData[groupId];
    }
    return await this.downloadGroupStats(groupId);
  }

  /**
   * Get monthly stats for a specific group, aggregated from all members.
   * Returns { members: { deviceId: { userName, stats } }, aggregated: { dateStr: { totalSeconds } } }
   */
  async getGroupMonthlyData(groupId, year, month) {
    var groupData = await this.getGroupData(groupId);
    if (!groupData) return null;

    var result = { members: {}, aggregated: {} };
    var daysInMonth = new Date(year, month, 0).getDate();

    // Initialize aggregated stats
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      result.aggregated[dateStr] = { totalSeconds: 0 };
    }

    // Process each member
    for (var deviceId in groupData) {
      var memberData = groupData[deviceId];
      var memberStats = {};

      for (var day2 = 1; day2 <= daysInMonth; day2++) {
        var ds = year + "-" + String(month).padStart(2, "0") + "-" + String(day2).padStart(2, "0");
        var dayData = memberData.stats[ds] || { totalSeconds: 0 };
        memberStats[ds] = dayData;
        result.aggregated[ds].totalSeconds += dayData.totalSeconds;
      }

      result.members[deviceId] = {
        userName: memberData.userName || "Anonymous",
        stats: memberStats,
      };
    }

    return result;
  }

  async syncAll() {
    if (!this.baseURL) return;
    await this._uploadStats();
    var groups = this.storage.getGroups();
    for (var groupId in groups) {
      await this.downloadGroupStats(groupId);
    }
  }

  _startSyncTimer() {
    if (this.syncTimer) return;
    this.syncTimer = Zotero.setInterval(() => this.syncAll(), this.SYNC_INTERVAL_MS);
    // Initial sync after 10 seconds
    Zotero.setTimeout(() => this.syncAll(), 10000);
  }

  _stopSyncTimer() {
    if (this.syncTimer) { Zotero.clearInterval(this.syncTimer); this.syncTimer = null; }
  }

  async _get(endpoint) {
    try {
      var r = await Zotero.HTTP.request("GET", this.baseURL + endpoint, { responseType: "json", timeout: 15000 });
      return r.status === 200 ? r.response : null;
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] GET error: " + endpoint + " - " + e);
      return null;
    }
  }

  async _post(endpoint, body) {
    try {
      var r = await Zotero.HTTP.request("POST", this.baseURL + endpoint, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), responseType: "json", timeout: 15000,
      });
      return r.status === 200 ? r.response : null;
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Sync] POST error: " + endpoint + " - " + e);
      return null;
    }
  }
}


// ============================================================
// SECTION 4: HeatmapRenderer (Monthly View with Pagination)
// ============================================================

class HeatmapRenderer {
  constructor() {
    this.COLOR_SCALES = {
      personal: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
      user1: ["#ebedf0", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
      user2: ["#ebedf0", "#fdae6b", "#fd8d3c", "#e6550d", "#a63603"],
      user3: ["#ebedf0", "#c994c7", "#df65b0", "#dd1c77", "#980043"],
    };
    this.CELL_SIZE = 30;
    this.CELL_GAP = 4;
  }

  formatDuration(seconds) {
    if (!seconds || seconds === 0) return "0min";
    if (seconds < 60) return seconds + "s";
    if (seconds < 3600) return Math.round(seconds / 60) + "min";
    var h = Math.floor(seconds / 3600);
    var m = Math.round((seconds % 3600) / 60);
    return m > 0 ? h + "h" + m + "m" : h + "h";
  }

  formatDate(date) {
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  getColorLevel(seconds, maxValue) {
    if (!seconds || seconds === 0) return 0;
    if (!maxValue || maxValue === 0) return 0;
    var ratio = seconds / maxValue;
    if (ratio < 0.15) return 1;
    if (ratio < 0.4) return 2;
    if (ratio < 0.7) return 3;
    return 4;
  }

  /**
   * Build a monthly heatmap using DOM API.
   * @param {Document} doc
   * @param {Object} stats - { dateStr: { totalSeconds, items } }
   * @param {Object} summary - { totalSeconds, activeDays, currentStreak, maxStreak }
   * @param {number} year
   * @param {number} month (1-12)
   * @param {string} colorScheme - key in COLOR_SCALES (default "personal")
   * @param {string} [label] - optional label shown above heatmap (e.g. user name)
   */
  buildMonthlyHeatmapDOM(doc, stats, summary, year, month, colorScheme, label) {
    colorScheme = colorScheme || "personal";
    var colors = this.COLOR_SCALES[colorScheme] || this.COLOR_SCALES.personal;
    var fragment = doc.createDocumentFragment();

    // --- Optional label ---
    if (label) {
      var labelDiv = doc.createElement("div");
      labelDiv.style.cssText = "font-size:12px; font-weight:600; color:#24292f; margin-bottom:4px; padding-left:2px;";
      labelDiv.textContent = label;
      fragment.appendChild(labelDiv);
    }

    // --- Summary bar ---
    var summaryDiv = doc.createElement("div");
    summaryDiv.style.cssText = "display:flex; justify-content:space-around; flex-wrap:wrap; gap:4px; margin-bottom:10px; font-size:11px; color:#57606a; width:100%;";

    var summaryItems = [
      { value: this.formatDuration(summary.totalSeconds), label: "Total" },
      { value: summary.activeDays + "d", label: "Active" },
      { value: summary.currentStreak + "d", label: "Streak" },
      { value: summary.maxStreak + "d", label: "Best" },
    ];

    for (var si = 0; si < summaryItems.length; si++) {
      var item = summaryItems[si];
      var span = doc.createElement("span");
      span.style.cssText = "display:inline-flex; flex-direction:column; align-items:center; padding:3px 8px; background:#f6f8fa; border-radius:6px; flex:1; min-width:50px;";

      var strong = doc.createElement("strong");
      strong.style.cssText = "display:block; font-size:14px; color:#24292f;";
      strong.textContent = item.value;
      span.appendChild(strong);

      var labelSpan = doc.createElement("span");
      labelSpan.style.cssText = "font-size:10px;";
      labelSpan.textContent = item.label;
      span.appendChild(labelSpan);

      summaryDiv.appendChild(span);
    }
    fragment.appendChild(summaryDiv);

    // --- Calendar-style Monthly Heatmap ---
    var daysInMonth = new Date(year, month, 0).getDate();
    var firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    var totalCellSize = this.CELL_SIZE + this.CELL_GAP;

    var values = [];
    for (var key in stats) {
      if (stats[key].totalSeconds > 0) values.push(stats[key].totalSeconds);
    }
    var maxValue = values.length > 0 ? Math.max.apply(null, values) : 1;

    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    var svgNS = "http://www.w3.org/2000/svg";
    var cols = 7;
    var rows = Math.ceil((daysInMonth + firstDayOfWeek) / 7);
    var svgWidth = cols * totalCellSize + 50;
    var svgHeight = rows * totalCellSize + 50;

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
    svg.style.cssText = "display:block; width:100%;";

    // Day-of-week headers
    for (var dh = 0; dh < 7; dh++) {
      var headerText = doc.createElementNS(svgNS, "text");
      headerText.setAttribute("x", String(dh * totalCellSize + 25 + this.CELL_SIZE / 2));
      headerText.setAttribute("y", "16");
      headerText.setAttribute("font-size", "12");
      headerText.setAttribute("fill", "#57606a");
      headerText.setAttribute("text-anchor", "middle");
      headerText.textContent = dayNames[dh];
      svg.appendChild(headerText);
    }

    var today = new Date();
    var todayStr = this.formatDate(today);

    // Draw cells
    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(year, month - 1, day);
      var dayOfWeek = cellDate.getDay();
      var weekRow = Math.floor((day - 1 + firstDayOfWeek) / 7);

      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var dayData = stats[dateStr] || { totalSeconds: 0, items: {} };

      var isFuture = dateStr > todayStr;
      var level = isFuture ? 0 : this.getColorLevel(dayData.totalSeconds, maxValue);
      var color = isFuture ? "#f9f9f9" : colors[level];

      var x = dayOfWeek * totalCellSize + 25;
      var y = weekRow * totalCellSize + 24;

      var rect = doc.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(this.CELL_SIZE));
      rect.setAttribute("height", String(this.CELL_SIZE));
      rect.setAttribute("rx", "3");
      rect.setAttribute("ry", "3");
      rect.setAttribute("fill", color);

      if (dateStr === todayStr) {
        rect.setAttribute("stroke", "#1f6feb");
        rect.setAttribute("stroke-width", "2");
      }

      if (!isFuture) {
        rect.style.cursor = "pointer";
        var tooltipText = dateStr + " | " + this.formatDuration(dayData.totalSeconds);
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = tooltipText;
        rect.appendChild(titleEl);
      }

      svg.appendChild(rect);

      // Day number text
      var dayText = doc.createElementNS(svgNS, "text");
      dayText.setAttribute("x", String(x + this.CELL_SIZE / 2));
      dayText.setAttribute("y", String(y + this.CELL_SIZE / 2 + 5));
      dayText.setAttribute("font-size", "12");
      dayText.setAttribute("fill", (level >= 3 && !isFuture) ? "#ffffff" : "#57606a");
      dayText.setAttribute("text-anchor", "middle");
      dayText.textContent = String(day);
      svg.appendChild(dayText);
    }

    // Legend
    var legendY = svgHeight - 5;
    var legendX = svgWidth - 160;

    var lessText = doc.createElementNS(svgNS, "text");
    lessText.setAttribute("x", String(legendX - 30));
    lessText.setAttribute("y", String(legendY));
    lessText.setAttribute("font-size", "12");
    lessText.setAttribute("fill", "#57606a");
    lessText.textContent = "Less";
    svg.appendChild(lessText);

    for (var li = 0; li < 5; li++) {
      var legendRect = doc.createElementNS(svgNS, "rect");
      legendRect.setAttribute("x", String(legendX + li * 22));
      legendRect.setAttribute("y", String(legendY - 12));
      legendRect.setAttribute("width", "16");
      legendRect.setAttribute("height", "16");
      legendRect.setAttribute("rx", "3");
      legendRect.setAttribute("fill", colors[li]);
      svg.appendChild(legendRect);
    }

    var moreText = doc.createElementNS(svgNS, "text");
    moreText.setAttribute("x", String(legendX + 115));
    moreText.setAttribute("y", String(legendY));
    moreText.setAttribute("font-size", "12");
    moreText.setAttribute("fill", "#57606a");
    moreText.textContent = "More";
    svg.appendChild(moreText);

    // Wrap SVG
    var svgWrapper = doc.createElement("div");
    svgWrapper.style.cssText = "width:100%; margin-bottom:4px;";
    svgWrapper.appendChild(svg);
    fragment.appendChild(svgWrapper);

    return fragment;
  }
}


// ============================================================
// SECTION 5: StyleDataImporter
// ============================================================

class StyleDataImporter {
  constructor(storage) {
    this.storage = storage;
  }

  async importFromStyleJSON(filePath) {
    var importCount = 0;
    var totalImportedSeconds = 0;
    try {
      if (!(await IOUtils.exists(filePath))) {
        return { success: false, message: "File not found: " + filePath, importCount: 0 };
      }

      var content = await IOUtils.readUTF8(filePath);
      var styleData = JSON.parse(content);

      for (var itemKey in styleData) {
        if (!styleData.hasOwnProperty(itemKey)) continue;
        var itemData = styleData[itemKey];
        if (!itemData || !itemData.readingTime || !itemData.readingTime.data) continue;

        var readingTime = itemData.readingTime;
        var totalSeconds = 0;

        for (var pageIndex in readingTime.data) {
          if (!readingTime.data.hasOwnProperty(pageIndex)) continue;
          var pageSec = parseFloat(readingTime.data[pageIndex]) || 0;
          totalSeconds += pageSec;
        }

        if (totalSeconds <= 0) continue;

        var title = "Imported Item";
        try {
          var zoteroItem = Zotero.Items.getByLibraryAndKey(1, itemKey);
          if (zoteroItem) {
            title = zoteroItem.getField("title") || "Untitled";
          }
        } catch (e) {}

        var today = this.storage.getToday();
        this.storage.addReadingTimeToDate(today, itemKey, title, Math.round(totalSeconds));
        importCount++;
        totalImportedSeconds += totalSeconds;
      }

      await this.storage.forceSave();

      return {
        success: true,
        message: "Imported " + importCount + " items, total " +
          Math.round(totalImportedSeconds / 60) + " minutes of reading data.",
        importCount: importCount,
        totalSeconds: totalImportedSeconds,
      };
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Import] Error: " + e);
      return { success: false, message: "Import error: " + e.message, importCount: 0 };
    }
  }

  async importFromAddonItem() {
    var importCount = 0;
    var totalImportedSeconds = 0;
    try {
      var s = new Zotero.Search();
      s.addCondition("title", "contains", "Addon Item");
      var ids = await s.search();

      if (ids.length === 0) {
        s = new Zotero.Search();
        s.addCondition("title", "is", "ZoteroStyle");
        ids = await s.search();
      }

      if (ids.length === 0) {
        return { success: false, message: "No Zotero Style data item found in library.", importCount: 0 };
      }

      var addonItem = Zotero.Items.get(ids[0]);
      var noteIds = addonItem.getNotes();

      for (var i = 0; i < noteIds.length; i++) {
        try {
          var noteItem = Zotero.Items.get(noteIds[i]);
          if (!noteItem) continue;

          var noteContent = noteItem.note.replace(/<.+?>/g, "").trim();
          var firstNewline = noteContent.indexOf("\n");
          if (firstNewline === -1) continue;

          var targetKey = noteContent.substring(0, firstNewline).trim();
          var jsonStr = noteContent.substring(firstNewline + 1).trim();
          var noteData = JSON.parse(jsonStr);

          if (!noteData.readingTime || !noteData.readingTime.data) continue;

          var readingTime = noteData.readingTime;
          var totalSeconds = 0;
          for (var pageIndex in readingTime.data) {
            if (!readingTime.data.hasOwnProperty(pageIndex)) continue;
            totalSeconds += parseFloat(readingTime.data[pageIndex]) || 0;
          }

          if (totalSeconds <= 0) continue;

          var title = "Imported Item";
          try {
            var zoteroItem = Zotero.Items.getByLibraryAndKey(1, targetKey);
            if (zoteroItem) {
              title = zoteroItem.getField("title") || "Untitled";
            }
          } catch (e) {}

          var today = this.storage.getToday();
          this.storage.addReadingTimeToDate(today, targetKey, title, Math.round(totalSeconds));
          importCount++;
          totalImportedSeconds += totalSeconds;
        } catch (e) {
          Zotero.debug("[ReadingHeatmap:Import] Note parse error: " + e);
        }
      }

      await this.storage.forceSave();

      return {
        success: true,
        message: "Imported " + importCount + " items from Addon Item notes, total " +
          Math.round(totalImportedSeconds / 60) + " minutes.",
        importCount: importCount,
        totalSeconds: totalImportedSeconds,
      };
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Import] AddonItem error: " + e);
      return { success: false, message: "Import error: " + e.message, importCount: 0 };
    }
  }
}


// ============================================================
// SECTION 6: Main Plugin Object
// ============================================================

Zotero.ReadingHeatmap = {
  id: null,
  version: null,
  rootURI: null,
  storage: null,
  tracker: null,
  sync: null,
  renderer: null,
  importer: null,
  _sectionKey: null,
  _panelBodies: new Set(),
  _currentYear: null,
  _currentMonth: null,
  _viewMode: "personal",      // "personal" or "group"
  _selectedGroupId: null,      // Currently selected group ID for group view

  async init(id, version, rootURI) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;

    var now = new Date();
    this._currentYear = now.getFullYear();
    this._currentMonth = now.getMonth() + 1;

    // Init storage
    try {
      this.storage = new StorageManager();
      await this.storage.init();
      Zotero.debug("[ReadingHeatmap] Storage initialized");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Storage init error: " + e);
    }

    // Init tracker
    try {
      this.tracker = new ReadingTracker(this.storage);
      this.tracker.init();
      Zotero.debug("[ReadingHeatmap] Tracker initialized");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Tracker init error: " + e);
    }

    // Init sync
    try {
      this.sync = new SyncManager(this.storage);
      this.sync.init();
      Zotero.debug("[ReadingHeatmap] Sync initialized");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Sync init error: " + e);
    }

    // Init renderer
    try {
      this.renderer = new HeatmapRenderer();
      Zotero.debug("[ReadingHeatmap] Renderer initialized");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Renderer init error: " + e);
    }

    // Init importer
    try {
      this.importer = new StyleDataImporter(this.storage);
      Zotero.debug("[ReadingHeatmap] Importer initialized");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Importer init error: " + e);
    }

    // Register the item pane section
    try {
      this._registerSection();
      Zotero.debug("[ReadingHeatmap] Section registration attempted, key: " + this._sectionKey);
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Section register error: " + e);
    }

    // Register preferences pane
    try {
      this._registerPrefsPane();
      Zotero.debug("[ReadingHeatmap] Prefs pane registered");
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Prefs register error: " + e);
    }

    Zotero.debug("[ReadingHeatmap] Fully initialized v" + version);
  },

  _registerSection() {
    var self = this;
    this._sectionKey = Zotero.ItemPaneManager.registerSection({
      paneID: "reading-heatmap-panel",
      pluginID: "reading-heatmap@zotero-plugin.com",
      header: {
        icon: "chrome://reading-heatmap/content/icons/favicon.png",
        l10nID: "reading-heatmap-section-header",
      },
      sidenav: {
        icon: "chrome://reading-heatmap/content/icons/favicon.png",
        l10nID: "reading-heatmap-sidenav",
      },
      onInit: function(props) {
        Zotero.debug("[ReadingHeatmap] Section onInit called");
        self._panelBodies.add(props.body);
        props.body.style.padding = "8px";
        props.body.style.overflowX = "hidden";
        props.body.style.boxSizing = "border-box";
        props.body.style.width = "100%";
      },
      onDestroy: function(props) {
        self._panelBodies.delete(props.body);
      },
      onItemChange: function(props) {
        props.setEnabled(true);
      },
      onRender: function(props) {
        props.body.textContent = "";
        var doc = props.body.ownerDocument;
        var loadingDiv = doc.createElement("div");
        loadingDiv.style.cssText = "padding:10px; color:#57606a; font-size:12px;";
        loadingDiv.textContent = "Loading heatmap...";
        props.body.appendChild(loadingDiv);
      },
      onAsyncRender: async function(props) {
        try {
          Zotero.debug("[ReadingHeatmap] onAsyncRender called");
          var body = props.body;
          var doc = body.ownerDocument;

          while (body.firstChild) {
            body.removeChild(body.firstChild);
          }

          await self._renderMonthView(doc, body);

          Zotero.debug("[ReadingHeatmap] onAsyncRender completed successfully");
        } catch (e) {
          Zotero.debug("[ReadingHeatmap] Render error: " + e);
          var doc2 = props.body.ownerDocument;
          while (props.body.firstChild) {
            props.body.removeChild(props.body.firstChild);
          }
          var errDiv = doc2.createElement("div");
          errDiv.style.cssText = "color:red; padding:10px; font-size:12px;";
          errDiv.textContent = "Error rendering heatmap: " + e.message;
          props.body.appendChild(errDiv);
        }
      },
    });
    Zotero.debug("[ReadingHeatmap] registerSection returned: " + this._sectionKey);
  },

  /**
   * Render the monthly view with navigation and view toggle.
   */
  async _renderMonthView(doc, body) {
    var self = this;
    var year = this._currentYear;
    var month = this._currentMonth;

    var months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

    // --- Navigation header ---
    var navDiv = doc.createElement("div");
    navDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:0; width:100%; box-sizing:border-box;";

    var prevBtn = doc.createElement("button");
    prevBtn.style.cssText = "padding:2px 10px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#24292f; cursor:pointer; font-size:14px; font-weight:bold;";
    prevBtn.textContent = "\u25C0";
    prevBtn.addEventListener("click", function() {
      self._navigateMonth(-1);
    });
    navDiv.appendChild(prevBtn);

    var titleSpan = doc.createElement("span");
    titleSpan.style.cssText = "font-size:14px; font-weight:600; color:#24292f;";
    titleSpan.textContent = months[month - 1] + " " + year;
    navDiv.appendChild(titleSpan);

    var nextBtn = doc.createElement("button");
    nextBtn.style.cssText = "padding:2px 10px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#24292f; cursor:pointer; font-size:14px; font-weight:bold;";
    nextBtn.textContent = "\u25B6";

    var now = new Date();
    if (year === now.getFullYear() && month === now.getMonth() + 1) {
      nextBtn.style.opacity = "0.3";
      nextBtn.style.cursor = "default";
    } else {
      nextBtn.addEventListener("click", function() {
        self._navigateMonth(1);
      });
    }
    navDiv.appendChild(nextBtn);

    body.appendChild(navDiv);

    // --- Render based on view mode ---
    if (this._viewMode === "group" && this._selectedGroupId) {
      await this._renderGroupView(doc, body, year, month);
    } else {
      this._renderPersonalView(doc, body, year, month);
    }

    // --- Bottom: View toggle button ---
    var groups = this.storage.getGroups();
    var hasGroups = Object.keys(groups).length > 0;

    var bottomDiv = doc.createElement("div");
    bottomDiv.style.cssText = "display:flex; justify-content:center; margin-top:8px; width:100%; box-sizing:border-box;";

    if (hasGroups) {
      var toggleBtn = doc.createElement("button");
      if (this._viewMode === "personal") {
        toggleBtn.textContent = "\uD83D\uDC65 Group View";
        toggleBtn.style.cssText = "padding:4px 16px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#24292f; cursor:pointer; font-size:12px;";
        toggleBtn.addEventListener("click", function() {
          self._switchToGroupView();
        });
      } else {
        toggleBtn.textContent = "\uD83D\uDC64 My View";
        toggleBtn.style.cssText = "padding:4px 16px; border:1px solid #1f6feb; border-radius:4px; background:#ddf4ff; color:#1f6feb; cursor:pointer; font-size:12px;";
        toggleBtn.addEventListener("click", function() {
          self._switchToPersonalView();
        });
      }
      bottomDiv.appendChild(toggleBtn);
    } else {
      // No groups: show a hint
      var hintSpan = doc.createElement("span");
      hintSpan.style.cssText = "font-size:11px; color:#8b949e;";
      hintSpan.textContent = "Join a group in Settings to enable Group View";
      bottomDiv.appendChild(hintSpan);
    }

    body.appendChild(bottomDiv);
  },

  _renderPersonalView(doc, body, year, month) {
    var stats = this.storage.getMonthlyStats(year, month);
    var summary = this.storage.getMonthlySummary(year, month);
    var fragment = this.renderer.buildMonthlyHeatmapDOM(doc, stats, summary, year, month, "personal");
    body.appendChild(fragment);
  },

  async _renderGroupView(doc, body, year, month) {
    var groupData = await this.sync.getGroupMonthlyData(this._selectedGroupId, year, month);

    if (!groupData) {
      var noDataDiv = doc.createElement("div");
      noDataDiv.style.cssText = "padding:20px; text-align:center; color:#57606a; font-size:12px;";
      noDataDiv.textContent = "Unable to load group data. Check server connection.";
      body.appendChild(noDataDiv);
      return;
    }

    // Show group name
    var groups = this.storage.getGroups();
    var groupInfo = groups[this._selectedGroupId];
    var groupName = groupInfo ? groupInfo.name : "Group";

    var groupHeader = doc.createElement("div");
    groupHeader.style.cssText = "font-size:12px; color:#1f6feb; font-weight:600; margin-bottom:6px; text-align:center;";
    groupHeader.textContent = "\uD83D\uDC65 " + groupName;
    body.appendChild(groupHeader);

    // Render aggregated heatmap first
    var aggSummary = this.storage.computeSummaryFromStats(groupData.aggregated, year, month);
    var aggFragment = this.renderer.buildMonthlyHeatmapDOM(
      doc, groupData.aggregated, aggSummary, year, month, "personal", "All Members (Combined)"
    );
    body.appendChild(aggFragment);

    // Render individual member heatmaps
    var colorKeys = ["user1", "user2", "user3"];
    var colorIndex = 0;
    var myDeviceId = this.storage.getDeviceId();

    for (var deviceId in groupData.members) {
      var member = groupData.members[deviceId];
      var isMe = (deviceId === myDeviceId);
      var memberLabel = member.userName + (isMe ? " (You)" : "");
      var memberColor = isMe ? "personal" : colorKeys[colorIndex % colorKeys.length];
      if (!isMe) colorIndex++;

      var memberSummary = this.storage.computeSummaryFromStats(member.stats, year, month);
      var memberFragment = this.renderer.buildMonthlyHeatmapDOM(
        doc, member.stats, memberSummary, year, month, memberColor, memberLabel
      );

      // Add a separator
      var sep = doc.createElement("hr");
      sep.style.cssText = "border:none; border-top:1px solid #d0d7de; margin:8px 0;";
      body.appendChild(sep);
      body.appendChild(memberFragment);
    }
  },

  _switchToGroupView() {
    var groups = this.storage.getGroups();
    var groupIds = Object.keys(groups);
    if (groupIds.length === 0) return;

    if (groupIds.length === 1) {
      // Only one group, switch directly
      this._viewMode = "group";
      this._selectedGroupId = groupIds[0];
      this._refreshPanel();
    } else {
      // Multiple groups: show a selection dialog
      var win = Zotero.getMainWindow();
      if (!win) return;
      var groupNames = groupIds.map(function(id) { return groups[id].name; });
      var selected = {};
      var result = Services.prompt.select(
        win,
        "Select Group",
        "Choose a group to view:",
        groupNames,
        selected
      );
      if (result) {
        this._viewMode = "group";
        this._selectedGroupId = groupIds[selected.value];
        this._refreshPanel();
      }
    }
  },

  _switchToPersonalView() {
    this._viewMode = "personal";
    this._selectedGroupId = null;
    this._refreshPanel();
  },

  _navigateMonth(direction) {
    this._currentMonth += direction;
    if (this._currentMonth > 12) {
      this._currentMonth = 1;
      this._currentYear++;
    } else if (this._currentMonth < 1) {
      this._currentMonth = 12;
      this._currentYear--;
    }

    var now = new Date();
    if (this._currentYear > now.getFullYear() ||
        (this._currentYear === now.getFullYear() && this._currentMonth > now.getMonth() + 1)) {
      this._currentMonth = now.getMonth() + 1;
      this._currentYear = now.getFullYear();
    }

    this._refreshPanel();
  },

  _registerPrefsPane() {
    Zotero.PreferencePanes.register({
      pluginID: "reading-heatmap@zotero-plugin.com",
      src: this.rootURI + "chrome/content/preferences/preferences.xhtml",
      scripts: [this.rootURI + "chrome/content/preferences/prefs.js"],
      label: "Reading Heatmap",
      image: "chrome://reading-heatmap/content/icons/favicon.png",
    });
  },

  _refreshPanel() {
    var self = this;
    this._panelBodies.forEach(function(body) {
      try {
        var doc = body.ownerDocument;
        while (body.firstChild) {
          body.removeChild(body.firstChild);
        }
        self._renderMonthView(doc, body);
      } catch (e) {
        Zotero.debug("[ReadingHeatmap] Refresh error: " + e);
      }
    });
  },

  _showImportDialog() {
    var win = Zotero.getMainWindow();
    if (!win) return;
    var self = this;

    var prompts = Services.prompt;
    var selected = {};
    var result = prompts.select(
      win,
      "Import from Zotero Style",
      "Select import source:",
      ["From JSON file (zoterostyle.json)", "From Addon Item (note-based)"],
      selected
    );

    if (result) {
      switch (selected.value) {
        case 0: this._importFromFile(); break;
        case 1: this._importFromAddonItem(); break;
      }
    }
  },

  async _importFromFile() {
    try {
      var win = Zotero.getMainWindow();
      var fp = new win.FilePicker(win, "Select Zotero Style JSON file", 0);
      fp.appendFilter("JSON Files", "*.json");
      fp.appendFilters(1);
      var rv = await new Promise(function(resolve) { fp.open(resolve); });
      if (rv !== 0) return;

      var filePath = fp.file;
      this._showMessage("Importing data from Zotero Style...");
      var result = await this.importer.importFromStyleJSON(filePath);
      this._showMessage(result.message);
      if (result.success) {
        this._refreshPanel();
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Import] FilePicker error: " + e);
      this._importFromCommonPaths();
    }
  },

  async _importFromCommonPaths() {
    var paths = [
      PathUtils.join(Zotero.DataDirectory.dir, "zoterostyle.json"),
      PathUtils.join(Zotero.Profile.dir, "zoterostyle.json"),
    ];

    try {
      var tempDir = Zotero.getTempDirectory();
      paths.push(PathUtils.join(tempDir.path.replace(tempDir.leafName, ""), "zoterostyle.json"));
    } catch (e) {}

    for (var i = 0; i < paths.length; i++) {
      try {
        if (await IOUtils.exists(paths[i])) {
          this._showMessage("Found Style data at: " + paths[i] + "\nImporting...");
          var result = await this.importer.importFromStyleJSON(paths[i]);
          this._showMessage(result.message);
          if (result.success) {
            this._refreshPanel();
          }
          return;
        }
      } catch (e) {}
    }

    this._showMessage("Could not find zoterostyle.json. Please use the file picker or place the file in Zotero's data directory.");
  },

  async _importFromAddonItem() {
    this._showMessage("Importing from Zotero Style Addon Item...");
    var result = await this.importer.importFromAddonItem();
    this._showMessage(result.message);
    if (result.success) {
      this._refreshPanel();
    }
  },

  async _exportCSV() {
    try {
      var stats = this.storage.getDailyStats(365);
      var csv = "Date,TotalSeconds,TotalMinutes,ItemsRead\n";
      var sortedDates = Object.keys(stats).sort();
      for (var i = 0; i < sortedDates.length; i++) {
        var date = sortedDates[i];
        var data = stats[date];
        if (data.totalSeconds === 0) continue;
        var itemsCount = Object.keys(data.items).length;
        csv += date + "," + data.totalSeconds + "," + Math.round(data.totalSeconds / 60) + "," + itemsCount + "\n";
      }

      var path = PathUtils.join(Zotero.DataDirectory.dir, "reading-heatmap-export.csv");
      await IOUtils.writeUTF8(path, "\ufeff" + csv);
      this._showMessage("CSV exported to: " + path);
    } catch (e) {
      this._showMessage("Export failed: " + e.message);
    }
  },

  async _exportJSON() {
    try {
      var data = {
        exportDate: new Date().toISOString(),
        version: this.version,
        dailyStats: this.storage.data.dailyStats,
        groups: this.storage.data.groups,
      };
      var path = PathUtils.join(Zotero.DataDirectory.dir, "reading-heatmap-backup.json");
      await IOUtils.writeUTF8(path, JSON.stringify(data, null, 2));
      this._showMessage("JSON exported to: " + path);
    } catch (e) {
      this._showMessage("Export failed: " + e.message);
    }
  },

  _showMessage(text) {
    try {
      var pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline("Reading Heatmap");
      pw.addDescription(text);
      pw.show();
      pw.startCloseTimer(5000);
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] " + text);
    }
  },

  async onCreateGroup(groupName) {
    if (!groupName) return;
    this._showMessage("Creating group...");
    var group = await this.sync.createGroup(groupName);
    if (group) {
      this._showMessage("Group created! Invite code: " + group.inviteCode);
      this._refreshPanel();
    } else {
      this._showMessage("Failed to create group. Check server URL and connection.");
    }
  },

  async onJoinGroup(inviteCode) {
    if (!inviteCode) return;
    this._showMessage("Joining group...");
    var group = await this.sync.joinGroup(inviteCode);
    if (group) {
      this._showMessage("Joined group: " + group.name);
      this._refreshPanel();
    } else {
      this._showMessage("Failed to join. Check invite code and server connection.");
    }
  },

  async onTestServer() {
    this._showMessage("Testing server connection...");
    var result = await this.sync.testServer();
    this._showMessage(result.message);
    return result;
  },

  onMainWindowLoad(win) {
    // l10n is already loaded by bootstrap.js before init()
  },

  onMainWindowUnload(win) {
    // cleanup if needed
  },

  shutdown() {
    if (this.tracker) this.tracker.shutdown();
    if (this.sync) this.sync.shutdown();
    if (this.storage) this.storage.forceSave();

    try {
      if (this._sectionKey) {
        Zotero.ItemPaneManager.unregisterSection("reading-heatmap-panel");
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Unregister section error: " + e);
    }

    this._panelBodies.clear();
  },
};
