# Zotero Reading Heatmap

A Zotero plugin that automatically tracks your reading activity and visualizes it as a GitHub-style heatmap, embedded directly in Zotero's side panel.

## Features

**Automatic Zotero Activity Tracking** records time while the Zotero main window is active/focused. This avoids relying on PDF scroll events, so time is counted even when you are reading without scrolling. Data is saved locally every few seconds.

**Monthly Calendar Heatmap** displays a full month of reading activity in a calendar grid with 5-level color grading. Navigate between months with pagination controls. Today's cell is highlighted with a blue border.

**Weekly View** shows a compact single-row view of the current week's reading activity. Toggle between Week and Month views using the toolbar buttons at the top of the panel.

**Summary Statistics Toggle** allows you to show or hide the summary bar displaying Total reading time, Active days, current Streak, and Best streak.

**Group Reading Sync** enables collaborative reading tracking. Deploy a backend server, create or join groups with 6-digit invite codes, and view aggregated and individual heatmaps for all group members. Data syncs automatically every 5 minutes.

**Responsive Legend** ensures the color legend wraps properly within the sidebar width, fixing overflow issues in group view with multiple member heatmaps.

**Data Import and Export** supports importing historical reading data from the Zotero Style plugin, exporting 365-day statistics as CSV, and full JSON backup.

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
| Zotero 8.x | Yes |
| Zotero 9.x | Yes, but test after Zotero updates |
| Zotero 6.x and below | No |

## Usage

After installation, the Reading Heatmap panel appears in Zotero's right side panel. Select any item in your library to see the heatmap.

When no item is selected, the right side panel can show a minimal Reading Heatmap area. It shows a dense version of the current personal or group calendar view without labels or legends, while yielding to Chartero if Chartero's summary iframe is active.

**View Controls** are located at the top of the panel. Use the **Week / Month** toggle to switch between calendar modes. Use the **Summary** button to show or hide the statistics bar.

**Navigation** uses the left and right arrow buttons to move between weeks or months. The forward button is disabled when viewing the current period.

**Group View** is available at the bottom of the panel if you have joined a group. Click **Group View** to see aggregated and individual member heatmaps, or **My View** to return to your personal data.

## Group Sync Setup

To use the group reading feature, you need a backend server.

1. Deploy the server using the provided script: `bash install_server.sh`
2. Alternatively, follow the detailed instructions in [docs/SERVER_DEPLOYMENT.md](./docs/SERVER_DEPLOYMENT.md).
3. In Zotero, go to **Edit > Settings > Reading Heatmap** and enter the server URL.
4. Create a new group or join an existing one using a 6-digit invite code.

## Documentation

- [Documentation index](./docs/README.md)
- [English project overview](./docs/README_EN.md)
- [Chinese project overview](./docs/README_ZH.md)
- [Backend deployment guide](./docs/SERVER_DEPLOYMENT.md)
- [Chinese backend deployment guide](./docs/SERVER_DEPLOYMENT_ZH.md)
- [Changelog](./CHANGELOG.md)

## Project Structure

```text
zotero-reading-heatmap/
|-- addon/                         # Plugin source code
|   |-- bootstrap.js               # Zotero plugin bootstrap
|   |-- manifest.json              # Plugin metadata (version, ID)
|   |-- prefs.js                   # Default preference values
|   |-- chrome/content/
|   |   |-- icons/                 # Plugin icons
|   |   |-- preferences/           # Settings pane UI and logic
|   |   `-- scripts/
|   |       `-- reading-heatmap.js # Main bundled plugin script
|   `-- locale/                    # Localization (en-US, zh-CN)
|-- docs/                          # Project documentation
|   |-- README_EN.md               # English project overview
|   |-- README_ZH.md               # Chinese project overview
|   |-- SERVER_DEPLOYMENT.md       # Backend deployment guide
|   |-- SERVER_DEPLOYMENT_ZH.md    # Chinese backend deployment guide
|   `-- legacy/                    # Legacy version notes
|-- heatmap-server/                # Backend server for group sync
|-- xpi/                           # Packaged plugin files
|-- CHANGELOG.md                   # Version history
|-- LICENSE
`-- README.md
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

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE) for details.

## Acknowledgments

Inspired by [zotero-read-tracker](https://github.com/marysethomas/zotero-read-tracker) by marysethomas.
