/* eslint-disable no-undef */
/**
 * Reading Heatmap - Preferences Script v0.5.2
 * Loaded via Zotero.PreferencePanes.register({ scripts: [...] })
 * 
 * Fix: Use auto-initialization instead of relying on onload attribute,
 *      because PreferencePanes loads XHTML as a fragment where onload may not fire.
 * Fix: Simplified button binding to avoid e.preventDefault() on command events.
 * Fix: Added robust initialization with retry mechanism.
 */

var ReadingHeatmapPrefs = {
  _initialized: false,

  init: function() {
    if (this._initialized) return;

    var doc = document;
    var prefsRoot = doc.getElementById("reading-heatmap-prefs");
    if (!prefsRoot) {
      Zotero.debug("[ReadingHeatmap:Prefs] Prefs root element not found, deferring init...");
      return;
    }

    this._initialized = true;
    Zotero.debug("[ReadingHeatmap:Prefs] Preferences pane initializing");

    var self = this;

    // Wire up Test Server button
    self._bindButton(doc, "test-server-btn", async function() {
      var resultSpan = doc.getElementById("test-server-result");
      if (resultSpan) {
        resultSpan.textContent = "Testing...";
        resultSpan.style.color = "#666";
      }
      if (Zotero.ReadingHeatmap && Zotero.ReadingHeatmap.sync) {
        // Read the current URL from the input field
        var urlInput = doc.getElementById("pref-server-url");
        var url = urlInput ? urlInput.value : "";
        var result = await Zotero.ReadingHeatmap.sync.testServer(url);
        if (resultSpan) {
          resultSpan.textContent = result.message;
          resultSpan.style.color = result.success ? "#2da44e" : "#cf222e";
        }
      } else {
        if (resultSpan) {
          resultSpan.textContent = "Plugin not initialized. Please restart Zotero.";
          resultSpan.style.color = "#cf222e";
        }
      }
    });

    // Wire up Create Group button
    self._bindButton(doc, "create-group-btn", async function() {
      var nameInput = doc.getElementById("group-name-input");
      var name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        if (Zotero.ReadingHeatmap) {
          Zotero.ReadingHeatmap._showMessage("Please enter a group name.");
        }
        return;
      }
      if (Zotero.ReadingHeatmap) {
        await Zotero.ReadingHeatmap.onCreateGroup(name);
        if (nameInput) nameInput.value = "";
        self._refreshGroupList(doc);
      }
    });

    // Wire up Join Group button
    self._bindButton(doc, "join-group-btn", async function() {
      var codeInput = doc.getElementById("invite-code-input");
      var code = codeInput ? codeInput.value.trim() : "";
      if (!code) {
        if (Zotero.ReadingHeatmap) {
          Zotero.ReadingHeatmap._showMessage("Please enter an invite code.");
        }
        return;
      }
      if (Zotero.ReadingHeatmap) {
        await Zotero.ReadingHeatmap.onJoinGroup(code);
        if (codeInput) codeInput.value = "";
        self._refreshGroupList(doc);
      }
    });

    // Wire up Import buttons
    self._bindButton(doc, "import-style-file-btn", function() {
      if (Zotero.ReadingHeatmap) {
        Zotero.ReadingHeatmap._importFromFile();
      }
    });

    self._bindButton(doc, "import-style-addon-btn", function() {
      if (Zotero.ReadingHeatmap) {
        Zotero.ReadingHeatmap._importFromAddonItem();
      }
    });

    // Wire up Export buttons
    self._bindButton(doc, "export-csv-btn", function() {
      if (Zotero.ReadingHeatmap) {
        Zotero.ReadingHeatmap._exportCSV();
      }
    });

    self._bindButton(doc, "export-json-btn", function() {
      if (Zotero.ReadingHeatmap) {
        Zotero.ReadingHeatmap._exportJSON();
      }
    });

    // Populate group list
    self._refreshGroupList(doc);

    Zotero.debug("[ReadingHeatmap:Prefs] Preferences pane initialized successfully");
  },

  /**
   * Bind a button with both "command" and "click" events for compatibility.
   * Zotero 8's XUL buttons may respond to "command" or "click" depending on context.
   * 
   * Fix: Removed e.preventDefault() which could interfere with XUL event handling.
   * Fix: Simplified double-fire prevention using a timestamp-based approach.
   */
  _bindButton: function(doc, buttonId, handler) {
    var btn = doc.getElementById(buttonId);
    if (!btn) {
      Zotero.debug("[ReadingHeatmap:Prefs] Button not found: " + buttonId);
      return;
    }

    var lastFired = 0;
    var DEBOUNCE_MS = 300;

    var wrappedHandler = function() {
      var now = Date.now();
      if (now - lastFired < DEBOUNCE_MS) return;
      lastFired = now;
      try {
        handler();
      } catch (e) {
        Zotero.debug("[ReadingHeatmap:Prefs] Button handler error (" + buttonId + "): " + e);
      }
    };

    // Use "command" for XUL buttons (primary event in XUL)
    btn.addEventListener("command", wrappedHandler);
    // Use "click" as fallback for contexts where command doesn't fire
    btn.addEventListener("click", wrappedHandler);

    Zotero.debug("[ReadingHeatmap:Prefs] Bound button: " + buttonId);
  },

  _refreshGroupList: function(doc) {
    var container = doc.getElementById("group-list-container");
    if (!container || !Zotero.ReadingHeatmap || !Zotero.ReadingHeatmap.storage) return;

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    var groups = Zotero.ReadingHeatmap.storage.getGroups();
    var groupIds = Object.keys(groups);

    if (groupIds.length === 0) {
      var emptyLabel = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "description");
      emptyLabel.setAttribute("style", "font-size: 11px; color: #999; font-style: italic;");
      emptyLabel.textContent = "No groups joined yet.";
      container.appendChild(emptyLabel);
      return;
    }

    var headerLabel = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "label");
    headerLabel.setAttribute("value", "Your Groups:");
    headerLabel.setAttribute("style", "font-weight: bold; margin-bottom: 4px;");
    container.appendChild(headerLabel);

    var self = this;

    for (var i = 0; i < groupIds.length; i++) {
      var groupId = groupIds[i];
      var groupInfo = groups[groupId];

      var hbox = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "hbox");
      hbox.setAttribute("align", "center");
      hbox.setAttribute("style", "margin: 2px 0; padding: 4px 8px; background: #f6f8fa; border-radius: 4px;");

      var nameLabel = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "label");
      nameLabel.setAttribute("value", groupInfo.name + " (Code: " + groupInfo.inviteCode + ")");
      nameLabel.setAttribute("style", "flex: 1; font-size: 12px;");
      hbox.appendChild(nameLabel);

      var removeBtn = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "button");
      removeBtn.setAttribute("label", "Leave");
      removeBtn.setAttribute("style", "margin-left: 8px;");

      // Closure to capture groupId, using the same debounce pattern
      (function(gid) {
        var lastFired = 0;
        var leaveHandler = function() {
          var now = Date.now();
          if (now - lastFired < 300) return;
          lastFired = now;
          Zotero.ReadingHeatmap.storage.removeGroup(gid);
          Zotero.ReadingHeatmap._showMessage("Left group.");
          self._refreshGroupList(doc);
          Zotero.ReadingHeatmap._refreshPanel();
        };
        removeBtn.addEventListener("command", leaveHandler);
        removeBtn.addEventListener("click", leaveHandler);
      })(groupId);

      hbox.appendChild(removeBtn);
      container.appendChild(hbox);
    }
  }
};

