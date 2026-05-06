
/**
 * Reading Heatmap - Main Plugin Script v0.6.14
 * All modules bundled into one file for simplicity.
 * 
 * IMPORTANT: All UI rendering uses DOM API (createElement / createElementNS)
 * instead of innerHTML, because Zotero 8's ItemPane section body strips HTML tags
 * when innerHTML is used.
 * 
 * Changes in v0.6.1:
 * - Added Combined/Overlay toggle in group view to switch between aggregated
 *   single-color heatmap and multi-color stripe overlay mode
 * - Added Members collapse/expand button to hide/show individual member heatmaps
 * 
 * Changes in v0.6.0:
 * - Added week/month calendar view toggle in the side panel
 * - Added summary toggle button to show/hide Total/Active/Streak/Best stats
 * - Fixed group view legend overflow: legends now wrap within sidebar width
 * - Various UI polish and code cleanup
 *
 * Changes in v0.6.4:
 * - Fixed: Zotero.setTimeout/setInterval not available in preferences context,
 *   causing group create/join/leave to fail with "Zotero.setTimeout is not a function"
 * - Fixed: Removed global FTL injection (insertFTLIfNeeded) that could interfere
 *   with other plugins' (e.g. BetterNotes) l10n resources in the main window
 *
 * Changes in v0.6.5:
 * - Changed tracking from PDF scroll-based reading detection to Zotero active-window
 *   timing using focus/blur events.
 *
 * Changes in v0.6.8:
 * - Wrap implementation classes in a local scope to avoid top-level class
 *   redeclaration errors during add-on reloads.
 *
 * Changes in v0.6.9:
 * - Load the preferences pane script via the registered chrome:// content URL
 *   instead of a jar:file rootURI path.
 *
 * Changes in v0.6.10:
 * - Make item pane section registration idempotent by cleaning up stale section
 *   IDs before registering.
 *
 * Changes in v0.6.11:
 * - Render group overlay stripes without SVG clipPath so colors are visible in
 *   Zotero's embedded item pane.
 *
 * Changes in v0.6.12:
 * - Added a compact sidebar mode that collapses controls into a slim divider,
 *   leaving a clean calendar view.
 *
 * Changes in v0.6.13:
 * - Moved the compact controls toggle into Zotero's native section header,
 *   next to the built-in section collapse button.
 *
 * Changes in v0.6.14:
 * - Added a Chartero-style empty-selection side pane that shows a minimal
 *   mini heatmap when no library item is selected.
 */

