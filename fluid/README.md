# Pocket Fluid

A phone-first, dependency-free 2D FLIP/PIC liquid toy. Open `index.html` through an HTTP server (the root `npm start` serves it at `/fluid/`). Motion needs HTTPS on a real phone; localhost is suitable for desktop controls.

- Enable motion once, then tilt or shake. iOS requests motion permission from the button tap.
- Empty bottle removes all course geometry. Slides, Funnel and Pins preserve the original course options.
- Drag to stir. Arrow keys tilt; R refills. Settings include fill, motion strength, Pixels/Liquid rendering, six color presets and a custom picker, a dot backdrop toggle, pause/resume, Splash, fullscreen, and hidden controls. Space pauses on a keyboard.
- Normal motion strength (1.0×) now matches the original 0.6×. Saved lower motion settings migrate to the new scale, and the original fluid solver is unchanged.
- Preferences stay on the device. Sensor data never leaves the page.

`physics.js` uses a staggered MAC grid with solid boundaries, PIC/FLIP transfers, pressure projection, typed-array spatial hashing, and adaptive CFL substeps. Gravity is applied on the grid before projection, so walls support the resting fluid without continuously injecting energy. The animation clock advances in 1/120-second steps and drops long background gaps. Orientation uses a full gravity projection, while linear acceleration is consumed as acceleration (not accumulated once per sensor event). There is no artificial flip-dot display latency.

Run `node --test fluid/physics.test.js` for settling, volume, responsive tilt, strong shaking, obstacle containment, and sensor-coordinate checks. Real device motion permission and sensor feel should also be tested on hardware.

Inspired by [mitxela's FLIP Fluid on Flip Dots](https://mitxela.com/projects/flipflip). Solver concepts and transfer/projection adaptation from [Matthias Müller's Ten Minute Physics](https://matthias-research.github.io/pages/tenMinutePhysics/18-flip.html), used under the MIT license in `LICENSE`.

## Rheoscopic shimmer

Select Liquid, then enable Rheoscopic shimmer. Reflective pigment follows the simulation's material particles, rotates with the local velocity gradient, and produces pearlescent bands and short fading pathlines. It supports every color, freezes when paused, and is masked to the current water surface. Pigment is recreated after refill or resize; it never changes the solver, forces, or particle velocities.

The 2D platelet shading is a qualitative visualization, inspired by [Virtual Rheoscopic Fluids](https://sites.cc.gatech.edu/people/home/turk/my_papers/rheoscopic_fluids.pdf). It is not a quantitative turbulence diagnostic.
