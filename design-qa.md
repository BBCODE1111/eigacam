# EIGACAM camera redesign — design QA

final result: passed

Date: 2026-10-24. Scope: selected option 2, updated to the user's subsequent request for five broad cinematic looks before director-specific expansions.

## Visual evidence

- Selected reference: ImageGen `exec-cdfd6f58-1d86-4c59-bc8b-2de06a5c04ef.png` (option 2).
- Implemented view: [390 × 844 mobile camera](docs/mobile-camera.png).
- [Responsive layout captures](docs/responsive.png): 320 × 568, 375 × 667 and 844 × 390.
- [Actual engine output, two photos and all five looks](docs/five-looks.png).

The selected reference and final implementation were viewed together in the same visual comparison. Hierarchy, proportions, spacing, typography, colors, icon family, borders, controls and responsive behavior were inspected.

The design retains the image-led camera surface, compact top brand/export row, four right-side tools, floating MIX strip, bottom look pill and ivory shutter flanked by album/flip actions. MIX is a single 56px strip with its close action. All primary buttons fit the tested viewports without page scrolling. The 390px portrait preview is approximately 390 × 585px, compared with approximately 320 × 212px in the previous mobile UI.

Intentional adaptations: existing EIGACAM logo and real Tabler icons; actual imported photography instead of the generated mock's rainy-night photograph; five broad color names instead of quotes, following the newest scope; complete composition by default, with a full-bleed preview toggle; actual camera availability represented by disabled flip/export states. A reference image cannot validate grading, so the color comparison uses the production renderer on identical inputs.

## Fixed findings

- P2: MIX tray collided with the lowest tool. Reduced MIX to one row and repositioned the tool stack.
- P2: small portrait screens put the tool stack over the export button while a panel was open. Hide the stack temporarily on short portrait screens; the panel close action remains visible.
- P2: landscape camera dock covered the export button. Corrected stacking order and verified button center hit targets.
- No unresolved P0–P2 issues in the inspected flows and dimensions.

## Functional evidence

- 17 automated core/camera tests pass, including old recipe compatibility, camera stream ownership/races, monotonic curves and input validation.
- GPU browser suite passes: all five looks alter pixels, MIX 0 preserves the source, black-and-white is truly neutral, curves and separate light/shadow switches affect output, preview/export agree at identical dimensions.
- Grain browser suite passes: increasing strength increases measured noise, size/roughness change texture, no frame jitter, export/preview scaling and JPEG retention checked.
- Synthetic-stream integration passes: live graded video updates, no microphone, flip releases prior stream, capture preserves sensor dimensions, tracks stop after capture, permission denial retains the still, export opens.
- Actual UI exercised: import, look selection, MIX, coarse grain, light switch, curve slider and JPEG download (1707 × 2560).
- Responsive DOM assertions confirm no page overflow and unobstructed shutter, album and export centers. Visual captures inspected as well.
- Browser console showed no errors in the final local app check.

Limitations: no physical iPhone/Android camera was used. Synthetic video validates the application flow, not device-specific camera quality, performance, permissions UI or mobile Safari behavior. Browser camera images use the stream's actual resolution; full-quality native-camera photos can be imported.
