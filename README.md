# Slide Rule Simulator or Emulator

A collection of slide rule replicas implemented in **JavaScript** (and optional C++ desktop builds). Scales are drawn programmatically from reverse‑engineered maths; no images are used for the rules themselves.

## How the application is built

### Web application (main way to run)

**There is no build step.** The web app is plain HTML and vanilla JavaScript. The `react` folder is just a directory name (not React or npm).

1. **Run locally:** Open `index.html` in a browser, or serve the project root with any static file server.
2. **Script order:** The main page loads, in order:
   - `react/sliderule_construction_kit.js` – drawing and sliderule engine
   - `react/scales.js` – scale definitions
   - `react/faber_castell_2_83n.js` – model used on the front page
   - `react/sliderule_application.js` – mounts the slide rule into `#root` and runs the draw loop
   - `react/sliderule_ctrl.js` – controls and callbacks

Individual replicas (e.g. `react/raven.html`, `react/aristo_0972_hyperlog.html`) are also plain HTML and script tags; open them directly or via links from `index.html`.

**No `package.json`:** Nothing is installed or bundled. All JS is loaded via `<script src="...">`.

### C++ / desktop (optional, separate from the web app)

- **`code/`** – wxWidgets desktop app (Linux/macOS):
  - From project root: `cd code && make linux` → `../sliderule` (Linux)
  - Or `make osx` → `../sliderule.app/Contents/MacOS/sliderule`
  - Requires: `g++`, wxWidgets (`wx-config` in PATH).

- **`SlideRule/`** – Windows (Visual Studio) or a Linux shared library:
  - **Windows:** Open `SlideRule.vcxproj` in Visual Studio and build → produces `SlideRule.exe` (often placed in project root).
  - **Linux:** The included Makefile builds a shared library and depends on external paths (e.g. Prolog/graphics2d); likely only for the original author’s environment.

The C++ programs do **not** generate the web app or any of the JavaScript; they are standalone desktop slide rule applications.

## Quick usage (web)

- Drag rule or cursor with the mouse.
- Mouse wheel to zoom.
- Right‑click on cursor or scale to enter values (e.g. `3.14`, `pi`, `2:30:26` for degrees).

## If the slide rule does not display

- Serve over HTTP when possible (e.g. `npx serve .` or your editor’s “Live Server”) so paths and behaviour match the intended setup.
- Ensure the scripts above load in order and that `#root` exists before they run (as in `index.html`).
- Check the browser console for script errors; the draw loop in `sliderule_application.js` must run every frame and only draws to canvas when the SVG element is optional (see that file).
