# Zotero Reading Heatmap

A Zotero plugin that automatically tracks your reading activity and visualizes it as a GitHub-style heatmap, embedded directly in Zotero's side panel.

## Features

**Automatic Zotero Activity Tracking** records time while the Zotero main window is active/focused. This avoids relying on PDF scroll events, so time is counted even when you are reading without scrolling. Data is saved locally every few seconds.

**Monthly Calendar Heatmap** displays a full month of reading activity in a calendar grid with 5-level color grading (light gray to dark green). Navigate between months with pagination controls. Today's cell is highlighted with a blue border.

**Weekly View** (new in v0.6.0) shows a compact single-row view of the current week's reading activity. Toggle between Week and Month views using the toolbar buttons at the top of the panel.

**Summary Statistics Toggle** (new in v0.6.0) allows you to show or hide the summary bar displaying Total reading time, Active days, current Streak, and Best streak. Click the "Summary" button to toggle visibility.

**Group Reading Sync** enables collaborative reading tracking. Deploy a backend server, create or join groups with 6-digit invite codes, and view aggregated and individual heatmaps for all group members. Data syncs automatically every 5 minutes.

**Responsive Legend** (improved in v0.6.0) ensures the color legend wraps properly within the sidebar width, fixing overflow issues in group view with multiple member heatmaps.

**Data Import and Export** supports importing historical reading data from the Zotero Style plugin (JSON file or Addon Item notes), exporting 365-day statistics as CSV, and full JSON backup.

## Screenshots

| Monthly View | Weekly View | Group View |
|:---:|:---:|:---:|
| Calendar grid with summary stats | Compact single-row layout | Multi-member heatmaps |

## Installation

