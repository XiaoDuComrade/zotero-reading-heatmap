/* eslint-disable no-undef */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  Zotero.debug("ReadingHeatmap: Starting v" + version);

  await Zotero.initializationPromise;

  // Register chrome URL so chrome://reading-heatmap/content/... works
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "reading-heatmap", rootURI + "chrome/content/"],
    ["locale", "reading-heatmap", "en-US", rootURI + "locale/en-US/"],
    ["locale", "reading-heatmap", "zh-CN", rootURI + "locale/zh-CN/"],
  ]);

  // Load the main plugin script
  Services.scriptloader.loadSubScript(
    rootURI + "chrome/content/scripts/reading-heatmap.js"
  );

  // Wait for UI to be ready
  await Zotero.uiReadyPromise;

  // Add l10n resources to all existing windows BEFORE registering sections
  var windows = Zotero.getMainWindows();
  for (var i = 0; i < windows.length; i++) {
    if (windows[i].ZoteroPane) {
      _addL10nToWindow(windows[i]);
    }
  }

  // Initialize the plugin (this calls registerSection which needs l10n)
  if (Zotero.ReadingHeatmap) {
    await Zotero.ReadingHeatmap.init(id, version, rootURI);
  }

  Zotero.debug("ReadingHeatmap: Started successfully");
}

function _addL10nToWindow(win) {
  try {
    if (win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
      win.MozXULElement.insertFTLIfNeeded("reading-heatmap.ftl");
    }
  } catch (e) {
    Zotero.debug("ReadingHeatmap: insertFTLIfNeeded error: " + e);
  }
}

function _removeL10nFromWindow(win) {
  // FTL cleanup is handled automatically on shutdown
}

function onMainWindowLoad({ window: win }) {
  _addL10nToWindow(win);
  if (Zotero.ReadingHeatmap) {
    Zotero.ReadingHeatmap.onMainWindowLoad(win);
  }
}

function onMainWindowUnload({ window: win }) {
  if (Zotero.ReadingHeatmap) {
    Zotero.ReadingHeatmap.onMainWindowUnload(win);
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  Zotero.debug("ReadingHeatmap: Shutting down");

  if (Zotero.ReadingHeatmap) {
    Zotero.ReadingHeatmap.shutdown();
    delete Zotero.ReadingHeatmap;
  }

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
