# Face Landmarker model bundle

- File: `face_landmarker.task` (3,758,596 bytes).
- Fixed model: MediaPipe Face Landmarker / float16 / **version 1**.
- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
- License: **Apache License 2.0**, as specified in the official component model cards. Full license: [LICENSE](LICENSE).
- Bundle: BlazeFace short-range face detection, FaceMesh V2 (478 landmarks), and blendshape model. This app disables blendshape and transformation-matrix outputs and detects only one face.

Official model documentation and licensing evidence:

- Overview / bundle: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Face detector model card: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf
- FaceMesh V2 model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- Blendshape V2 model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf

The model runs locally and is unmodified. This app is a manual creative-compositing tool with optional face-landmark tracking, not an identity-recognition tool. Large head angles, occlusion, low light, motion blur and small faces can reduce detection quality. The app rejects implausible geometry and hides expired crops; it does not reconstruct hidden facial regions. Refer to the upstream model cards for intended uses and evaluation limits.
