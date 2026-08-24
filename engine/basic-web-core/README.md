# Basic-Web-Core

This directory is the deliberately thin browser boundary derived from Stellaria Basic's portable camera responsibilities. It keeps world-space vectors, camera basis and perspective `Project` behavior while excluding Basic's RHI, RenderGraph, editor, window input, BasicX and platform backends.

The web renderer uses this module directly. `BasicWebCameraProjector` caches the camera basis and focal transform once per frame, and its `projectXYZ` path reuses output storage across the terrain grid instead of recalculating trigonometry and allocating an object for every terminal cell.

The simulation retains fixed-step ownership and the browser client owns WebGPU, matching the product boundary without compiling the whole engine into the browser. A future WASM slice is appropriate for packed flight/sensor simulation, but the full RHI, RenderGraph and BasicX remain deliberately excluded because their binary and JS/WASM crossing costs would not improve this Web App.
