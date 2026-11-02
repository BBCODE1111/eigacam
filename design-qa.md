# EIGACAM v3 — design QA

Date: 2026-11-02. Scope: full redesign. A camera-first cinema monitor UI replaces the editor-style panels, a new LUT-based colour engine replaces the stacked-layer pipeline, and capture moves to full sensor resolution with a develop-to-roll flow.

## Why

User feedback: it felt like an editing app, not a cinema camera; photos looked low resolution and soft; the looks were weak.

Root causes found in v2:
- Live preview was processed at 960px and about 12fps, then stretched to the screen.
- On iPhone, capture fell back to a video frame, and constraints with a frame-rate ideal steered the browser to small video modes.
- Looks were built from HSV hue hacks across 9 stacked layers. The bloom "atmosphere" pass laid a haze over every pixel, which reads as blur.

## Evidence

- `docs/camera-portrait.jpg`: 390×844 live view, 2.39 scope matte, after a shot, and the viewer.
- `docs/camera-landscape.jpg`: 844×390 live view and viewer.
- `docs/looks.jpg`: the production renderer on four photos × the three kept looks.
- 100% crops of full-resolution develops were compared with and without sharpening: crisper edges, no ringing, no banding in skies.
- End-to-end in Chromium with a 1920×1440 fake camera: live preview, frame-line change, EV ruler drag, look swipe, shutter (button and Space key), develop to IndexedDB roll, roll grid, viewer, re-develop. Tested at 390×844, 844×390 and 1280×800 with no page overflow and no console errors.
- 28 unit tests: look metadata, LUT range, tonal monotonicity, black and white points, neutral monochrome, tone-curve shoulder, colour-space round trips, .cube parsing and errors, crop geometry, dial mapping, camera stream ownership, resolution upgrade, zoom, still capture and share payloads.

## Limitations

Not tested on a physical iPhone or Android camera. The fake camera validates flow and geometry only. It does not validate device resolution negotiation, frame rate, Safari's ImageBitmap/FLIP_Y behaviour, or the HQ native-camera round trip. Developing a 12MP photo on a phone will take noticeably longer than on desktop.

## Masks and recipes — 2026-11-02

- Mask engine: linear, radial, luminance-range and colour-range selections with exposure, temperature, tint, saturation, contrast and colour tint, evaluated per pixel in the develop shader (live preview and full-resolution develop share it).
- Pixel probe: radial +2 EV lifts the centre from 150 to 237 (8-bit) and leaves corners unchanged; saturation −100 neutralises the centre; duplicated-and-inverted masks select the complement.
- Studio flow exercised in Chromium with and without a camera: add radial, drag handle, EV ruler, duplicate-and-invert, show range, save as recipe R1, shoot and develop with it, viewer shows R1. No page errors.
- Love Letter keeps skin chroma at 91–100% of the input and lips at about 85%, while greens drop to about a third.