// ============================================================
// AUTO-INITIALIZATION
// ============================================================
// In Zotero's PreferencePanes system, the XHTML is loaded as a fragment,
// so the "onload" attribute on the root element may NOT fire.
// We must self-initialize when the script is loaded.
//
// Strategy: Try to init immediately. If the DOM element isn't ready yet,
// use a polling retry with a short interval.
// ============================================================

(function() {
  function tryInit() {
    try {
      if (document.getElementById("reading-heatmap-prefs")) {
        ReadingHeatmapPrefs.init();
        return true;
      }
    } catch (e) {
      Zotero.debug("[ReadingHeatmap:Prefs] Auto-init attempt error: " + e);
    }
    return false;
  }

  // Attempt 1: Immediate
  if (tryInit()) return;

  // Attempt 2: On DOMContentLoaded
  document.addEventListener("DOMContentLoaded", function() {
    if (!ReadingHeatmapPrefs._initialized) tryInit();
  });

  // Attempt 3: On load event
  if (typeof window !== "undefined") {
    window.addEventListener("load", function() {
      if (!ReadingHeatmapPrefs._initialized) tryInit();
    });
  }

  // Attempt 4: Polling retry (covers edge cases in Zotero's async pane loading)
  var retryCount = 0;
  var maxRetries = 50;  // 50 * 100ms = 5 seconds max
  var retryTimer = setInterval(function() {
    retryCount++;
    if (ReadingHeatmapPrefs._initialized || retryCount >= maxRetries) {
      clearInterval(retryTimer);
      if (!ReadingHeatmapPrefs._initialized && retryCount >= maxRetries) {
        Zotero.debug("[ReadingHeatmap:Prefs] Auto-init failed after " + maxRetries + " retries");
      }
      return;
    }
    tryInit();
  }, 100);
})();
