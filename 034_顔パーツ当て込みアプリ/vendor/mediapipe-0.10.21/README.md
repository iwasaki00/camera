# MediaPipe Tasks Vision 0.10.21

Locally bundled subset of `@mediapipe/tasks-vision@0.10.21`, fixed for reproducibility. The package metadata specifies **Apache-2.0**. Copyright notices are retained in the upstream files; full upstream license: [LICENSE](LICENSE).

- Upstream: https://github.com/google-ai-edge/mediapipe/tree/v0.10.21
- Distribution: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/
- Files: `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}`, `wasm/vision_wasm_nosimd_internal.{js,wasm}`, `package.json`.
- License source: https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE
- Purpose: Face Landmarker VIDEO inference only, CPU delegate. SIMD and non-SIMD runtimes cover browser capability differences. No CDN requests at runtime, no cloud inference, no image uploads.
- The app uses a classic Worker because the upstream WASM loader calls `importScripts`. If Worker/OffscreenCanvas initialization fails, it uses the main-thread detector with lower input resolution and frequency.
- Downloaded distribution files are unmodified. The map file is not needed for execution and is not bundled.

SHA-256 checksums and sizes are recorded in [asset-manifest.json](asset-manifest.json). Models have separate provenance documentation in [../../models/README.md](../../models/README.md).

`face-landmarks.js` is a derived selection of unique contour indices from the official `FACEMESH_LIPS`, `FACEMESH_LEFT_EYE`, `FACEMESH_RIGHT_EYE`, and `FACEMESH_NOSE` definitions. Source: https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/mediapipe/python/solutions/face_mesh_connections.py . Copyright 2021 The MediaPipe Authors, Apache-2.0. Only representation was changed; no indices were guessed. The app treats LEFT/RIGHT as the subject's anatomical left/right and always feeds the unmirrored frame.
