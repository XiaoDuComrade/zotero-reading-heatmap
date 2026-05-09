# Zotero Reading Heatmap

Zotero Reading Heatmap is a Zotero add-on that tracks active Zotero reading time and visualizes reading activity as a GitHub-style heatmap in Zotero's right side panel.

## Highlights

- Tracks active Zotero window time instead of relying on PDF scroll events.
- Displays monthly and weekly calendar heatmaps.
- Supports personal and group views.
- Supports group sync through the optional backend server.
- Supports combined and overlay group heatmaps.
- Imports historical reading data from Zotero Style data.
- Exports CSV and JSON backups.

## Installation

1. Download the latest `.xpi` package from the repository's `xpi/` directory or GitHub Releases.
2. Open Zotero.
3. Go to **Tools > Add-ons**.
4. Choose **Install Add-on From File...**.
5. Select the `.xpi` file and restart Zotero.

## Compatibility

| Zotero Version | Status |
|---|---|
| Zotero 7.x | Supported |
| Zotero 8.x | Supported |
| Zotero 9.x | Supported by manifest range, test after Zotero updates |
| Zotero 6.x and below | Not supported |

## Group Sync

Group sync requires the optional backend server. See:

- [Backend deployment guide](./SERVER_DEPLOYMENT.md)

## Notes for Maintainers

The add-on currently keeps its runtime implementation bundled in `addon/chrome/content/scripts/reading-heatmap.js` for Zotero loading stability. Future development may split the source into modules and generate the bundled runtime file during packaging.

XPI packaging is sensitive. Make sure `manifest.json` is at the archive root and do not package the `addon/` directory itself.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](../LICENSE) for details.
