# Pocket Fluid

A phone-first, dependency-free 2D FLIP/PIC liquid toy. Open `index.html` through an HTTP server (the root `npm start` serves it at `/fluid/`). Motion needs HTTPS on a real phone; localhost is suitable for desktop controls.

- Enable motion once, then tilt or shake. iOS requests motion permission from the button tap.
- Empty bottle removes all course geometry. Slides, Funnel and Pins preserve the original course options.
- Drag to stir. Arrow keys tilt; R refills. Settings include fill, motion strength, Pixels/Liquid rendering, Splash, fullscreen, and hidden controls.
- Preferences stay on the device. Sensor data never leaves the page.

`physics.js` uses a staggered MAC grid with solid boundaries, PIC/FLIP transfers, pressure projection, typed-array spatial hashing, and adaptive CFL substeps. Gravity is applied on the grid before projection, so walls support the resting fluid without continuously injecting energy. The animation clock advances in 1/120-second steps and drops long background gaps. Orientation uses a full gravity projection, while linear acceleration is consumed as acceleration (not accumulated once per sensor event). There is no artificial flip-dot display latency.

Run `node --test fluid/physics.test.js` for settling, volume, responsive tilt, strong shaking, obstacle containment, and sensor-coordinate checks. Real device motion permission and sensor feel should also be tested on hardware.

Inspired by [mitxela's FLIP Fluid on Flip Dots](https://mitxela.com/projects/flipflip). Solver concepts and transfer/projection adaptation from [Matthias Müller's Ten Minute Physics](https://matthias-research.github.io/pages/tenMinutePhysics/18-flip.html), used under the MIT license in `LICENSE`.