{

// ============================================================
// Timer compatibility shims
// Zotero.setTimeout/setInterval may not be available in all contexts
// (e.g. preferences pane). Fall back to global setTimeout/setInterval.
// ============================================================
var _rhSetTimeout = (typeof Zotero !== "undefined" && typeof Zotero.setTimeout === "function")
  ? Zotero.setTimeout.bind(Zotero) : setTimeout;
var _rhClearTimeout = (typeof Zotero !== "undefined" && typeof Zotero.clearTimeout === "function")
  ? Zotero.clearTimeout.bind(Zotero) : clearTimeout;
var _rhSetInterval = (typeof Zotero !== "undefined" && typeof Zotero.setInterval === "function")
  ? Zotero.setInterval.bind(Zotero) : setInterval;
var _rhClearInterval = (typeof Zotero !== "undefined" && typeof Zotero.clearInterval === "function")
  ? Zotero.clearInterval.bind(Zotero) : clearInterval;

// ============================================================
// SECTION 1: StorageManager
// ============================================================

class StorageManager {
  constructor() {
    this.data = null;
    this.filePath = null;
    this.dataDir = null;
    this.saveTimer = null;
    this.dirty = false;
    this.FILENAME = "zotero-reading-heatmap.json";
    this.SUBFOLDER = "reading-heatmap";
  }

  async init() {
    // Create dedicated subfolder under Zotero data directory
    this.dataDir = PathUtils.join(Zotero.DataDirectory.dir, this.SUBFOLDER);
    if (!(await IOUtils.exists(this.dataDir))) {
      await IOUtils.makeDirectory(this.dataDir, { ignoreExisting: true });
    }
    this.filePath = PathUtils.join(this.dataDir, this.FILENAME);

    // Auto-migrate: if old file exists in Zotero root, move it to the new subfolder
    var oldPath = PathUtils.join(Zotero.DataDirectory.dir, this.FILENAME);
    if (!(await IOUtils.exists(this.filePath)) && (await IOUtils.exists(oldPath))) {
      try {
        await IOUtils.move(oldPath, this.filePath);
        Zotero.debug("[ReadingHeatmap:Storage] Migrated data from " + oldPath + " to " + this.filePath);
      } catch (e) {
        Zotero.debug("[ReadingHeatmap:Storage] Migration failed, will copy instead: " + e);
        try {
          await IOUtils.copy(oldPath, this.filePath);
        } catch (e2) {
          Zotero.debug("[ReadingHeatmap:Storage] Copy also failed: " + e2);
        }
      }
    }

    await this._load();
    this.syncProfileFromPrefs();
    Zotero.debug("[ReadingHeatmap:Storage] Initialized at " + this.filePath);
  }

  async _load() {
    try {
      if (await IOUtils.exists(this.filePath)) {
        var content = await IOUtils.readUTF8(this.filePath);
        this.data = JSON.parse(content);
        this._ensureShape();
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
      userColor: "#216e39",
      dailyStats: {},
      groups: {},
    };
    this._save();
  }

  _ensureShape() {
    if (!this.data) this.data = {};
    if (!this.data.deviceId) this.data.deviceId = Zotero.Utilities.randomString(32);
    if (!this.data.dailyStats) this.data.dailyStats = {};
    if (!this.data.groups) this.data.groups = {};
    if (!this.data.userColor) this.data.userColor = "#216e39";
  }

  syncProfileFromPrefs() {
    try {
      var prefName = Zotero.Prefs.get("extensions.reading-heatmap.user.name", true) || "";
      var prefColor = Zotero.Prefs.get("extensions.reading-heatmap.user.color", true) || "";
      var changed = false;

      if (prefName && prefName !== this.data.userName) {
        this.data.userName = prefName;
        changed = true;
      } else if (!prefName && this.data.userName) {
        Zotero.Prefs.set("extensions.reading-heatmap.user.name", this.data.userName, true);
      }

      var normalizedColor = this.normalizeColor(prefColor) || this.normalizeColor(this.data.userColor) || "#216e39";
      if (normalizedColor !== this.data.userColor) {
        this.data.userColor = normalizedColor;
        changed = true;
      }
      if (prefColor !== normalizedColor) {
        Zotero.Prefs.set("extensions.reading-heatmap.user.color", normalizedColor, true);
      }

      if (changed) this._scheduleSave();
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Storage] Profile sync error: " + e);
    }
  }

  normalizeColor(color) {
    if (!color) return null;
    var value = String(color).trim();
    var shortHex = /^#?([0-9a-fA-F]{3})$/.exec(value);
    if (shortHex) {
      return "#" + shortHex[1].split("").map(function(ch) { return ch + ch; }).join("").toLowerCase();
    }
    var fullHex = /^#?([0-9a-fA-F]{6})$/.exec(value);
    return fullHex ? "#" + fullHex[1].toLowerCase() : null;
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

  /**
   * Get stats for the week containing the given date.
   * Week starts on Sunday.
   * @param {Date} refDate - reference date
   * @returns {Object} stats keyed by dateStr
   */
  getWeeklyStats(refDate) {
    var result = {};
    var day = refDate.getDay(); // 0=Sun
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - day);
    for (var i = 0; i < 7; i++) {
      var d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      var dateStr = this.formatDate(d);
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
   * Compute summary from arbitrary stats object (for group data or weekly data)
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
    for (var d2 = endDay; d2 >= 1; d2--) {
      var ds2 = year + "-" + String(month).padStart(2, "0") + "-" + String(d2).padStart(2, "0");
      if (stats[ds2] && stats[ds2].totalSeconds > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    return { totalSeconds, activeDays, maxSeconds, currentStreak, maxStreak };
  }

  /**
   * Compute a simple summary from arbitrary stats (no month dependency, for weekly view)
   */
  computeSimpleSummary(stats) {
    var totalSeconds = 0, activeDays = 0, maxSeconds = 0;
    var sortedDates = Object.keys(stats).sort();
    var currentStreak = 0, maxStreak = 0, tempStreak = 0;
    var today = new Date();
    var todayStr = this.formatDate(today);

    for (var i = 0; i < sortedDates.length; i++) {
      var dateStr = sortedDates[i];
      var dayData = stats[dateStr];
      if (dateStr > todayStr) continue;
      if (dayData && dayData.totalSeconds > 0) {
        totalSeconds += dayData.totalSeconds;
        activeDays++;
        if (dayData.totalSeconds > maxSeconds) maxSeconds = dayData.totalSeconds;
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    // current streak from end
    currentStreak = 0;
    for (var j = sortedDates.length - 1; j >= 0; j--) {
      if (sortedDates[j] > todayStr) continue;
      if (stats[sortedDates[j]] && stats[sortedDates[j]].totalSeconds > 0) {
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
    this.saveTimer = _rhSetTimeout(() => {
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
      _rhClearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this._save();
  }

  getDeviceId() { return this.data.deviceId; }
  getUserName() { this.syncProfileFromPrefs(); return this.data.userName || "Anonymous"; }
  setUserName(name) {
    this.data.userName = name || "";
    Zotero.Prefs.set("extensions.reading-heatmap.user.name", this.data.userName, true);
    this._scheduleSave();
  }
  getUserColor() { this.syncProfileFromPrefs(); return this.normalizeColor(this.data.userColor) || "#216e39"; }
  setUserColor(color) {
    var normalized = this.normalizeColor(color) || "#216e39";
    this.data.userColor = normalized;
    Zotero.Prefs.set("extensions.reading-heatmap.user.color", normalized, true);
    this._scheduleSave();
  }
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
    this.isTracking = false;
    this.lastTick = null;
    this.windowListeners = new Map();
    this.ACTIVITY_ITEM_KEY = "__zotero_window_active__";
    this.ACTIVITY_TITLE = "Zotero Active Time";
    this.POLL_INTERVAL_MS = 10000;
    this.MAX_TICK_SECONDS = 60;
  }

  init() {
    this.onMainWindowLoad(Zotero.getMainWindow());
    this._syncFocusState();
    Zotero.debug("[ReadingHeatmap:Tracker] Initialized window activity tracking");
  }

  shutdown() {
    this._stopTracking();
    this.windowListeners.forEach(function(listeners, win) {
      try {
        win.removeEventListener("focus", listeners.focus, true);
        win.removeEventListener("blur", listeners.blur, true);
        if (win.document) {
          win.document.removeEventListener("visibilitychange", listeners.visibility, true);
        }
      } catch (e) {}
    });
    this.windowListeners.clear();
  }

  onMainWindowLoad(win) {
    if (!win || this.windowListeners.has(win)) return;
    var self = this;
    var listeners = {
      focus: function() { self._syncFocusState(); },
      blur: function() { _rhSetTimeout(function() { self._syncFocusState(); }, 100); },
      visibility: function() { self._syncFocusState(); },
    };
    win.addEventListener("focus", listeners.focus, true);
    win.addEventListener("blur", listeners.blur, true);
    if (win.document) {
      win.document.addEventListener("visibilitychange", listeners.visibility, true);
    }
    this.windowListeners.set(win, listeners);
  }

  onMainWindowUnload(win) {
    var listeners = this.windowListeners.get(win);
    if (!listeners) return;
    try {
      win.removeEventListener("focus", listeners.focus, true);
      win.removeEventListener("blur", listeners.blur, true);
      if (win.document) {
        win.document.removeEventListener("visibilitychange", listeners.visibility, true);
      }
    } catch (e) {}
    this.windowListeners.delete(win);
    this._syncFocusState();
  }

  _isAnyTrackedWindowActive() {
    var activeWindow = null;
    try {
      activeWindow = Services.focus.activeWindow;
    } catch (e) {}

    var active = false;
    this.windowListeners.forEach(function(listeners, win) {
      if (active || !win || win.closed) return;
      var doc = win.document;
      var visible = !doc || doc.visibilityState !== "hidden";
      active = visible && (activeWindow === win || (doc && doc.hasFocus && doc.hasFocus()));
    });
    return active;
  }

  _syncFocusState() {
    if (this._isAnyTrackedWindowActive()) {
      this._startTracking();
    } else {
      this._stopTracking();
    }
  }

  _startTracking() {
    if (this.isTracking) return;
    this.isTracking = true;
    this.lastTick = Date.now();
    Zotero.debug("[ReadingHeatmap:Tracker] Zotero window active");
    if (this.pollInterval) return;
    this.pollInterval = _rhSetInterval(() => this._poll(), this.POLL_INTERVAL_MS);
  }

  _stopTracking() {
    if (!this.isTracking && !this.pollInterval) return;
    this._recordElapsed();
    this.isTracking = false;
    this.lastTick = null;
    if (this.pollInterval) {
      _rhClearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    Zotero.debug("[ReadingHeatmap:Tracker] Zotero window inactive");
  }

  _poll() {
    if (!this.isTracking) return;
    if (!this._isAnyTrackedWindowActive()) {
      this._stopTracking();
      return;
    }
    this._recordElapsed();
  }

  _recordElapsed() {
    if (!this.isTracking || !this.lastTick) return;
    var now = Date.now();
    var elapsedSeconds = Math.floor((now - this.lastTick) / 1000);
    if (elapsedSeconds <= 0) return;
    elapsedSeconds = Math.min(elapsedSeconds, this.MAX_TICK_SECONDS);
    this.lastTick = now;

    this.storage.addReadingTime(
      this.ACTIVITY_ITEM_KEY,
      this.ACTIVITY_TITLE,
      elapsedSeconds
    );
    Zotero.debug("[ReadingHeatmap:Tracker] Recorded " + elapsedSeconds + "s of Zotero active time");
    if (Zotero.ReadingHeatmap && Zotero.ReadingHeatmap._refreshPanel) {
      Zotero.ReadingHeatmap._refreshPanel();
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
    this._cachedGroupData = {};
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
      return url.replace(/\/+$/, "");
    } catch (e) { return ""; }
  }

  refreshServerURL() {
    this.baseURL = this._getServerURL();
  }

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
      this.storage.syncProfileFromPrefs();
      await this._post("/api/register", {
        deviceId: this.storage.getDeviceId(),
        userName: this.storage.getUserName(),
        userColor: this.storage.getUserColor(),
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
      await this._registerDevice();
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
      await this._registerDevice();
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
      await this._registerDevice();
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

  async getGroupData(groupId) {
    if (this._cachedGroupData[groupId]) {
      return this._cachedGroupData[groupId];
    }
    return await this.downloadGroupStats(groupId);
  }

  async getGroupMonthlyData(groupId, year, month) {
    var groupData = await this.getGroupData(groupId);
    if (!groupData) return null;

    var result = { members: {}, aggregated: {} };
    var daysInMonth = new Date(year, month, 0).getDate();

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      result.aggregated[dateStr] = { totalSeconds: 0 };
    }

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
        userColor: memberData.userColor || null,
        stats: memberStats,
      };
    }

    return result;
  }

  /**
   * Get group weekly data for a specific week.
   */
  async getGroupWeeklyData(groupId, refDate) {
    var groupData = await this.getGroupData(groupId);
    if (!groupData) return null;

    var result = { members: {}, aggregated: {} };
    var day = refDate.getDay();
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - day);

    for (var i = 0; i < 7; i++) {
      var d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      var dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      result.aggregated[dateStr] = { totalSeconds: 0 };
    }

    for (var deviceId in groupData) {
      var memberData = groupData[deviceId];
      var memberStats = {};

      for (var j = 0; j < 7; j++) {
        var d2 = new Date(startOfWeek);
        d2.setDate(d2.getDate() + j);
        var ds = d2.getFullYear() + "-" + String(d2.getMonth() + 1).padStart(2, "0") + "-" + String(d2.getDate()).padStart(2, "0");
        var dayData2 = memberData.stats[ds] || { totalSeconds: 0 };
        memberStats[ds] = dayData2;
        result.aggregated[ds].totalSeconds += dayData2.totalSeconds;
      }

      result.members[deviceId] = {
        userName: memberData.userName || "Anonymous",
        userColor: memberData.userColor || null,
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
    this.syncTimer = _rhSetInterval(() => this.syncAll(), this.SYNC_INTERVAL_MS);
    _rhSetTimeout(() => this.syncAll(), 10000);
  }

  _stopSyncTimer() {
    if (this.syncTimer) { _rhClearInterval(this.syncTimer); this.syncTimer = null; }
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
// SECTION 4: HeatmapRenderer (Monthly + Weekly View)
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

  normalizeHexColor(color) {
    if (!color) return null;
    var value = String(color).trim();
    var shortHex = /^#?([0-9a-fA-F]{3})$/.exec(value);
    if (shortHex) {
      return "#" + shortHex[1].split("").map(function(ch) { return ch + ch; }).join("").toLowerCase();
    }
    var fullHex = /^#?([0-9a-fA-F]{6})$/.exec(value);
    return fullHex ? "#" + fullHex[1].toLowerCase() : null;
  }

  _hexToRgb(hex) {
    var normalized = this.normalizeHexColor(hex);
    if (!normalized) return null;
    var n = parseInt(normalized.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  _mixWithWhite(hex, amount) {
    var rgb = this._hexToRgb(hex);
    if (!rgb) return hex;
    var r = Math.round(255 + (rgb.r - 255) * amount);
    var g = Math.round(255 + (rgb.g - 255) * amount);
    var b = Math.round(255 + (rgb.b - 255) * amount);
    return "#" + [r, g, b].map(function(value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  getColorScale(colorScheme) {
    if (Array.isArray(colorScheme)) return colorScheme;
    var customColor = this.normalizeHexColor(colorScheme);
    if (customColor) {
      return [
        "#ebedf0",
        this._mixWithWhite(customColor, 0.25),
        this._mixWithWhite(customColor, 0.5),
        this._mixWithWhite(customColor, 0.75),
        customColor,
      ];
    }
    return this.COLOR_SCALES[colorScheme] || this.COLOR_SCALES.personal;
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
   * Build a summary bar as a DOM fragment.
   * Returns the fragment so caller can append or skip it.
   */
  _buildSummaryBar(doc, summary) {
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
    return summaryDiv;
  }

  /**
   * Build an HTML-based legend that wraps within container width.
   * This replaces the old SVG-based legend to fix overflow issues.
   */
  _buildLegendHTML(doc, colorScheme) {
    var colors = this.getColorScale(colorScheme);
    var legendDiv = doc.createElement("div");
    legendDiv.style.cssText = "display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:3px; margin-top:4px; margin-bottom:4px; font-size:11px; color:#57606a;";

    var lessSpan = doc.createElement("span");
    lessSpan.textContent = "Less";
    lessSpan.style.cssText = "margin-right:2px;";
    legendDiv.appendChild(lessSpan);

    for (var i = 0; i < 5; i++) {
      var box = doc.createElement("span");
      box.style.cssText = "display:inline-block; width:14px; height:14px; border-radius:3px; background:" + colors[i] + ";";
      legendDiv.appendChild(box);
    }

    var moreSpan = doc.createElement("span");
    moreSpan.textContent = "More";
    moreSpan.style.cssText = "margin-left:2px;";
    legendDiv.appendChild(moreSpan);

    return legendDiv;
  }

  /**
   * Build a monthly heatmap using DOM API.
   * @param {Document} doc
   * @param {Object} stats
   * @param {Object} summary
   * @param {number} year
   * @param {number} month (1-12)
   * @param {string} colorScheme
   * @param {string} [label]
   * @param {boolean} showSummary - whether to show the summary bar
   */
  buildMonthlyHeatmapDOM(doc, stats, summary, year, month, colorScheme, label, showSummary, hideLegend) {
    colorScheme = colorScheme || "personal";
    var colors = this.getColorScale(colorScheme);
    var fragment = doc.createDocumentFragment();

    // --- Optional label ---
    if (label) {
      var labelDiv = doc.createElement("div");
      labelDiv.style.cssText = "font-size:12px; font-weight:600; color:#24292f; margin-bottom:4px; padding-left:2px;";
      labelDiv.textContent = label;
      fragment.appendChild(labelDiv);
    }

    // --- Summary bar (conditional) ---
    if (showSummary !== false) {
      fragment.appendChild(this._buildSummaryBar(doc, summary));
    }

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
    var svgHeight = rows * totalCellSize + 30;

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

    // Wrap SVG (no legend inside SVG anymore)
    var svgWrapper = doc.createElement("div");
    svgWrapper.style.cssText = "width:100%; margin-bottom:2px;";
    svgWrapper.appendChild(svg);
    fragment.appendChild(svgWrapper);

    // Legend as HTML (wraps properly)
    if (hideLegend !== true) {
      fragment.appendChild(this._buildLegendHTML(doc, colorScheme));
    }

    return fragment;
  }

  /**
   * Build a weekly heatmap (single row of 7 cells).
   * @param {Document} doc
   * @param {Object} stats - 7-day stats keyed by dateStr
   * @param {Object} summary
   * @param {Date} refDate - reference date for the week
   * @param {string} colorScheme
   * @param {string} [label]
   * @param {boolean} showSummary
   */
  buildWeeklyHeatmapDOM(doc, stats, summary, refDate, colorScheme, label, showSummary, hideLegend) {
    colorScheme = colorScheme || "personal";
    var colors = this.getColorScale(colorScheme);
    var fragment = doc.createDocumentFragment();

    // --- Optional label ---
    if (label) {
      var labelDiv = doc.createElement("div");
      labelDiv.style.cssText = "font-size:12px; font-weight:600; color:#24292f; margin-bottom:4px; padding-left:2px;";
      labelDiv.textContent = label;
      fragment.appendChild(labelDiv);
    }

    // --- Summary bar (conditional) ---
    if (showSummary !== false) {
      fragment.appendChild(this._buildSummaryBar(doc, summary));
    }

    // --- Weekly heatmap: single row ---
    var totalCellSize = this.CELL_SIZE + this.CELL_GAP;
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    var values = [];
    for (var key in stats) {
      if (stats[key].totalSeconds > 0) values.push(stats[key].totalSeconds);
    }
    var maxValue = values.length > 0 ? Math.max.apply(null, values) : 1;

    var svgNS = "http://www.w3.org/2000/svg";
    var svgWidth = 7 * totalCellSize + 50;
    var svgHeight = totalCellSize + 30;

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
    svg.style.cssText = "display:block; width:100%;";

    var today = new Date();
    var todayStr = this.formatDate(today);

    // Compute start of week
    var dayOfRef = refDate.getDay();
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfRef);

    // Day headers + cells
    for (var i = 0; i < 7; i++) {
      var cellDate = new Date(startOfWeek);
      cellDate.setDate(cellDate.getDate() + i);
      var dateStr = this.formatDate(cellDate);
      var dayData = stats[dateStr] || { totalSeconds: 0, items: {} };

      var x = i * totalCellSize + 25;

      // Header
      var headerText = doc.createElementNS(svgNS, "text");
      headerText.setAttribute("x", String(x + this.CELL_SIZE / 2));
      headerText.setAttribute("y", "14");
      headerText.setAttribute("font-size", "12");
      headerText.setAttribute("fill", "#57606a");
      headerText.setAttribute("text-anchor", "middle");
      headerText.textContent = dayNames[i];
      svg.appendChild(headerText);

      // Cell
      var isFuture = dateStr > todayStr;
      var level = isFuture ? 0 : this.getColorLevel(dayData.totalSeconds, maxValue);
      var color = isFuture ? "#f9f9f9" : colors[level];

      var rect = doc.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", "22");
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

      // Day number
      var dayText = doc.createElementNS(svgNS, "text");
      dayText.setAttribute("x", String(x + this.CELL_SIZE / 2));
      dayText.setAttribute("y", String(22 + this.CELL_SIZE / 2 + 5));
      dayText.setAttribute("font-size", "12");
      dayText.setAttribute("fill", (level >= 3 && !isFuture) ? "#ffffff" : "#57606a");
      dayText.setAttribute("text-anchor", "middle");
      dayText.textContent = String(cellDate.getDate());
      svg.appendChild(dayText);
    }

    var svgWrapper = doc.createElement("div");
    svgWrapper.style.cssText = "width:100%; margin-bottom:2px;";
    svgWrapper.appendChild(svg);
    fragment.appendChild(svgWrapper);

    // Legend as HTML
    if (hideLegend !== true) {
      fragment.appendChild(this._buildLegendHTML(doc, colorScheme));
    }

    return fragment;
  }

  _wrapMiniSVG(doc, svg, rows) {
    var fragment = doc.createDocumentFragment();
    var wrapper = doc.createElement("div");
    var maxWidth = rows > 1 ? "156px" : "132px";
    wrapper.style.cssText = "width:100%; max-width:" + maxWidth + "; margin:0 auto 8px;";
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
    svg.style.cssText = "display:block; width:100%; height:auto;";
    wrapper.appendChild(svg);
    fragment.appendChild(wrapper);
    return fragment;
  }

  buildMiniMonthlyHeatmapDOM(doc, stats, year, month, colorScheme) {
    colorScheme = colorScheme || "personal";
    var colors = this.getColorScale(colorScheme);
    var svgNS = "http://www.w3.org/2000/svg";
    var cellSize = 8;
    var gap = 2;
    var totalCellSize = cellSize + gap;
    var daysInMonth = new Date(year, month, 0).getDate();
    var firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    var rows = Math.ceil((daysInMonth + firstDayOfWeek) / 7);
    var svgWidth = 7 * totalCellSize - gap;
    var svgHeight = rows * totalCellSize - gap;

    var values = [];
    for (var key in stats) {
      if (stats[key].totalSeconds > 0) values.push(stats[key].totalSeconds);
    }
    var maxValue = values.length > 0 ? Math.max.apply(null, values) : 1;
    var todayStr = this.formatDate(new Date());

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);

    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(year, month - 1, day);
      var dayOfWeek = cellDate.getDay();
      var weekRow = Math.floor((day - 1 + firstDayOfWeek) / 7);
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var dayData = stats[dateStr] || { totalSeconds: 0 };
      var isFuture = dateStr > todayStr;
      var level = isFuture ? 0 : this.getColorLevel(dayData.totalSeconds, maxValue);
      var color = isFuture ? "#f6f8fa" : colors[level];
      var x = dayOfWeek * totalCellSize;
      var y = weekRow * totalCellSize;

      var rect = doc.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(cellSize));
      rect.setAttribute("height", String(cellSize));
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");
      rect.setAttribute("fill", color);
      if (dateStr === todayStr) {
        rect.setAttribute("stroke", "#1f6feb");
        rect.setAttribute("stroke-width", "1.2");
      }
      if (!isFuture) {
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = dateStr + " | " + this.formatDuration(dayData.totalSeconds);
        rect.appendChild(titleEl);
      }
      svg.appendChild(rect);
    }

    return this._wrapMiniSVG(doc, svg, rows);
  }

  buildMiniWeeklyHeatmapDOM(doc, stats, refDate, colorScheme) {
    colorScheme = colorScheme || "personal";
    var colors = this.getColorScale(colorScheme);
    var svgNS = "http://www.w3.org/2000/svg";
    var cellSize = 10;
    var gap = 3;
    var totalCellSize = cellSize + gap;
    var svgWidth = 7 * totalCellSize - gap;
    var svgHeight = cellSize;
    var todayStr = this.formatDate(new Date());

    var values = [];
    for (var key in stats) {
      if (stats[key].totalSeconds > 0) values.push(stats[key].totalSeconds);
    }
    var maxValue = values.length > 0 ? Math.max.apply(null, values) : 1;

    var dayOfRef = refDate.getDay();
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfRef);

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);

    for (var i = 0; i < 7; i++) {
      var cellDate = new Date(startOfWeek);
      cellDate.setDate(cellDate.getDate() + i);
      var dateStr = this.formatDate(cellDate);
      var dayData = stats[dateStr] || { totalSeconds: 0 };
      var isFuture = dateStr > todayStr;
      var level = isFuture ? 0 : this.getColorLevel(dayData.totalSeconds, maxValue);
      var color = isFuture ? "#f6f8fa" : colors[level];

      var rect = doc.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(i * totalCellSize));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(cellSize));
      rect.setAttribute("height", String(cellSize));
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");
      rect.setAttribute("fill", color);
      if (dateStr === todayStr) {
        rect.setAttribute("stroke", "#1f6feb");
        rect.setAttribute("stroke-width", "1.2");
      }
      if (!isFuture) {
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = dateStr + " | " + this.formatDuration(dayData.totalSeconds);
        rect.appendChild(titleEl);
      }
      svg.appendChild(rect);
    }

    return this._wrapMiniSVG(doc, svg, 1);
  }

  /**
   * Resolve a color scheme to a 5-level color array.
   */
  _resolveColors(colorScheme) {
    if (Array.isArray(colorScheme)) return colorScheme;
    if (typeof colorScheme === "string" && /^#[0-9A-Fa-f]{6}$/.test(colorScheme)) {
      return this.getColorScale(colorScheme);
    }
    return this.COLOR_SCALES[colorScheme] || this.COLOR_SCALES.personal;
  }

  _prepareGroupOverlayScales(groupData, memberList) {
    var memberColors = [];
    var memberMaxValues = [];
    for (var mi = 0; mi < memberList.length; mi++) {
      memberColors.push(this._resolveColors(memberList[mi].colorScheme));
      var mMax = 0;
      var memberData = groupData.members[memberList[mi].deviceId];
      var mStats = memberData && memberData.stats ? memberData.stats : {};
      for (var mKey in mStats) {
        if (mStats[mKey].totalSeconds > mMax) mMax = mStats[mKey].totalSeconds;
      }
      memberMaxValues.push(mMax || 1);
    }
    return { colors: memberColors, maxValues: memberMaxValues };
  }

  buildGroupOverlayMiniMonthlyDOM(doc, groupData, memberList, year, month) {
    var self = this;
    var svgNS = "http://www.w3.org/2000/svg";
    var cellSize = 8;
    var gap = 2;
    var totalCellSize = cellSize + gap;
    var daysInMonth = new Date(year, month, 0).getDate();
    var firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    var rows = Math.ceil((daysInMonth + firstDayOfWeek) / 7);
    var svgWidth = 7 * totalCellSize - gap;
    var svgHeight = rows * totalCellSize - gap;
    var todayStr = this.formatDate(new Date());
    var scales = this._prepareGroupOverlayScales(groupData, memberList);
    var memberColors = scales.colors;
    var memberMaxValues = scales.maxValues;

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);

    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(year, month - 1, day);
      var dayOfWeek = cellDate.getDay();
      var weekRow = Math.floor((day - 1 + firstDayOfWeek) / 7);
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var isFuture = dateStr > todayStr;
      var x = dayOfWeek * totalCellSize;
      var y = weekRow * totalCellSize;

      var bgRect = doc.createElementNS(svgNS, "rect");
      bgRect.setAttribute("x", String(x));
      bgRect.setAttribute("y", String(y));
      bgRect.setAttribute("width", String(cellSize));
      bgRect.setAttribute("height", String(cellSize));
      bgRect.setAttribute("rx", "2");
      bgRect.setAttribute("ry", "2");
      bgRect.setAttribute("fill", isFuture ? "#f6f8fa" : "#ebedf0");
      svg.appendChild(bgRect);

      if (!isFuture) {
        var activeMembers = [];
        var tooltipParts = [dateStr];
        for (var mi = 0; mi < memberList.length; mi++) {
          var mInfo = memberList[mi];
          var memberData = groupData.members[mInfo.deviceId];
          var mDayData = memberData && memberData.stats ? memberData.stats[dateStr] : null;
          if (mDayData && mDayData.totalSeconds > 0) {
            var mLevel = self.getColorLevel(mDayData.totalSeconds, memberMaxValues[mi]);
            activeMembers.push({ index: mi, level: mLevel, seconds: mDayData.totalSeconds });
            tooltipParts.push(mInfo.userName + ": " + self.formatDuration(mDayData.totalSeconds));
          }
        }
        this._appendOverlayStripes(doc, svg, x, y, cellSize, cellSize, activeMembers, memberColors);

        var tooltipRect = doc.createElementNS(svgNS, "rect");
        tooltipRect.setAttribute("x", String(x));
        tooltipRect.setAttribute("y", String(y));
        tooltipRect.setAttribute("width", String(cellSize));
        tooltipRect.setAttribute("height", String(cellSize));
        tooltipRect.setAttribute("fill", "transparent");
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = tooltipParts.join("\n");
        tooltipRect.appendChild(titleEl);
        svg.appendChild(tooltipRect);
      }

      if (dateStr === todayStr) {
        var todayRect = doc.createElementNS(svgNS, "rect");
        todayRect.setAttribute("x", String(x));
        todayRect.setAttribute("y", String(y));
        todayRect.setAttribute("width", String(cellSize));
        todayRect.setAttribute("height", String(cellSize));
        todayRect.setAttribute("rx", "2");
        todayRect.setAttribute("ry", "2");
        todayRect.setAttribute("fill", "none");
        todayRect.setAttribute("stroke", "#1f6feb");
        todayRect.setAttribute("stroke-width", "1.2");
        svg.appendChild(todayRect);
      }
    }

    return this._wrapMiniSVG(doc, svg, rows);
  }

  buildGroupOverlayMiniWeeklyDOM(doc, groupData, memberList, refDate) {
    var self = this;
    var svgNS = "http://www.w3.org/2000/svg";
    var cellSize = 10;
    var gap = 3;
    var totalCellSize = cellSize + gap;
    var svgWidth = 7 * totalCellSize - gap;
    var svgHeight = cellSize;
    var todayStr = this.formatDate(new Date());
    var scales = this._prepareGroupOverlayScales(groupData, memberList);
    var memberColors = scales.colors;
    var memberMaxValues = scales.maxValues;

    var dayOfRef = refDate.getDay();
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfRef);

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);

    for (var i = 0; i < 7; i++) {
      var cellDate = new Date(startOfWeek);
      cellDate.setDate(cellDate.getDate() + i);
      var dateStr = this.formatDate(cellDate);
      var isFuture = dateStr > todayStr;
      var x = i * totalCellSize;

      var bgRect = doc.createElementNS(svgNS, "rect");
      bgRect.setAttribute("x", String(x));
      bgRect.setAttribute("y", "0");
      bgRect.setAttribute("width", String(cellSize));
      bgRect.setAttribute("height", String(cellSize));
      bgRect.setAttribute("rx", "2");
      bgRect.setAttribute("ry", "2");
      bgRect.setAttribute("fill", isFuture ? "#f6f8fa" : "#ebedf0");
      svg.appendChild(bgRect);

      if (!isFuture) {
        var activeMembers = [];
        var tooltipParts = [dateStr];
        for (var mi = 0; mi < memberList.length; mi++) {
          var mInfo = memberList[mi];
          var memberData = groupData.members[mInfo.deviceId];
          var mDayData = memberData && memberData.stats ? memberData.stats[dateStr] : null;
          if (mDayData && mDayData.totalSeconds > 0) {
            var mLevel = self.getColorLevel(mDayData.totalSeconds, memberMaxValues[mi]);
            activeMembers.push({ index: mi, level: mLevel, seconds: mDayData.totalSeconds });
            tooltipParts.push(mInfo.userName + ": " + self.formatDuration(mDayData.totalSeconds));
          }
        }
        this._appendOverlayStripes(doc, svg, x, 0, cellSize, cellSize, activeMembers, memberColors);

        var tooltipRect = doc.createElementNS(svgNS, "rect");
        tooltipRect.setAttribute("x", String(x));
        tooltipRect.setAttribute("y", "0");
        tooltipRect.setAttribute("width", String(cellSize));
        tooltipRect.setAttribute("height", String(cellSize));
        tooltipRect.setAttribute("fill", "transparent");
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = tooltipParts.join("\n");
        tooltipRect.appendChild(titleEl);
        svg.appendChild(tooltipRect);
      }

      if (dateStr === todayStr) {
        var todayRect = doc.createElementNS(svgNS, "rect");
        todayRect.setAttribute("x", String(x));
        todayRect.setAttribute("y", "0");
        todayRect.setAttribute("width", String(cellSize));
        todayRect.setAttribute("height", String(cellSize));
        todayRect.setAttribute("rx", "2");
        todayRect.setAttribute("ry", "2");
        todayRect.setAttribute("fill", "none");
        todayRect.setAttribute("stroke", "#1f6feb");
        todayRect.setAttribute("stroke-width", "1.2");
        svg.appendChild(todayRect);
      }
    }

    return this._wrapMiniSVG(doc, svg, 1);
  }

  /**
   * Build a member color legend as HTML flex-wrap (for overlay mode).
   */
  _buildMemberLegendHTML(doc, memberList, memberColors) {
    var legendDiv = doc.createElement("div");
    legendDiv.style.cssText = "display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:6px; margin-bottom:4px; font-size:11px; color:#57606a;";
    for (var i = 0; i < memberList.length; i++) {
      var item = doc.createElement("span");
      item.style.cssText = "display:inline-flex; align-items:center; gap:3px;";
      var box = doc.createElement("span");
      box.style.cssText = "display:inline-block; width:12px; height:12px; border-radius:2px; background:" + memberColors[i][4] + ";";
      item.appendChild(box);
      var nameSpan = doc.createElement("span");
      nameSpan.textContent = memberList[i].userName + (memberList[i].isMe ? " (You)" : "");
      item.appendChild(nameSpan);
      legendDiv.appendChild(item);
    }
    return legendDiv;
  }

  _appendOverlayStripes(doc, svg, x, y, cellW, cellH, activeMembers, memberColors) {
    if (!activeMembers || activeMembers.length === 0) return;

    // Avoid clipPath here. In Zotero's embedded item pane, SVG url(#clip-id)
    // references can fail to resolve from jar/chrome contexts, hiding stripes.
    if (activeMembers.length === 1) {
      var only = activeMembers[0];
      var fullRect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      fullRect.setAttribute("x", String(x));
      fullRect.setAttribute("y", String(y));
      fullRect.setAttribute("width", String(cellW));
      fullRect.setAttribute("height", String(cellH));
      fullRect.setAttribute("rx", "3");
      fullRect.setAttribute("ry", "3");
      fullRect.setAttribute("fill", memberColors[only.index][only.level]);
      svg.appendChild(fullRect);
      return;
    }

    var innerX = x + 1;
    var innerY = y + 1;
    var innerW = cellW - 2;
    var innerH = cellH - 2;
    var stripeH = innerH / activeMembers.length;
    for (var si = 0; si < activeMembers.length; si++) {
      var am = activeMembers[si];
      var stripeRect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      stripeRect.setAttribute("x", String(innerX));
      stripeRect.setAttribute("y", String(innerY + si * stripeH));
      stripeRect.setAttribute("width", String(innerW));
      stripeRect.setAttribute("height", String(stripeH + 0.5));
      stripeRect.setAttribute("fill", memberColors[am.index][am.level]);
      svg.appendChild(stripeRect);
    }
  }

  /**
   * Build a single overlay heatmap for Group View (monthly).
   * Each cell is split horizontally into stripes for members who have data on that day.
   */
  buildGroupOverlayMonthlyDOM(doc, groupData, memberList, year, month, showSummary, hideLegend) {
    var self = this;
    var svgNS = "http://www.w3.org/2000/svg";
    var fragment = doc.createDocumentFragment();

    // --- Summary bar (aggregated) ---
    if (showSummary !== false) {
      var aggSummary = { totalSeconds: 0, activeDays: 0, currentStreak: 0, maxStreak: 0 };
      var daysInMonth = new Date(year, month, 0).getDate();
      var today = new Date();
      var todayStr = this.formatDate(today);
      var tempStreak = 0;
      for (var d = 1; d <= daysInMonth; d++) {
        var ds = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        if (ds > todayStr) break;
        var aggDay = groupData.aggregated[ds];
        if (aggDay && aggDay.totalSeconds > 0) {
          aggSummary.totalSeconds += aggDay.totalSeconds;
          aggSummary.activeDays++;
          tempStreak++;
          if (tempStreak > aggSummary.maxStreak) aggSummary.maxStreak = tempStreak;
        } else {
          tempStreak = 0;
        }
      }
      var endDay = (year === today.getFullYear() && month === today.getMonth() + 1) ? today.getDate() : daysInMonth;
      for (var d2 = endDay; d2 >= 1; d2--) {
        var ds2 = year + "-" + String(month).padStart(2, "0") + "-" + String(d2).padStart(2, "0");
        var aggDay2 = groupData.aggregated[ds2];
        if (aggDay2 && aggDay2.totalSeconds > 0) { aggSummary.currentStreak++; } else { break; }
      }
      fragment.appendChild(this._buildSummaryBar(doc, aggSummary));
    }

    // --- Prepare per-member color arrays and max values ---
    var memberColors = [];
    var memberMaxValues = [];
    var daysInMonth2 = new Date(year, month, 0).getDate();
    for (var mi = 0; mi < memberList.length; mi++) {
      memberColors.push(this._resolveColors(memberList[mi].colorScheme));
      var mMax = 0;
      var mStats = groupData.members[memberList[mi].deviceId].stats;
      for (var mKey in mStats) {
        if (mStats[mKey].totalSeconds > mMax) mMax = mStats[mKey].totalSeconds;
      }
      memberMaxValues.push(mMax || 1);
    }

    // --- Calendar grid ---
    var firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    var totalCellSize = this.CELL_SIZE + this.CELL_GAP;
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var cols = 7;
    var rows = Math.ceil((daysInMonth2 + firstDayOfWeek) / 7);
    var svgWidth = cols * totalCellSize + 50;
    var svgHeight = rows * totalCellSize + 50;
    var today2 = new Date();
    var todayStr2 = this.formatDate(today2);

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

    // Draw cells
    for (var day = 1; day <= daysInMonth2; day++) {
      var cellDate = new Date(year, month - 1, day);
      var dayOfWeek = cellDate.getDay();
      var weekRow = Math.floor((day - 1 + firstDayOfWeek) / 7);
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var isFuture = dateStr > todayStr2;

      var x = dayOfWeek * totalCellSize + 25;
      var y = weekRow * totalCellSize + 24;
      var cellW = this.CELL_SIZE;
      var cellH = this.CELL_SIZE;

      // Background rect
      var bgRect = doc.createElementNS(svgNS, "rect");
      bgRect.setAttribute("x", String(x));
      bgRect.setAttribute("y", String(y));
      bgRect.setAttribute("width", String(cellW));
      bgRect.setAttribute("height", String(cellH));
      bgRect.setAttribute("rx", "3");
      bgRect.setAttribute("ry", "3");
      bgRect.setAttribute("fill", isFuture ? "#f9f9f9" : "#ebedf0");
      svg.appendChild(bgRect);

      if (!isFuture) {
        var activeMembers = [];
        var tooltipParts = [dateStr];
        for (var mi2 = 0; mi2 < memberList.length; mi2++) {
          var mInfo = memberList[mi2];
          var mDayData = groupData.members[mInfo.deviceId].stats[dateStr];
          if (mDayData && mDayData.totalSeconds > 0) {
            var mLevel = self.getColorLevel(mDayData.totalSeconds, memberMaxValues[mi2]);
            activeMembers.push({ index: mi2, level: mLevel, seconds: mDayData.totalSeconds });
            tooltipParts.push(mInfo.userName + ": " + self.formatDuration(mDayData.totalSeconds));
          }
        }

        this._appendOverlayStripes(doc, svg, x, y, cellW, cellH, activeMembers, memberColors);

        // Tooltip
        var tooltipRect = doc.createElementNS(svgNS, "rect");
        tooltipRect.setAttribute("x", String(x));
        tooltipRect.setAttribute("y", String(y));
        tooltipRect.setAttribute("width", String(cellW));
        tooltipRect.setAttribute("height", String(cellH));
        tooltipRect.setAttribute("fill", "transparent");
        tooltipRect.style.cursor = "pointer";
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = tooltipParts.join("\n");
        tooltipRect.appendChild(titleEl);
        svg.appendChild(tooltipRect);
      }

      // Today highlight
      if (dateStr === todayStr2) {
        var todayRect = doc.createElementNS(svgNS, "rect");
        todayRect.setAttribute("x", String(x));
        todayRect.setAttribute("y", String(y));
        todayRect.setAttribute("width", String(cellW));
        todayRect.setAttribute("height", String(cellH));
        todayRect.setAttribute("rx", "3");
        todayRect.setAttribute("ry", "3");
        todayRect.setAttribute("fill", "none");
        todayRect.setAttribute("stroke", "#1f6feb");
        todayRect.setAttribute("stroke-width", "2");
        svg.appendChild(todayRect);
      }

      // Day number text
      var dayText = doc.createElementNS(svgNS, "text");
      dayText.setAttribute("x", String(x + cellW / 2));
      dayText.setAttribute("y", String(y + cellH / 2 + 5));
      dayText.setAttribute("font-size", "12");
      dayText.setAttribute("text-anchor", "middle");
      var hasHighLevel = false;
      if (!isFuture) {
        for (var mi3 = 0; mi3 < memberList.length; mi3++) {
          var mDayData3 = groupData.members[memberList[mi3].deviceId].stats[dateStr];
          if (mDayData3 && mDayData3.totalSeconds > 0) {
            var mLvl = self.getColorLevel(mDayData3.totalSeconds, memberMaxValues[mi3]);
            if (mLvl >= 3) { hasHighLevel = true; break; }
          }
        }
      }
      dayText.setAttribute("fill", hasHighLevel ? "#ffffff" : "#57606a");
      dayText.textContent = String(day);
      svg.appendChild(dayText);
    }

    // Wrap SVG
    var svgWrapper = doc.createElement("div");
    svgWrapper.style.cssText = "width:100%; margin-bottom:4px;";
    svgWrapper.appendChild(svg);
    fragment.appendChild(svgWrapper);

    // Member legend (HTML flex-wrap)
    if (hideLegend !== true) {
      fragment.appendChild(this._buildMemberLegendHTML(doc, memberList, memberColors));
    }

    return fragment;
  }

  /**
   * Build a single overlay heatmap for Group View (weekly).
   * Each cell is split horizontally into stripes for members who have data on that day.
   */
  buildGroupOverlayWeeklyDOM(doc, groupData, memberList, refDate, showSummary, hideLegend) {
    var self = this;
    var svgNS = "http://www.w3.org/2000/svg";
    var fragment = doc.createDocumentFragment();

    // --- Summary bar (aggregated) ---
    if (showSummary !== false) {
      var aggSummary = this._computeWeekAggSummary(groupData.aggregated, refDate);
      fragment.appendChild(this._buildSummaryBar(doc, aggSummary));
    }

    // --- Prepare per-member color arrays and max values ---
    var memberColors = [];
    var memberMaxValues = [];
    for (var mi = 0; mi < memberList.length; mi++) {
      memberColors.push(this._resolveColors(memberList[mi].colorScheme));
      var mMax = 0;
      var mStats = groupData.members[memberList[mi].deviceId].stats;
      for (var mKey in mStats) {
        if (mStats[mKey].totalSeconds > mMax) mMax = mStats[mKey].totalSeconds;
      }
      memberMaxValues.push(mMax || 1);
    }

    // --- Weekly grid ---
    var totalCellSize = this.CELL_SIZE + this.CELL_GAP;
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var svgWidth = 7 * totalCellSize + 50;
    var svgHeight = totalCellSize + 30;
    var today = new Date();
    var todayStr = this.formatDate(today);

    var dayOfRef = refDate.getDay();
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfRef);

    var svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
    svg.style.cssText = "display:block; width:100%;";

    for (var i = 0; i < 7; i++) {
      var cellDate = new Date(startOfWeek);
      cellDate.setDate(cellDate.getDate() + i);
      var dateStr = this.formatDate(cellDate);
      var isFuture = dateStr > todayStr;
      var x = i * totalCellSize + 25;

      // Header
      var headerText = doc.createElementNS(svgNS, "text");
      headerText.setAttribute("x", String(x + this.CELL_SIZE / 2));
      headerText.setAttribute("y", "14");
      headerText.setAttribute("font-size", "12");
      headerText.setAttribute("fill", "#57606a");
      headerText.setAttribute("text-anchor", "middle");
      headerText.textContent = dayNames[i];
      svg.appendChild(headerText);

      var cellW = this.CELL_SIZE;
      var cellH = this.CELL_SIZE;
      var yPos = 22;

      // Background rect
      var bgRect = doc.createElementNS(svgNS, "rect");
      bgRect.setAttribute("x", String(x));
      bgRect.setAttribute("y", String(yPos));
      bgRect.setAttribute("width", String(cellW));
      bgRect.setAttribute("height", String(cellH));
      bgRect.setAttribute("rx", "3");
      bgRect.setAttribute("ry", "3");
      bgRect.setAttribute("fill", isFuture ? "#f9f9f9" : "#ebedf0");
      svg.appendChild(bgRect);

      if (!isFuture) {
        var activeMembers = [];
        var tooltipParts = [dateStr];
        for (var mi2 = 0; mi2 < memberList.length; mi2++) {
          var mInfo = memberList[mi2];
          var mDayData = groupData.members[mInfo.deviceId].stats[dateStr];
          if (mDayData && mDayData.totalSeconds > 0) {
            var mLevel = self.getColorLevel(mDayData.totalSeconds, memberMaxValues[mi2]);
            activeMembers.push({ index: mi2, level: mLevel, seconds: mDayData.totalSeconds });
            tooltipParts.push(mInfo.userName + ": " + self.formatDuration(mDayData.totalSeconds));
          }
        }

        this._appendOverlayStripes(doc, svg, x, yPos, cellW, cellH, activeMembers, memberColors);

        // Tooltip
        var tooltipRect = doc.createElementNS(svgNS, "rect");
        tooltipRect.setAttribute("x", String(x));
        tooltipRect.setAttribute("y", String(yPos));
        tooltipRect.setAttribute("width", String(cellW));
        tooltipRect.setAttribute("height", String(cellH));
        tooltipRect.setAttribute("fill", "transparent");
        tooltipRect.style.cursor = "pointer";
        var titleEl = doc.createElementNS(svgNS, "title");
        titleEl.textContent = tooltipParts.join("\n");
        tooltipRect.appendChild(titleEl);
        svg.appendChild(tooltipRect);
      }

      // Today highlight
      if (dateStr === todayStr) {
        var todayRect = doc.createElementNS(svgNS, "rect");
        todayRect.setAttribute("x", String(x));
        todayRect.setAttribute("y", String(yPos));
        todayRect.setAttribute("width", String(cellW));
        todayRect.setAttribute("height", String(cellH));
        todayRect.setAttribute("rx", "3");
        todayRect.setAttribute("ry", "3");
        todayRect.setAttribute("fill", "none");
        todayRect.setAttribute("stroke", "#1f6feb");
        todayRect.setAttribute("stroke-width", "2");
        svg.appendChild(todayRect);
      }

      // Day number
      var dayText = doc.createElementNS(svgNS, "text");
      dayText.setAttribute("x", String(x + cellW / 2));
      dayText.setAttribute("y", String(yPos + cellH / 2 + 5));
      dayText.setAttribute("font-size", "12");
      dayText.setAttribute("text-anchor", "middle");
      var hasHighLevel = false;
      if (!isFuture) {
        for (var mi3 = 0; mi3 < memberList.length; mi3++) {
          var mDayData3 = groupData.members[memberList[mi3].deviceId].stats[dateStr];
          if (mDayData3 && mDayData3.totalSeconds > 0) {
            var mLvl = self.getColorLevel(mDayData3.totalSeconds, memberMaxValues[mi3]);
            if (mLvl >= 3) { hasHighLevel = true; break; }
          }
        }
      }
      dayText.setAttribute("fill", hasHighLevel ? "#ffffff" : "#57606a");
      dayText.textContent = String(cellDate.getDate());
      svg.appendChild(dayText);
    }

    // Wrap SVG
    var svgWrapper = doc.createElement("div");
    svgWrapper.style.cssText = "width:100%; margin-bottom:2px;";
    svgWrapper.appendChild(svg);
    fragment.appendChild(svgWrapper);

    // Member legend (HTML flex-wrap)
    if (hideLegend !== true) {
      fragment.appendChild(this._buildMemberLegendHTML(doc, memberList, memberColors));
    }

    return fragment;
  }

  /**
   * Helper to compute aggregated summary for a week.
   */
  _computeWeekAggSummary(aggregated, refDate) {
    var summary = { totalSeconds: 0, activeDays: 0, currentStreak: 0, maxStreak: 0 };
    var dayOfRef = refDate.getDay();
    var startOfWeek = new Date(refDate);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfRef);
    var today = new Date();
    var todayStr = this.formatDate(today);
    var tempStreak = 0;
    for (var i = 0; i < 7; i++) {
      var d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      var ds = this.formatDate(d);
      if (ds > todayStr) break;
      var dayData = aggregated[ds];
      if (dayData && dayData.totalSeconds > 0) {
        summary.totalSeconds += dayData.totalSeconds;
        summary.activeDays++;
        tempStreak++;
        if (tempStreak > summary.maxStreak) summary.maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }
    summary.currentStreak = tempStreak;
    return summary;
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

          var readingTime2 = noteData.readingTime;
          var totalSeconds2 = 0;
          for (var pageIndex2 in readingTime2.data) {
            if (!readingTime2.data.hasOwnProperty(pageIndex2)) continue;
            totalSeconds2 += parseFloat(readingTime2.data[pageIndex2]) || 0;
          }

          if (totalSeconds2 <= 0) continue;

          var title2 = "Imported Item";
          try {
            var zoteroItem2 = Zotero.Items.getByLibraryAndKey(1, targetKey);
            if (zoteroItem2) {
              title2 = zoteroItem2.getField("title") || "Untitled";
            }
          } catch (e) {}

          var today2 = this.storage.getToday();
          this.storage.addReadingTimeToDate(today2, targetKey, title2, Math.round(totalSeconds2));
          importCount++;
          totalImportedSeconds += totalSeconds2;
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
  _sectionPaneID: "reading-heatmap-panel",
  _sectionFullPaneID: "reading-heatmap@zotero-plugin.com-reading-heatmap-panel",
  _panelBodies: new Set(),
  _emptySelectionPanelID: "reading-heatmap-empty-selection-panel",
  _emptyPanelListeners: new Map(),
  _emptyPanelRenderSeq: 0,
  _currentYear: null,
  _currentMonth: null,
  _viewMode: "personal",       // "personal" or "group"
  _selectedGroupId: null,
  _calendarMode: "month",      // "month" or "week"  (NEW in v0.6.0)
  _showSummary: true,          // toggle summary bar  (NEW in v0.6.0)
  _controlsCollapsed: false,   // hide toolbars/buttons for a clean calendar view
  _controlsToggleButtonType: "reading-heatmap-controls-toggle",
  _weekRefDate: null,          // reference date for week view navigation
  _groupDisplayMode: "combined",  // "combined" (aggregated) or "overlay" (multi-color stripes) (NEW in v0.6.1)
  _showMembers: true,             // toggle individual member heatmaps in group view (NEW in v0.6.1)

  async init(id, version, rootURI) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;

    var now = new Date();
    this._currentYear = now.getFullYear();
    this._currentMonth = now.getMonth() + 1;
    this._weekRefDate = new Date(now);

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

    try {
      this.onMainWindowLoad(Zotero.getMainWindow());
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Main window bind error: " + e);
    }

    Zotero.debug("[ReadingHeatmap] Fully initialized v" + version);
  },

  _unregisterSectionIfPresent() {
    var ids = [
      this._sectionKey,
      this._sectionPaneID,
      this._sectionFullPaneID,
    ];
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!id || seen[id]) continue;
      seen[id] = true;
      try {
        Zotero.ItemPaneManager.unregisterSection(id);
        Zotero.debug("[ReadingHeatmap] Unregistered section: " + id);
      } catch (e) {
        Zotero.debug("[ReadingHeatmap] Section unregister skipped (" + id + "): " + e);
      }
    }
    this._sectionKey = null;
  },

  _registerSection() {
    var self = this;
    this._unregisterSectionIfPresent();
    this._sectionKey = Zotero.ItemPaneManager.registerSection({
      paneID: this._sectionPaneID,
      pluginID: "reading-heatmap@zotero-plugin.com",
      // Load FTL via bodyXHTML linkset instead of global insertFTLIfNeeded
      // to avoid interfering with other plugins' l10n resources
      bodyXHTML: '<linkset><html:link rel="localization" href="reading-heatmap.ftl"></html:link></linkset>',
      header: {
        icon: "chrome://reading-heatmap/content/icons/icon32.png",
        l10nID: "reading-heatmap-section-header",
      },
      sidenav: {
        icon: "chrome://reading-heatmap/content/icons/icon32.png",
        l10nID: "reading-heatmap-sidenav",
      },
      sectionButtons: [
        {
          type: "reading-heatmap-controls-toggle",
          icon: "chrome://reading-heatmap/content/icons/controls-expanded.svg",
          darkIcon: "chrome://reading-heatmap/content/icons/controls-expanded.svg",
          l10nID: "reading-heatmap-controls-toggle",
          onClick: function(props) {
            self._toggleControlsCollapsed(props && props.doc);
          },
        },
      ],
      onInit: function(props) {
        Zotero.debug("[ReadingHeatmap] Section onInit called");
        self._panelBodies.add(props.body);
        props.body.style.padding = "8px";
        props.body.style.overflowX = "hidden";
        props.body.style.boxSizing = "border-box";
        props.body.style.width = "100%";
        self._syncControlsToggleButtons(props.doc || props.body.ownerDocument);
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

          await self._renderMainView(doc, body);

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

  _getControlsToggleIcon() {
    return "chrome://reading-heatmap/content/icons/" +
      (this._controlsCollapsed ? "controls-collapsed.svg" : "controls-expanded.svg");
  },

  _getControlsToggleTitle() {
    return this._controlsCollapsed ? "Show heatmap controls" : "Hide heatmap controls";
  },

  _syncControlsToggleButtons(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var icon = this._getControlsToggleIcon();
    var title = this._getControlsToggleTitle();
    var selector = "." + this._controlsToggleButtonType + ".section-custom-button";
    var buttons = doc.querySelectorAll(selector);
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      button.style.setProperty("--custom-button-icon-light", "url('" + icon + "')");
      button.style.setProperty("--custom-button-icon-dark", "url('" + icon + "')");
      button.setAttribute("tooltiptext", title);
      button.setAttribute("title", title);
      button.setAttribute("aria-label", title);
    }
  },

  _syncAllControlsToggleButtons() {
    var self = this;
    this._panelBodies.forEach(function(body) {
      try {
        self._syncControlsToggleButtons(body.ownerDocument);
      } catch (e) {}
    });
  },

  _toggleControlsCollapsed(doc) {
    this._controlsCollapsed = !this._controlsCollapsed;
    if (doc) {
      this._syncControlsToggleButtons(doc);
    }
    this._refreshPanel();
  },

  /**
   * Main render entry point for the side panel.
   * Renders navigation, calendar mode toggle, summary toggle, heatmap, and view toggle.
   */
  async _renderMainView(doc, body) {
    var self = this;
    var year = this._currentYear;
    var month = this._currentMonth;

    var months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

    this._syncControlsToggleButtons(doc);

    if (!this._controlsCollapsed) {
      // === Top toolbar: Calendar mode toggle (Week/Month) + Summary toggle ===
      var toolbarDiv = doc.createElement("div");
      toolbarDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; width:100%; box-sizing:border-box;";

      // Left: Week / Month toggle
      var modeDiv = doc.createElement("div");
      modeDiv.style.cssText = "display:flex; gap:2px; border:1px solid #d0d7de; border-radius:6px; overflow:hidden;";

      var weekBtn = doc.createElement("button");
      weekBtn.textContent = "Week";
      weekBtn.style.cssText = "padding:3px 10px; border:none; font-size:11px; cursor:pointer; " +
        (this._calendarMode === "week"
          ? "background:#0969da; color:#fff; font-weight:600;"
          : "background:#f6f8fa; color:#24292f;");
      weekBtn.addEventListener("click", function() {
        if (self._calendarMode !== "week") {
          self._calendarMode = "week";
          // Set week ref date to a date in the current viewed month
          self._weekRefDate = new Date(self._currentYear, self._currentMonth - 1,
            Math.min(new Date().getDate(), new Date(self._currentYear, self._currentMonth, 0).getDate()));
          var nowForWeek = new Date();
          if (self._weekRefDate > nowForWeek) self._weekRefDate = nowForWeek;
          self._refreshPanel();
        }
      });
      modeDiv.appendChild(weekBtn);

      var monthBtn = doc.createElement("button");
      monthBtn.textContent = "Month";
      monthBtn.style.cssText = "padding:3px 10px; border:none; font-size:11px; cursor:pointer; " +
        (this._calendarMode === "month"
          ? "background:#0969da; color:#fff; font-weight:600;"
          : "background:#f6f8fa; color:#24292f;");
      monthBtn.addEventListener("click", function() {
        if (self._calendarMode !== "month") {
          self._calendarMode = "month";
          // Sync month from weekRefDate
          self._currentYear = self._weekRefDate.getFullYear();
          self._currentMonth = self._weekRefDate.getMonth() + 1;
          self._refreshPanel();
        }
      });
      modeDiv.appendChild(monthBtn);

      toolbarDiv.appendChild(modeDiv);

      // Right: Summary toggle button
      var summaryBtn = doc.createElement("button");
      summaryBtn.textContent = this._showSummary ? "Summary \u25B2" : "Summary \u25BC";
      summaryBtn.style.cssText = "padding:3px 10px; border:1px solid #d0d7de; border-radius:6px; font-size:11px; cursor:pointer; " +
        (this._showSummary ? "background:#ddf4ff; color:#0969da;" : "background:#f6f8fa; color:#57606a;");
      summaryBtn.addEventListener("click", function() {
        self._showSummary = !self._showSummary;
        self._refreshPanel();
      });
      toolbarDiv.appendChild(summaryBtn);

      body.appendChild(toolbarDiv);

      // === Navigation header ===
      var navDiv = doc.createElement("div");
      navDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:0; width:100%; box-sizing:border-box;";

      var prevBtn = doc.createElement("button");
      prevBtn.style.cssText = "padding:2px 10px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#24292f; cursor:pointer; font-size:14px; font-weight:bold;";
      prevBtn.textContent = "\u25C0";
      prevBtn.addEventListener("click", function() {
        if (self._calendarMode === "week") {
          self._navigateWeek(-1);
        } else {
          self._navigateMonth(-1);
        }
      });
      navDiv.appendChild(prevBtn);

      // Title: depends on calendar mode
      var titleSpan = doc.createElement("span");
      titleSpan.style.cssText = "font-size:14px; font-weight:600; color:#24292f;";
      if (this._calendarMode === "week") {
        // Show week range
        var refDay = this._weekRefDate.getDay();
        var weekStart = new Date(this._weekRefDate);
        weekStart.setDate(weekStart.getDate() - refDay);
        var weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        var fmt = function(d) {
          return (d.getMonth() + 1) + "/" + d.getDate();
        };
        titleSpan.textContent = fmt(weekStart) + " - " + fmt(weekEnd) + ", " + weekEnd.getFullYear();
      } else {
        titleSpan.textContent = months[month - 1] + " " + year;
      }
      navDiv.appendChild(titleSpan);

      var nextBtn = doc.createElement("button");
      nextBtn.style.cssText = "padding:2px 10px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#24292f; cursor:pointer; font-size:14px; font-weight:bold;";
      nextBtn.textContent = "\u25B6";

      var now = new Date();
      var isAtCurrent = false;
      if (this._calendarMode === "week") {
        // Check if current week contains today
        var refDay2 = this._weekRefDate.getDay();
        var ws = new Date(this._weekRefDate);
        ws.setDate(ws.getDate() - refDay2);
        var we = new Date(ws);
        we.setDate(we.getDate() + 6);
        isAtCurrent = (now >= ws && now <= we);
      } else {
        isAtCurrent = (year === now.getFullYear() && month === now.getMonth() + 1);
      }

      if (isAtCurrent) {
        nextBtn.style.opacity = "0.3";
        nextBtn.style.cursor = "default";
      } else {
        nextBtn.addEventListener("click", function() {
          if (self._calendarMode === "week") {
            self._navigateWeek(1);
          } else {
            self._navigateMonth(1);
          }
        });
      }
      navDiv.appendChild(nextBtn);

      body.appendChild(navDiv);
    }

    // === Render heatmap based on view mode and calendar mode ===
    if (this._viewMode === "group" && this._selectedGroupId) {
      await this._renderGroupView(doc, body, year, month);
    } else {
      this._renderPersonalView(doc, body, year, month);
    }

    if (!this._controlsCollapsed) {
      // === Bottom: View toggle button ===
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
        var hintSpan = doc.createElement("span");
        hintSpan.style.cssText = "font-size:11px; color:#8b949e;";
        hintSpan.textContent = "Join a group in Settings to enable Group View";
        bottomDiv.appendChild(hintSpan);
      }

      body.appendChild(bottomDiv);
    }
  },

  _renderPersonalView(doc, body, year, month) {
    var showSummary = this._showSummary && !this._controlsCollapsed;
    var hideLegend = this._controlsCollapsed;
    if (this._calendarMode === "week") {
      var stats = this.storage.getWeeklyStats(this._weekRefDate);
      var summary = this.storage.computeSimpleSummary(stats);
      var fragment = this.renderer.buildWeeklyHeatmapDOM(doc, stats, summary, this._weekRefDate, this.storage.getUserColor(), null, showSummary, hideLegend);
      body.appendChild(fragment);
    } else {
      var stats2 = this.storage.getMonthlyStats(year, month);
      var summary2 = this.storage.getMonthlySummary(year, month);
      var fragment2 = this.renderer.buildMonthlyHeatmapDOM(doc, stats2, summary2, year, month, this.storage.getUserColor(), null, showSummary, hideLegend);
      body.appendChild(fragment2);
    }
  },

  async _renderGroupView(doc, body, year, month) {
    var self = this;
    var groupData;
    if (this._calendarMode === "week") {
      groupData = await this.sync.getGroupWeeklyData(this._selectedGroupId, this._weekRefDate);
    } else {
      groupData = await this.sync.getGroupMonthlyData(this._selectedGroupId, year, month);
    }

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

    if (!this._controlsCollapsed) {
      var groupHeader = doc.createElement("div");
      groupHeader.style.cssText = "font-size:12px; color:#1f6feb; font-weight:600; margin-bottom:6px; text-align:center;";
      groupHeader.textContent = "\uD83D\uDC65 " + groupName;
      body.appendChild(groupHeader);

      // --- Group view toolbar: Combined/Overlay toggle + Members collapse ---
      var groupToolbar = doc.createElement("div");
      groupToolbar.style.cssText = "display:flex; justify-content:center; align-items:center; gap:6px; margin-bottom:8px; flex-wrap:wrap;";

      // Combined / Overlay toggle
      var combinedBtn = doc.createElement("button");
      combinedBtn.textContent = "Combined";
      var overlayBtn = doc.createElement("button");
      overlayBtn.textContent = "Overlay";

      var activeStyle = "padding:3px 10px; border:1px solid #1f6feb; border-radius:4px; background:#ddf4ff; color:#1f6feb; cursor:pointer; font-size:11px; font-weight:600;";
      var inactiveStyle = "padding:3px 10px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#57606a; cursor:pointer; font-size:11px;";

      combinedBtn.style.cssText = (this._groupDisplayMode === "combined") ? activeStyle : inactiveStyle;
      overlayBtn.style.cssText = (this._groupDisplayMode === "overlay") ? activeStyle : inactiveStyle;

      combinedBtn.addEventListener("click", function() {
        if (self._groupDisplayMode !== "combined") {
          self._groupDisplayMode = "combined";
          self._refreshPanel();
        }
      });
      overlayBtn.addEventListener("click", function() {
        if (self._groupDisplayMode !== "overlay") {
          self._groupDisplayMode = "overlay";
          self._refreshPanel();
        }
      });

      groupToolbar.appendChild(combinedBtn);
      groupToolbar.appendChild(overlayBtn);

      // Separator
      var sepSpan = doc.createElement("span");
      sepSpan.style.cssText = "color:#d0d7de; font-size:14px;";
      sepSpan.textContent = "|";
      groupToolbar.appendChild(sepSpan);

      // Members collapse/expand button
      var membersBtn = doc.createElement("button");
      membersBtn.textContent = this._showMembers ? "Members \u25B2" : "Members \u25BC";
      membersBtn.style.cssText = "padding:3px 10px; border:1px solid #d0d7de; border-radius:4px; background:#f6f8fa; color:#57606a; cursor:pointer; font-size:11px;";
      membersBtn.addEventListener("click", function() {
        self._showMembers = !self._showMembers;
        self._refreshPanel();
      });
      groupToolbar.appendChild(membersBtn);

      body.appendChild(groupToolbar);
    }

    // --- Build member list (shared by all group heatmap modes) ---
    var memberList = this._buildGroupMemberList(groupData);

    // --- Render main heatmap based on display mode ---
    var showSummary = this._showSummary && !this._controlsCollapsed;
    var hideLegend = this._controlsCollapsed;
    if (this._groupDisplayMode === "overlay") {
      // Overlay mode: single heatmap with multi-color stripes
      var overlayFragment;
      if (this._calendarMode === "week") {
        overlayFragment = this.renderer.buildGroupOverlayWeeklyDOM(
          doc, groupData, memberList, this._weekRefDate, showSummary, hideLegend
        );
      } else {
        overlayFragment = this.renderer.buildGroupOverlayMonthlyDOM(
          doc, groupData, memberList, year, month, showSummary, hideLegend
        );
      }
      body.appendChild(overlayFragment);
    } else {
      // Combined mode: aggregated single-color heatmap
      var aggSummary = this.storage.computeSimpleSummary(groupData.aggregated);
      var aggFragment;
      if (this._calendarMode === "week") {
        aggFragment = this.renderer.buildWeeklyHeatmapDOM(
          doc, groupData.aggregated, aggSummary, this._weekRefDate, "personal", this._controlsCollapsed ? null : "All Members (Combined)", showSummary, hideLegend
        );
      } else {
        aggFragment = this.renderer.buildMonthlyHeatmapDOM(
          doc, groupData.aggregated, aggSummary, year, month, "personal", this._controlsCollapsed ? null : "All Members (Combined)", showSummary, hideLegend
        );
      }
      body.appendChild(aggFragment);
    }

    // --- Render individual member heatmaps (if expanded) ---
    if (this._showMembers && !this._controlsCollapsed) {
      for (var mi = 0; mi < memberList.length; mi++) {
        var mInfo = memberList[mi];
        var mData = groupData.members[mInfo.deviceId];
        var memberLabel = mInfo.userName + (mInfo.isMe ? " (You)" : "");
        var memberColor = mInfo.colorScheme;

        var memberSummary = this.storage.computeSimpleSummary(mData.stats);
        var memberFragment;
        if (this._calendarMode === "week") {
          memberFragment = this.renderer.buildWeeklyHeatmapDOM(
            doc, mData.stats, memberSummary, this._weekRefDate, memberColor, memberLabel, this._showSummary
          );
        } else {
          memberFragment = this.renderer.buildMonthlyHeatmapDOM(
            doc, mData.stats, memberSummary, year, month, memberColor, memberLabel, this._showSummary
          );
        }

        var sep = doc.createElement("hr");
        sep.style.cssText = "border:none; border-top:1px solid #d0d7de; margin:8px 0;";
        body.appendChild(sep);
        body.appendChild(memberFragment);
      }
    }
  },

  _buildGroupMemberList(groupData) {
    var colorKeys = ["user1", "user2", "user3"];
    var colorIndex = 0;
    var myDeviceId = this.storage.getDeviceId();
    var myColor = this.storage.getUserColor();
    var memberList = [];

    for (var deviceId in groupData.members) {
      var member = groupData.members[deviceId];
      var isMe = (deviceId === myDeviceId);
      var memberColor;
      if (isMe) {
        memberColor = myColor;
      } else if (member.userColor && /^#[0-9A-Fa-f]{6}$/.test(member.userColor)) {
        memberColor = member.userColor;
      } else {
        memberColor = colorKeys[colorIndex % colorKeys.length];
      }
      memberList.push({
        deviceId: deviceId,
        userName: member.userName,
        colorScheme: memberColor,
        isMe: isMe,
      });
      if (!isMe) colorIndex++;
    }

    return memberList;
  },

  _switchToGroupView() {
    var groups = this.storage.getGroups();
    var groupIds = Object.keys(groups);
    if (groupIds.length === 0) return;

    if (groupIds.length === 1) {
      this._viewMode = "group";
      this._selectedGroupId = groupIds[0];
      this._refreshPanel();
    } else {
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

  _navigateWeek(direction) {
    var newRef = new Date(this._weekRefDate);
    newRef.setDate(newRef.getDate() + direction * 7);

    var now = new Date();
    // Don't navigate past current week
    var nowDay = now.getDay();
    var endOfCurrentWeek = new Date(now);
    endOfCurrentWeek.setDate(endOfCurrentWeek.getDate() + (6 - nowDay));

    if (newRef > endOfCurrentWeek) {
      newRef = new Date(now);
    }

    this._weekRefDate = newRef;
    // Keep month/year in sync
    this._currentYear = newRef.getFullYear();
    this._currentMonth = newRef.getMonth() + 1;

    this._refreshPanel();
  },

  _getZoteroPaneForWindow(win) {
    if (!win) return null;
    if (win.ZoteroPane_Local) return win.ZoteroPane_Local;
    if (win.ZoteroPane) return win.ZoteroPane;
    try {
      if (Zotero.getActiveZoteroPane) return Zotero.getActiveZoteroPane();
    } catch (e) {}
    return null;
  },

  _isLibraryTabActive(win) {
    try {
      if (win && win.Zotero_Tabs && win.Zotero_Tabs.selectedType &&
          win.Zotero_Tabs.selectedType !== "library") {
        return false;
      }
    } catch (e) {}
    return true;
  },

  _getSelectedItemCount(win) {
    var pane = this._getZoteroPaneForWindow(win);
    if (!pane) return null;

    try {
      if (pane.getSelectedItems) {
        var items = pane.getSelectedItems(true) || [];
        return items.length || 0;
      }
    } catch (e) {}

    try {
      if (pane.itemsView && pane.itemsView.selection &&
          typeof pane.itemsView.selection.count === "number") {
        return pane.itemsView.selection.count;
      }
    } catch (e2) {}

    return null;
  },

  _shouldShowEmptySelectionPanel(win) {
    if (!this._isLibraryTabActive(win)) return false;
    var count = this._getSelectedItemCount(win);
    return count === 0;
  },

  _bindEmptySelectionPanel(win) {
    if (!win || this._emptyPanelListeners.has(win)) return;

    var self = this;
    var state = {
      itemsView: null,
      collectionsView: null,
      retryTimer: null,
      updateTimer: null,
      attempts: 0,
    };

    state.handler = function() {
      self._queueEmptySelectionPanelUpdate(win);
    };

    state.attach = function() {
      var pane = self._getZoteroPaneForWindow(win);
      if (!pane) return false;
      var attached = false;

      try {
        if (!state.itemsView && pane.itemsView && pane.itemsView.onSelect &&
            pane.itemsView.onSelect.addListener) {
          pane.itemsView.onSelect.addListener(state.handler);
          state.itemsView = pane.itemsView;
          attached = true;
        }
      } catch (e) {
        Zotero.debug("[ReadingHeatmap] Empty panel itemsView listener error: " + e);
      }

      try {
        if (!state.collectionsView && pane.collectionsView && pane.collectionsView.onSelect &&
            pane.collectionsView.onSelect.addListener) {
          pane.collectionsView.onSelect.addListener(state.handler);
          state.collectionsView = pane.collectionsView;
          attached = true;
        }
      } catch (e2) {
        Zotero.debug("[ReadingHeatmap] Empty panel collectionsView listener error: " + e2);
      }

      return attached || !!state.itemsView || !!state.collectionsView;
    };

    this._emptyPanelListeners.set(win, state);

    if (!state.attach()) {
      state.retryTimer = _rhSetInterval(function() {
        state.attempts++;
        if (state.attach() || state.attempts > 20) {
          _rhClearInterval(state.retryTimer);
          state.retryTimer = null;
        }
        self._queueEmptySelectionPanelUpdate(win);
      }, 500);
    }

    this._queueEmptySelectionPanelUpdate(win);
  },

  _unbindEmptySelectionPanel(win) {
    var state = this._emptyPanelListeners.get(win);
    if (!state) return;

    try {
      if (state.itemsView && state.itemsView.onSelect && state.itemsView.onSelect.removeListener) {
        state.itemsView.onSelect.removeListener(state.handler);
      }
    } catch (e) {}

    try {
      if (state.collectionsView && state.collectionsView.onSelect && state.collectionsView.onSelect.removeListener) {
        state.collectionsView.onSelect.removeListener(state.handler);
      }
    } catch (e2) {}

    if (state.retryTimer) _rhClearInterval(state.retryTimer);
    if (state.updateTimer) _rhClearTimeout(state.updateTimer);
    this._hideEmptySelectionPanel(win);
    this._emptyPanelListeners.delete(win);
  },

  _queueEmptySelectionPanelUpdate(win) {
    var state = this._emptyPanelListeners.get(win);
    if (!state) return;
    var self = this;
    if (state.updateTimer) _rhClearTimeout(state.updateTimer);
    state.updateTimer = _rhSetTimeout(function() {
      state.updateTimer = null;
      self._updateEmptySelectionPanel(win);
    }, 0);
  },

  _refreshEmptySelectionPanels() {
    var self = this;
    this._emptyPanelListeners.forEach(function(state, win) {
      self._queueEmptySelectionPanelUpdate(win);
    });
  },

  async _updateEmptySelectionPanel(win) {
    try {
      if (!this._shouldShowEmptySelectionPanel(win)) {
        this._hideEmptySelectionPanel(win);
        return;
      }
      await this._showEmptySelectionPanel(win);
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Empty selection panel update error: " + e);
    }
  },

  _hideEmptySelectionPanel(win) {
    this._emptyPanelRenderSeq++;
    try {
      var doc = win && win.document;
      if (!doc) return;
      var panel = doc.getElementById(this._emptySelectionPanelID);
      if (panel && panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap] Empty selection panel hide error: " + e);
    }
  },

  async _showEmptySelectionPanel(win) {
    var doc = win && win.document;
    if (!doc) return;
    var content = doc.getElementById("zotero-item-pane-content");
    if (!content) return;

    var seq = ++this._emptyPanelRenderSeq;
    var panel = doc.getElementById(this._emptySelectionPanelID);
    if (!panel) {
      panel = doc.createXULElement ? doc.createXULElement("vbox") : doc.createElement("div");
      panel.setAttribute("id", this._emptySelectionPanelID);
      panel.setAttribute("flex", "1");
      panel.style.cssText = "width:100%; height:100%; overflow:auto; box-sizing:border-box; padding:8px;";
      content.appendChild(panel);
    }

    content.selectedPanel = panel;
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }

    var body = doc.createElement("div");
    body.style.cssText = "width:100%; box-sizing:border-box;";
    panel.appendChild(body);

    await this._renderEmptySelectionView(doc, body);

    if (seq !== this._emptyPanelRenderSeq || !this._shouldShowEmptySelectionPanel(win)) {
      this._hideEmptySelectionPanel(win);
      return;
    }
    content.selectedPanel = panel;
  },

  async _renderEmptySelectionView(doc, body) {
    body.style.cssText = "width:100%; min-height:100%; box-sizing:border-box;";

    var mini = doc.createElement("div");
    mini.setAttribute("id", "reading-heatmap-empty-mini");
    mini.style.cssText = "width:100%; box-sizing:border-box; padding:6px 2px 8px; border-bottom:1px solid #d0d7de; margin-bottom:8px;";
    body.appendChild(mini);

    await this._renderCurrentMiniHeatmap(doc, mini);

    var extra = doc.createElement("div");
    extra.setAttribute("id", "reading-heatmap-empty-extra-content");
    extra.style.cssText = "width:100%; min-height:80px; box-sizing:border-box;";
    body.appendChild(extra);
  },

  async _renderCurrentMiniHeatmap(doc, body) {
    if (!this.storage || !this.renderer) return;
    var year = this._currentYear;
    var month = this._currentMonth;

    if (this._viewMode === "group" && this._selectedGroupId && this.sync) {
      var groupData = null;
      if (this._calendarMode === "week") {
        groupData = await this.sync.getGroupWeeklyData(this._selectedGroupId, this._weekRefDate);
      } else {
        groupData = await this.sync.getGroupMonthlyData(this._selectedGroupId, year, month);
      }
      if (!groupData) return;

      var memberList = this._buildGroupMemberList(groupData);
      if (this._groupDisplayMode === "overlay") {
        if (this._calendarMode === "week") {
          body.appendChild(this.renderer.buildGroupOverlayMiniWeeklyDOM(doc, groupData, memberList, this._weekRefDate));
        } else {
          body.appendChild(this.renderer.buildGroupOverlayMiniMonthlyDOM(doc, groupData, memberList, year, month));
        }
      } else if (this._calendarMode === "week") {
        body.appendChild(this.renderer.buildMiniWeeklyHeatmapDOM(doc, groupData.aggregated, this._weekRefDate, "personal"));
      } else {
        body.appendChild(this.renderer.buildMiniMonthlyHeatmapDOM(doc, groupData.aggregated, year, month, "personal"));
      }
      return;
    }

    if (this._calendarMode === "week") {
      var weekStats = this.storage.getWeeklyStats(this._weekRefDate);
      body.appendChild(this.renderer.buildMiniWeeklyHeatmapDOM(doc, weekStats, this._weekRefDate, this.storage.getUserColor()));
    } else {
      var monthStats = this.storage.getMonthlyStats(year, month);
      body.appendChild(this.renderer.buildMiniMonthlyHeatmapDOM(doc, monthStats, year, month, this.storage.getUserColor()));
    }
  },

  _registerPrefsPane() {
    Zotero.PreferencePanes.register({
      pluginID: "reading-heatmap@zotero-plugin.com",
      src: this.rootURI + "chrome/content/preferences/preferences.xhtml",
      scripts: ["chrome://reading-heatmap/content/preferences/prefs.js"],
      label: "Reading Heatmap",
      image: "chrome://reading-heatmap/content/icons/icon32.png",
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
        self._renderMainView(doc, body);
      } catch (e) {
        Zotero.debug("[ReadingHeatmap] Refresh error: " + e);
      }
    });
    this._refreshEmptySelectionPanels();
  },

  _showImportDialog() {
    var win = Zotero.getMainWindow();
    if (!win) return;

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

      var path = PathUtils.join(this.storage.dataDir, "reading-heatmap-export.csv");
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
      var path = PathUtils.join(this.storage.dataDir, "reading-heatmap-backup.json");
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
    if (this.tracker) this.tracker.onMainWindowLoad(win);
    this._bindEmptySelectionPanel(win);
  },

  onMainWindowUnload(win) {
    if (this.tracker) this.tracker.onMainWindowUnload(win);
    this._unbindEmptySelectionPanel(win);
  },

  shutdown() {
    if (this.tracker) this.tracker.shutdown();
    if (this.sync) this.sync.shutdown();
    if (this.storage) this.storage.forceSave();

    var wins = Array.from(this._emptyPanelListeners.keys());
    for (var i = 0; i < wins.length; i++) {
      this._unbindEmptySelectionPanel(wins[i]);
    }

    this._unregisterSectionIfPresent();

    this._panelBodies.clear();
  },
};
}
