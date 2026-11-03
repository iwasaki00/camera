# Real-model integration image

`astronaut.png` is the 512×512 NASA photograph of astronaut **Eileen Collins** distributed by scikit-image v0.19.3. This is a public test fixture, not a user camera image.

- Image source: https://raw.githubusercontent.com/scikit-image/scikit-image/v0.19.3/skimage/data/astronaut.png
- Provenance/public-domain statement: https://github.com/scikit-image/scikit-image/blob/v0.19.3/skimage/data/_fetchers.py#L374-L391
- Original NASA image link provided by that source: https://flic.kr/p/r9qvLn
- Usage terms in scikit-image's data documentation: no known copyright restrictions, released into the public domain.
- SHA-256: `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`.

The integration test crops/transforms this image into a synthetic live Canvas stream and runs the shipped MediaPipe model. This validates real inference on controlled image input; it does not substitute for an iPhone Safari or real-camera test. Mouth opening, closed-eye geometry and outliers are tested separately with explicitly synthetic landmark fixtures in `tracking-fixture.mjs`.
