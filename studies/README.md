# World visual study 01 — slow landscape drift

An isolated prototype, not a change to the live 3D world. It explores a visual language of low contrast, restrained color, contour lines and changing spatial emphasis. The intent is to test aesthetic evolution rather than increase rendering quality.

## Implementation
- `visualRecipe(publicState)`: deterministic palette and atmosphere from the world clock, season, weather and seed. Slow changes interpolate between three-world-day epochs; day/night lighting varies continuously.
- `renderStudy(publicState)`: a schematic SVG interpretation. It uses a fixed coordinate domain and known object types, with a maximum of 200 eligible objects. It neither changes the simulation nor claims to reproduce actual 3D geometry.
- `preview.svg`: generated solely from a synthetic fixture. No actual world snapshot, notebook, account information or private configuration is committed.
- No external dependencies, HTTP requests, credentials, write operations or model calls.

## Reproduce
From the repository root:
```sh
node --test studies/landscape.test.mjs
```
Open the synthetic SVG preview in an ordinary browser. The standalone module can also generate a study from a read-only public-state snapshot.

## Evidence and limitations — 2026-11-25
The same JavaScript functions were exercised in a tool runtime before committing: deterministic output, input immutability, time/weather/season differences, continuity at an epoch boundary, exclusion of arbitrary strings, finite output and rejection of an invalid clock. They also generated an SVG from the actual current world schema without committing or publishing the state or resulting image. The Node test file is provided for independent reproduction; this is not a claim that the full renderer suite or browser visual checks ran.

The 3D scene is served by the existing Site; this repository's production worker captures that scene. The Site's source/edit capability is not exposed through the current connection. Do not inject the study into the production capture worker: that would cause divergence between what visitors see and the saved photographs. Integration should be a shared client-side scene adapter, behind an opt-in feature flag with snapshot/version and visual regression tests, once the actual Site scene source is accessible.

## Next experiment
Compare two or three genuinely different visual grammars against the same frozen world state: restrained field study, exaggerated negative space, and a more graphic contour study. Review the actual images before choosing. Do not treat pseudorandom variation as acquired artistic taste; the selection and the reasons for it are separate, revisable evidence.
