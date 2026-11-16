# Spectrum Atlas

Browse official Innovation, Science and Economic Development Canada technical spectrum records for British Columbia and Nova Scotia. Filter a selected extract by site, licensee, call sign or licence number and a TX/RX frequency range. Inspect records on a map and export up to 10,000 matches.

Find records near a city centre, decimal coordinates or a point picked on the map. The radius search uses straight-line distance between published site coordinates and the search centre, sorts matching records nearest first, and combines with the selected province, extract, text and frequency filters. CSV exports include the search centre, radius and each exported match's distance while the radius filter is active. Selecting a city also selects its province. Proximity calculations run in the browser. The optional OpenStreetMap background requests tiles for the area in view.

```sh
python3 scripts/build.py
node --test tests/*.test.mjs
python3 -m http.server --directory dist 8000
```

The fixed service and terrestrial spectrum licence ZIPs are downloaded from the [ISED SMS downloads page](https://ised-isde.canada.ca/site/spectrum-management-system/en/spectrum-management-system-data/download-sms-data), then streamed and split into four province/extract JSON shards. The browser loads just the selected shard. Rows with invalid or geographically implausible positions are omitted. ISED's array contains multiple records at the same coordinates, so the map groups exact locations and shows a bounded subset of points in the current view. The source archive's file date and build date appear in the UI. For offline rebuilds pass `--fixed fixed.zip --terrestrial sites.zip` and optionally `--leaflet leaflet-1.9.4.tgz`.

The headerless fixed service extract uses the [official TAFL field description](https://ised-isde.canada.ca/site/spectrum-management-system/sites/default/files/attachments/2022/tafl_description_ltaf.pdf). The terrestrial extract uses its column names. Licensee and licence identifiers are retained. Account, contact, telephone, email and mailing address fields are excluded. Reported frequencies, grant status and locations describe the records, not measured coverage or actual signal operation. The map does not infer links between sites. No account or token is needed. The optional basemap requests tiles from OpenStreetMap and includes attribution. Leaflet 1.9.4 is vendored at build time with a verified package checksum and its license included in `dist/`.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