1. Download the latest `.xpi` file from the [xpi](./xpi/) directory or [Releases](https://github.com/XiaoDuComrade/zotero-reading-heatmap/releases).
2. In Zotero, go to **Tools > Add-ons**.
3. Click the gear icon and select **Install Add-on From File...**.
4. Select the downloaded `.xpi` file.
5. Restart Zotero.

## Compatibility

| Zotero Version | Supported |
|---|---|
| Zotero 7.x | Yes |
| Zotero 8.x | Yes (recommended) |
| Zotero 6.x and below | No |

## Usage

After installation, the Reading Heatmap panel appears in Zotero's right side panel. Select any item in your library to see the heatmap.

When no item is selected, the right side panel still keeps a minimal Reading Heatmap area visible. It shows a small dense version of the current personal or group calendar view without labels or legends, while preserving Zotero's default empty-selection content or other plugin content below it.

**View Controls** are located at the top of the panel. Use the **Week / Month** toggle to switch between calendar modes. Use the **Summary** button to show or hide the statistics bar (Total, Active, Streak, Best).

**Navigation** uses the left and right arrow buttons to move between weeks or months. The forward button is disabled when viewing the current period.

**Group View** is available at the bottom of the panel if you have joined a group. Click "Group View" to see aggregated and individual member heatmaps, or "My View" to return to your personal data.

## Group Sync Setup

To use the group reading feature, you need a backend server.

1. Deploy the server using the provided script: `bash install_server.sh`
2. Alternatively, follow the detailed instructions in [SERVER_DEPLOYMENT.md](./SERVER_DEPLOYMENT.md).
3. In Zotero, go to **Edit > Settings > Reading Heatmap** and enter the server URL.
4. Create a new group or join an existing one using a 6-digit invite code.

## Project Structure

```
zotero-reading-heatmap/
├── addon/                          # Plugin source code
│   ├── bootstrap.js                # Zotero plugin bootstrap
│   ├── manifest.json               # Plugin metadata (version, ID)
│   ├── prefs.js                    # Default preference values
│   ├── chrome/content/
│   │   ├── icons/favicon.png       # Plugin icon
│   │   ├── scripts/
│   │   │   └── reading-heatmap.js  # Main plugin script (all modules)
│   │   └── preferences/
│   │       ├── preferences.xhtml   # Settings UI layout
│   │       └── prefs.js            # Settings UI logic
│   └── locale/                     # Localization (en-US, zh-CN)
├── heatmap-server/                 # Backend server for group sync
│   └── server.js                   # Express + SQLite server
├── xpi/                            # Packaged plugin files
├── SERVER_DEPLOYMENT.md            # Server deployment guide
└── README.md                       # This file
```

## Main Script Architecture

The main plugin script (`reading-heatmap.js`) is organized into six sections:

| Section | Class / Object | Responsibility |
|---|---|---|
| 1 | `StorageManager` | Local JSON data persistence, daily/weekly/monthly stats |
| 2 | `ReadingTracker` | Zotero active-window time tracking using focus/blur events |
| 3 | `SyncManager` | Server communication, group management, data upload/download |
| 4 | `HeatmapRenderer` | SVG-based monthly and weekly heatmap rendering |
| 5 | `StyleDataImporter` | Import reading data from Zotero Style plugin |
| 6 | `Zotero.ReadingHeatmap` | Main plugin object, UI orchestration, panel management |

## Changelog

### v0.6.5

- Changed tracking from PDF scroll-based detection to Zotero active-window timing
- Removed the unused idle threshold preference from the settings pane

### v0.6.6

- Repacked the active-window tracking build with the same archive layout as the previous working XPI

### v0.6.7

- Rebuilt the XPI as a real ZIP archive for Zotero installation compatibility

### v0.6.9

- Fixed the preferences pane script loader by using the registered chrome content URL

### v0.6.10

- Fixed duplicate Item Pane section registration after add-on reloads/upgrades

### v0.6.11

- Fixed blank Group Overlay cells by rendering member stripes without SVG clipPath

### v0.6.12

- Added a slim collapse toggle in the sidebar to hide controls and show a clean calendar-only view

### v0.6.13

- Moved the clean calendar toggle into Zotero's native section header, next to the built-in section collapse button

### v0.6.14

- Added a Chartero-style empty-selection side pane so Reading Heatmap can remain visible when no library item is selected
- The empty-selection pane shows a mini dense heatmap matching the current personal/group and combined/overlay view, without visible labels or legends

### v0.7.1

- Fixed empty-selection rendering so the mini heatmap appears above Zotero's normal item-pane deck instead of replacing it
- Preserved Chartero's summary iframe and Zotero's default "items in this view" content below the mini heatmap

### v0.7.2

- Changed the empty-selection mini heatmap to an absolute overlay so it no longer takes layout space from Zotero's default side pane or Chartero's summary iframe
- Reduced the mini heatmap size further for a lighter empty-selection header

### v0.7.3

- Temporarily disabled automatic empty-selection mini heatmap mounting to avoid interfering with Zotero's default side pane and Chartero
- Kept the mini heatmap rendering code in place for future sidebar work

### v0.7.4

- Simplified the core script by removing the disabled empty-selection listener and overlay pipeline
- Kept a small cleanup hook for old empty-selection DOM nodes and retained the reusable mini heatmap renderer

### v0.6.2

- User color (userColor) now syncs to the server: each member's personalized color is uploaded during device registration and returned in group data downloads
- Group view now displays other members' actual personalized colors instead of preset palette colors
- Server updated to v1.1.0: `devices` table gains `userColor` column with automatic migration for existing databases
- Included `update_server.sh` one-click server update script in `heatmap-server/`

### v0.6.1

- Added Combined/Overlay toggle in group view: switch between aggregated single-color heatmap and multi-color stripe overlay where each day cell shows per-member colored stripes
- Added Members collapse/expand button to hide or show individual member heatmaps below the main group heatmap
- Overlay mode supports both monthly and weekly calendar views
- Member color legend in overlay mode uses HTML flex-wrap for responsive layout

### v0.6.0

- Added week/month calendar view toggle in the side panel toolbar
- Added summary statistics toggle button to show/hide Total, Active, Streak, and Best
- Fixed group view legend overflow: legends now render as HTML flex-wrap elements instead of fixed-position SVG, ensuring proper wrapping within sidebar width
- Refactored `_renderMonthView` to `_renderMainView` with unified toolbar
- Added `getWeeklyStats()`, `computeSimpleSummary()`, `buildWeeklyHeatmapDOM()`, and `getGroupWeeklyData()` methods
- Week navigation with `_navigateWeek()` and automatic month/year sync

### v0.5.2

- Fixed Settings page buttons (Test Connection, Create Group, Join Group) not responding to clicks
- Added personal group color customization in settings

### v0.5.1

- Monthly calendar heatmap with pagination
- Group reading sync with aggregated and individual member heatmaps
- Zotero Style data import (JSON file and Addon Item)
- CSV and JSON data export

### v0.5.0

- Redesigned from annual heatmap to monthly calendar view
- Embedded heatmap in Zotero's item pane (no external browser)
- Added server deployment guide and one-click install script

## License

This project is provided as-is for personal and academic use.

## Acknowledgments

Inspired by [zotero-read-tracker](https://github.com/marysethomas/zotero-read-tracker) by marysethomas.
