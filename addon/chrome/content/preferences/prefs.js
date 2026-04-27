/* eslint-disable no-undef */
/**
 * Reading Heatmap - Preferences Script v0.5.1
 * Loaded via Zotero.PreferencePanes.register({ scripts: [...] })
 * 
 * Fixed: Use both "command" and "click" events for button compatibility
 */

var ReadingHeatmapPrefs = {
  init: function() {
    Zotero.debug("[ReadingHeatmap:Prefs] Preferences pane loaded");

    var doc = document;
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
      }
    });

    // Wire up Create Group button
    self._bindButton(doc, "create-group-btn", async function() {
      var nameInput = doc.getElementById("group-name-input");
      var name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        Zotero.ReadingHeatmap._showMessage("Please enter a group name.");
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
        Zotero.ReadingHeatmap._showMessage("Please enter an invite code.");
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
  },

  /**
   * Bind a button with both "command" and "click" events for compatibility.
   * Zotero 8's XUL buttons may respond to "command" or "click" depending on context.
   */
  _bindButton: function(doc, buttonId, handler) {
    var btn = doc.getElementById(buttonId);
    if (!btn) {
      Zotero.debug("[ReadingHeatmap:Prefs] Button not found: " + buttonId);
      return;
    }
    // Use "command" for XUL buttons (primary), "click" as fallback
    btn.addEventListener("command", function(e) {
      e.preventDefault();
      handler();
    });
    btn.addEventListener("click", function(e) {
      // Only fire on click if command didn't fire (avoid double-fire)
      // We use a flag to prevent double execution
      if (btn._commandFired) {
        btn._commandFired = false;
        return;
      }
      handler();
    });
    // Track command event to prevent double-fire
    btn.addEventListener("command", function() {
      btn._commandFired = true;
      setTimeout(function() { btn._commandFired = false; }, 100);
    }, true);
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

      // Closure to capture groupId
      (function(gid) {
        var self2 = ReadingHeatmapPrefs;
        removeBtn.addEventListener("command", function() {
          Zotero.ReadingHeatmap.storage.removeGroup(gid);
          Zotero.ReadingHeatmap._showMessage("Left group.");
          self2._refreshGroupList(doc);
          Zotero.ReadingHeatmap._refreshPanel();
        });
        removeBtn.addEventListener("click", function() {
          if (removeBtn._commandFired) {
            removeBtn._commandFired = false;
            return;
          }
          Zotero.ReadingHeatmap.storage.removeGroup(gid);
          Zotero.ReadingHeatmap._showMessage("Left group.");
          self2._refreshGroupList(doc);
          Zotero.ReadingHeatmap._refreshPanel();
        });
        removeBtn.addEventListener("command", function() {
          removeBtn._commandFired = true;
          setTimeout(function() { removeBtn._commandFired = false; }, 100);
        }, true);
      })(groupId);

      hbox.appendChild(removeBtn);
      container.appendChild(hbox);
    }
  }
};
