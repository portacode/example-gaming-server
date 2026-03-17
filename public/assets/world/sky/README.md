## Sky Presets

Realistic 360-degree sky panoramas downloaded on 2026-03-17 from Poly Haven.

- `qwantani-afternoon.jpg`
  - Source: `https://polyhaven.com/a/qwantani_afternoon_puresky`
  - License: `CC0`

- `overcast-soil.jpg`
  - Source: `https://polyhaven.com/a/overcast_soil_puresky`
  - License: `CC0`

- `rocky-ridge.jpg`
  - Source: `https://polyhaven.com/a/rocky_ridge_puresky`
  - License: `CC0`

### Optimized Copies

The game loads smaller optimized JPEGs from `optimized/` for faster startup:

- `optimized/qwantani-afternoon.jpg`
- `optimized/overcast-soil.jpg`
- `optimized/rocky-ridge.jpg`

These were resized from `8192x4096` to `2048x1024` and recompressed for runtime use.

The Babylon client loads the optimized files through `BABYLON.PhotoDome`. Select the active preset in code via `WORLD_SKY_PRESET` in `public/app/scene/BabylonScene.js`.
