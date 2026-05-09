# Changelog

All notable changes to Zotero Reading Heatmap are documented here.

## v0.7.5

- Restored the empty-selection mini heatmap as a Zotero item-pane deck panel.
- Added a Zotero-like empty view message below the mini heatmap showing the current view item count when available.
- Added Chartero priority handling: if Chartero's summary iframe is active, Reading Heatmap hides its empty-selection panel instead of covering Chartero.

## v0.7.4

- Simplified the core script by removing the disabled empty-selection listener and overlay pipeline.
- Kept a small cleanup hook for old empty-selection DOM nodes and retained the reusable mini heatmap renderer.

## v0.7.3

- Temporarily disabled automatic empty-selection mini heatmap mounting to avoid interfering with Zotero's default side pane and Chartero.
- Kept the mini heatmap rendering code in place for future sidebar work.

## v0.7.2

- Changed the empty-selection mini heatmap to an absolute overlay so it no longer takes layout space from Zotero's default side pane or Chartero's summary iframe.
- Reduced the mini heatmap size further for a lighter empty-selection header.

## v0.7.1

- Fixed empty-selection rendering so the mini heatmap appears above Zotero's normal item-pane deck instead of replacing it.
- Preserved Chartero's summary iframe and Zotero's default "items in this view" content below the mini heatmap.

## v0.6.14

- Added a Chartero-style empty-selection side pane so Reading Heatmap can remain visible when no library item is selected.
- The empty-selection pane shows a mini dense heatmap matching the current personal/group and combined/overlay view, without visible labels or legends.

## v0.6.13

- Moved the clean calendar toggle into Zotero's native section header, next to the built-in section collapse button.

## v0.6.12

- Added a slim collapse toggle in the sidebar to hide controls and show a clean calendar-only view.

## v0.6.11

- Fixed blank Group Overlay cells by rendering member stripes without SVG clipPath.

## v0.6.10

- Fixed duplicate Item Pane section registration after add-on reloads/upgrades.

## v0.6.9

- Fixed the preferences pane script loader by using the registered chrome content URL.

## v0.6.7

- Rebuilt the XPI as a real ZIP archive for Zotero installation compatibility.

## v0.6.6

- Repacked the active-window tracking build with the same archive layout as the previous working XPI.

## v0.6.5

- Changed tracking from PDF scroll-based detection to Zotero active-window timing.
- Removed the unused idle threshold preference from the settings pane.

## v0.6.2

- User color (`userColor`) now syncs to the server: each member's personalized color is uploaded during device registration and returned in group data downloads.
- Group view now displays other members' actual personalized colors instead of preset palette colors.
- Server updated to v1.1.0: the `devices` table gains a `userColor` column with automatic migration for existing databases.
- Included `update_server.sh` one-click server update script in `heatmap-server/`.

## v0.6.1

- Added Combined/Overlay toggle in group view: switch between aggregated single-color heatmap and multi-color stripe overlay where each day cell shows per-member colored stripes.
- Added Members collapse/expand button to hide or show individual member heatmaps below the main group heatmap.
- Overlay mode supports both monthly and weekly calendar views.
- Member color legend in overlay mode uses HTML flex-wrap for responsive layout.

## v0.6.0

- Added week/month calendar view toggle in the side panel toolbar.
- Added summary statistics toggle button to show/hide Total, Active, Streak, and Best.
- Fixed group view legend overflow: legends now render as HTML flex-wrap elements instead of fixed-position SVG, ensuring proper wrapping within sidebar width.
- Refactored `_renderMonthView` to `_renderMainView` with unified toolbar.
- Added `getWeeklyStats()`, `computeSimpleSummary()`, `buildWeeklyHeatmapDOM()`, and `getGroupWeeklyData()` methods.
- Week navigation with `_navigateWeek()` and automatic month/year sync.

## v0.5.2

- Fixed Settings page buttons (Test Connection, Create Group, Join Group) not responding to clicks.
- Added personal group color customization in settings.

## v0.5.1

- Monthly calendar heatmap with pagination.
- Group reading sync with aggregated and individual member heatmaps.
- Zotero Style data import (JSON file and Addon Item).
- CSV and JSON data export.

## v0.5.0

- Redesigned from annual heatmap to monthly calendar view.
- Embedded heatmap in Zotero's item pane (no external browser).
- Added server deployment guide and one-click install script.
