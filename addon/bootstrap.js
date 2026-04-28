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

  // NOTE: FTL resources are now loaded via bodyXHTML linkset in registerSection()
  // instead of global insertFTLIfNeeded, to avoid interfering with other plugins'
  // (e.g. BetterNotes) l10n resources in the main window.

  // Initialize the plugin (this calls registerSection which needs l10n)
  if (Zotero.ReadingHeatmap) {
    await Zotero.ReadingHeatmap.init(id, version, rootURI);
  }

  Zotero.debug("ReadingHeatmap: Started successfully");
}

function onMainWindowLoad({ window: win }) {
  // FTL is loaded via bodyXHTML linkset, no need for insertFTLIfNeeded here
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
