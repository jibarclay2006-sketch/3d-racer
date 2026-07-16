# Apex Rush 3D

Apex Rush 3D is a complete low-poly WebGL arcade racer that runs directly in the browser. Every car, circuit, prop, weather effect, particle, engine note, sound effect, and music beat is generated in code—there are no external runtime assets or build step.

**Play online:** [jibarclay2006-sketch.github.io/3d-racer](https://jibarclay2006-sketch.github.io/3d-racer/)

## Play locally

```bash
npm install
npm start
```

Open `http://localhost:8080`.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | W / Up Arrow | RT / A |
| Brake | S / Down Arrow | LT |
| Steer | A and D / Arrow Keys | Left Stick |
| Drift | Space | B |
| Nitro | Shift | X / LB |
| Pause | P / Escape | Menu |
| Mute | M | — |

Multi-touch controls appear automatically on phones and tablets.

## Included in version 1.0

- Three fully 3D circuits with elevation, distinct handling, boost pads, and themed scenery
- Solar Crest at golden hour, rain-soaked Neon Velocity, and snowy Whiteout Pass
- Seven named AI rivals with skill, corner awareness, lane selection, overtaking, and difficulty scaling
- Arcade acceleration, braking, grip, drifting, off-road slowdown, barriers, car contact, and camera shake
- Rechargeable nitro, drift chains, boost pads, sparks, tire smoke, dust, snow, rain, and speed effects
- Chase camera with speed-sensitive FOV, vehicle pitch and roll, spinning wheels, lights, shadows, and reflections
- Procedural Web Audio engine layers, wind, tire scrub, collisions, countdowns, lap stingers, finish fanfare, and an adaptive racing beat
- Full race grid, countdown, three-lap races, positions, lap splits, local track records, results, pause, restart, and garage flow
- Keyboard, gamepad, and multi-touch input with responsive desktop and mobile HUDs
- Installable PWA and service worker for offline play after the first load

## Development

The browser imports a vendored, license-preserved Three.js ES module, so GitHub Pages can serve the project as static files. Run all checks with:

```bash
npm run check
```

Core deterministic helpers and tests live in `src/core.js` and `tests/core.test.js`. The complete renderer, world generation, physics, AI, audio, input, effects, and race loop live in `src/game.js`.

## License

Game code is MIT licensed. The vendored Three.js files retain their original MIT license in `vendor/THREE-LICENSE.txt`.
