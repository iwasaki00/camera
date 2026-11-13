# Compatibility fixtures

`legacy-parts.mjs` creates the old fixed four-part data solely for schema 1/2/3 import tests. It is never loaded by the application.

`original-renderer.mjs` is a frozen pre-v0.5 renderer used to compare ORIGINAL output and migrated manual crops at pixel level.

v0.9.0 removes face tracking, its model/WASM/Worker, synthetic landmarks and the now-unused NASA face test image. Current video tests use moving Canvas input with the actual browser encoder, rather than any recognition model.
