AVA IVY REPORT ARCHIVE STORAGE

Place published report bundles under:
  web/web-media/context/reports/<category>/<location-or-event>/<report-id>/

A report bundle may contain:
  metadata.json
  report.txt
  report.mp3
  report.jpg
  plus other assets.

metadata.json fields supported by the archive index:
id, title, category, location, state, country, created_at, published_at,
event, tags, summary, assets.

The public index automatically discovers metadata.json files and only exposes
assets that remain inside this report archive root.
