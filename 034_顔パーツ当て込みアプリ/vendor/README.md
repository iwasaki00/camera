# Bundled ZIP library

- Library: fflate **0.8.2**, browser ESM distribution (`esm/browser.js`).
- License: **MIT**, copyright 2023 Arjun Barrett. Full text: [fflate-LICENSE.txt](fflate-LICENSE.txt).
- Upstream: https://github.com/101arrowz/fflate/tree/v0.8.2
- Distribution source: https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js
- License source: https://raw.githubusercontent.com/101arrowz/fflate/v0.8.2/LICENSE
- SHA-256 (`fflate-0.8.2.js`): `8cc1f687e0159e977addb6b85e274dbd11e622cf151f4fcb7b85d49622ea43e7`

Used only for ZIP creation and bounded streaming Deflate decompression. The app validates the ZIP directory, reads only the manifest and named background image, and verifies output size and CRC. Exports use the stored (uncompressed) ZIP method. The module is served locally; no runtime CDN, network API, workers or filesystem extraction are used.
