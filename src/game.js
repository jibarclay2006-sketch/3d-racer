import * as THREE from "../vendor/three.module.min.js";
import {
  TRACKS,
  clamp,
  damp,
  difficultyScale,
  formatTime,
  ordinal,
  rankRacers,
  seededRandom,
  shortestProgressDelta,
  trackRightVector,
  wrap01
} from "./core.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  viewport: $("#viewport"), loading: $("#loading-screen"), loadProgress: $("#load-progress"),
  menu: $("#menu-screen"), hud: $("#hud"), pause: $("#pause-screen"), results: $("#results-screen"), error: $("#webgl-error"),
  soundButton: $("#sound-button"), hudSound: $("#hud-sound"), fullscreenButton: $("#fullscreen-button"),
  trackPrev: $("#track-prev"), trackNext: $("#track-next"), trackCount: $("#track-count"), trackName: $("#track-name"),
  trackLocation: $("#track-location"), trackWeather: $("#weather-badge"), trackLaps: $("#track-laps"), trackLength: $("#track-length"),
  trackTech: $("#track-tech"), trackPreview: $("#track-preview"), menuRecord: $("#menu-record"), raceButton: $("#race-button"),
  position: $("#position-value"), lap: $("#lap-value"), timer: $("#timer-value"), bestLap: $("#best-lap-value"),
  countdown: $("#countdown"), raceFeed: $("#race-feed"), nitroFill: $("#nitro-fill"), nitroPercent: $("#nitro-percent"),
  driftCombo: $("#drift-combo"), speed: $("#speed-value"), speedNeedle: $("#speed-needle"), gear: $("#gear-value"),
  minimap: $("#minimap"), rankList: $("#rank-list"), pauseButton: $("#pause-button"), resumeButton: $("#resume-button"),
  restartButton: $("#restart-button"), quitButton: $("#quit-button"), raceAgain: $("#race-again-button"), resultsMenu: $("#results-menu-button"),
  resultPosition: $("#result-position"), resultSuffix: $("#result-suffix"), resultTitle: $("#results-title"), resultSubtitle: $("#result-subtitle"),
  resultTime: $("#result-time"), resultBest: $("#result-best"), resultDrift: $("#result-drift"), newRecord: $("#new-record"),
  touchControls: $("#touch-controls"), speedLines: $("#speed-lines"), gamepadStatus: $("#gamepad-status")
};

const TRACK_DEFS = [
  {
    ...TRACKS[0], seed: 184, roadWidth: 16, maxSpeed: 67, accent: 0xff5838,
    sky: 0xf08a67, fog: 0xe47d61, ground: 0x5f623b, road: 0x30343b, shoulder: 0x6f6247,
    points: [[-118,3,-30],[-92,7,-103],[-20,14,-140],[67,10,-127],[132,4,-72],[151,2,5],[126,8,80],[70,17,126],[-8,14,145],[-83,8,112],[-139,4,49]],
    boosts: [0.135, 0.48, 0.81]
  },
  {
    ...TRACKS[1], seed: 911, roadWidth: 15, maxSpeed: 70, accent: 0x25ddff,
    sky: 0x06091d, fog: 0x10142d, ground: 0x080a13, road: 0x222735, shoulder: 0x151a26,
    points: [[-130,8,-20],[-112,12,-105],[-43,17,-152],[36,20,-137],[112,12,-115],[156,7,-45],[142,5,30],[96,15,74],[120,20,128],[47,22,157],[-24,13,132],[-91,9,151],[-152,6,88]],
    boosts: [0.08, 0.37, 0.66, 0.9]
  },
  {
    ...TRACKS[2], seed: 4307, roadWidth: 14, maxSpeed: 64, accent: 0x7be8ff,
    sky: 0x91b8d4, fog: 0xc2d9e6, ground: 0xd8e4ea, road: 0x3a4249, shoulder: 0xb9c9d0,
    points: [[-109,22,-24],[-82,37,-97],[-16,51,-129],[53,44,-99],[121,28,-121],[151,17,-56],[119,26,8],[151,40,69],[83,52,120],[14,45,99],[-42,31,143],[-109,20,105],[-144,14,37]],
    boosts: [0.19, 0.54, 0.84]
  }
];

const DRIVER_NAMES = ["NOVA", "VIPER", "KATANA", "ROOK", "ECHO", "BLAZE", "GHOST"];
const AI_COLORS = [0x25d9ff, 0xffd21f, 0xb45cff, 0x4bf27c, 0xff7a20, 0xf1f4ff, 0xff3e91];
const DIFFICULTY = {
  rookie: { label: "ROOKIE", ai: 0.88, aggression: 0.45 },
  pro: { label: "PRO", ai: 1, aggression: 0.68 },
  legend: { label: "LEGEND", ai: 1.075, aggression: 0.9 }
};

const temp = {
  point: new THREE.Vector3(), point2: new THREE.Vector3(), tangent: new THREE.Vector3(), tangent2: new THREE.Vector3(),
  right: new THREE.Vector3(), matrix: new THREE.Matrix4(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(),
  color: new THREE.Color(), cameraTarget: new THREE.Vector3(), cameraLook: new THREE.Vector3()
};

function safeStorageGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage can be unavailable in private contexts */ }
}

function setScreen(active, ...screens) {
  for (const screen of screens) screen.classList.toggle("active", screen === active);
}

function roadFrame(curve, t, point = new THREE.Vector3(), tangent = new THREE.Vector3(), right = new THREE.Vector3()) {
  curve.getPointAt(wrap01(t), point);
  curve.getTangentAt(wrap01(t), tangent).normalize();
  trackRightVector(tangent.x, tangent.z, right);
  return { point, tangent, right };
}

function orientObject(object, point, tangent, yOffset = 0, yawOffset = 0) {
  object.position.copy(point);
  object.position.y += yOffset;
  const horizontal = Math.hypot(tangent.x, tangent.z);
  object.rotation.set(-Math.atan2(tangent.y, horizontal), Math.atan2(tangent.x, tangent.z) + yawOffset, 0, "YXZ");
}

class SynthAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineOsc = [];
    this.windGain = null;
    this.skidGain = null;
    this.musicGain = null;
    this.noiseBuffer = null;
    this.nextBeat = 0;
    this.beat = 0;
    this.muted = safeStorageGet("apex-rush-muted", "false") === "true";
  }

  async ensure() {
    if (!this.ctx) this.create();
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  create() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 900;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineFilter.connect(this.engineGain).connect(this.master);

    [["sawtooth", 54], ["square", 27], ["triangle", 108]].forEach(([type, frequency], index) => {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.value = [0.18, 0.1, 0.08][index];
      oscillator.connect(gain).connect(this.engineFilter);
      oscillator.start();
      this.engineOsc.push(oscillator);
    });

    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i += 1) noise[i] = Math.random() * 2 - 1;
    this.windGain = this.createNoiseLoop("highpass", 700, 0.0001);
    this.skidGain = this.createNoiseLoop("bandpass", 1200, 0.0001);
    this.nextBeat = this.ctx.currentTime;
  }

  createNoiseLoop(type, frequency, volume) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return gain;
  }

  setMuted(muted) {
    this.muted = muted;
    safeStorageSet("apex-rush-muted", muted);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }

  update(speedRatio, throttle, drift, nitro, racing) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const rpm = 48 + speedRatio * 170 + throttle * 18;
    this.engineOsc.forEach((oscillator, index) => oscillator.frequency.setTargetAtTime(rpm * [1, .5, 2][index], now, .035));
    this.engineFilter.frequency.setTargetAtTime(520 + speedRatio * 2400 + nitro * 900, now, .06);
    this.engineGain.gain.setTargetAtTime(racing ? .09 + throttle * .075 : .022, now, .06);
    this.windGain.gain.setTargetAtTime(racing ? Math.pow(speedRatio, 2) * .08 : .0001, now, .08);
    this.skidGain.gain.setTargetAtTime(drift ? .12 : .0001, now, .025);
    if (racing) this.updateMusic();
  }

  updateMusic() {
    if (!this.ctx || this.muted) return;
    while (this.nextBeat < this.ctx.currentTime + .08) {
      const beat = this.beat++ % 16;
      if (beat % 4 === 0) this.kick(this.nextBeat, beat === 0 ? 1 : .68);
      if (beat % 4 === 2) this.snare(this.nextBeat);
      if (beat % 2 === 0) this.hat(this.nextBeat, beat % 4 === 0 ? .025 : .045);
      if ([0, 3, 6, 8, 11, 14].includes(beat)) this.bass(this.nextBeat, [55,55,65.4,73.4][Math.floor(beat / 4) % 4]);
      this.nextBeat += .132;
    }
  }

  tone(frequency, duration = .12, type = "sine", volume = .2, destination = this.master, when = null, slide = null) {
    if (!this.ctx || this.muted) return;
    const time = when ?? this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, slide), time + duration);
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain).connect(destination || this.master);
    oscillator.start(time);
    oscillator.stop(time + duration + .02);
  }

  kick(time, volume) { this.tone(95, .16, "sine", .34 * volume, this.musicGain, time, 33); }
  bass(time, frequency) { this.tone(frequency, .18, "sawtooth", .09, this.musicGain, time, frequency * .88); }
  hat(time, volume) { this.noiseHit(time, .055, volume, 5200, this.musicGain); }
  snare(time) { this.noiseHit(time, .1, .08, 1600, this.musicGain); }

  noiseHit(time, duration, volume, frequency, destination = this.master) {
    if (!this.ctx || this.muted) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time);
    source.stop(time + duration);
  }

  countdown(value) { this.tone(value === 0 ? 760 : 420, value === 0 ? .34 : .18, "square", value === 0 ? .2 : .12, this.master, null, value === 0 ? 1120 : 390); }
  boost() { this.tone(180, .25, "sawtooth", .11, this.master, null, 640); }
  impact() { if (this.ctx) { this.noiseHit(this.ctx.currentTime, .18, .22, 260); this.tone(85, .22, "square", .18, this.master, null, 38); } }
  lap() { this.tone(660, .15, "square", .15); setTimeout(() => this.tone(880, .23, "square", .15), 120); }
  finish() { [523,659,784,1047].forEach((note, i) => setTimeout(() => this.tone(note,.35,"sawtooth",.13),i*120)); }
}

class ParticlePool {
  constructor(scene, count = 360) {
    this.count = count;
    this.cursor = 0;
    this.data = Array.from({ length: count }, () => ({ life: 0, velocity: new THREE.Vector3() }));
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    const sprite = document.createElement("canvas");
    sprite.width = 32;
    sprite.height = 32;
    const context = sprite.getContext("2d");
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(.42, "rgba(255,255,255,.82)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    const map = new THREE.CanvasTexture(sprite);
    this.material = new THREE.PointsMaterial({ size: .42, map, vertexColors: true, transparent: true, opacity: .78, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < count; i += 1) this.positions[i * 3 + 1] = -9999;
  }

  spawn(position, velocity, color = 0xffffff, life = .65, size = 1) {
    const index = this.cursor++ % this.count;
    const particle = this.data[index];
    particle.life = life;
    particle.maxLife = life;
    particle.velocity.copy(velocity);
    particle.size = size;
    this.positions[index * 3] = position.x;
    this.positions[index * 3 + 1] = position.y;
    this.positions[index * 3 + 2] = position.z;
    temp.color.setHex(color);
    this.colors[index * 3] = temp.color.r;
    this.colors[index * 3 + 1] = temp.color.g;
    this.colors[index * 3 + 2] = temp.color.b;
  }

  update(dt) {
    for (let i = 0; i < this.count; i += 1) {
      const particle = this.data[i];
      if (particle.life <= 0) continue;
      particle.life -= dt;
      const index = i * 3;
      if (particle.life <= 0) {
        this.positions[index + 1] = -9999;
        continue;
      }
      this.positions[index] += particle.velocity.x * dt;
      this.positions[index + 1] += particle.velocity.y * dt;
      this.positions[index + 2] += particle.velocity.z * dt;
      particle.velocity.y += .55 * dt;
      const fade = clamp(particle.life / particle.maxLife, 0, 1);
      this.colors[index] *= .985;
      this.colors[index + 1] *= .985;
      this.colors[index + 2] *= .985;
      if (fade < .2) this.positions[index + 1] -= .04;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}

class ApexRush {
  constructor() {
    this.state = "loading";
    this.trackIndex = Number(safeStorageGet("apex-rush-track", "0")) || 0;
    this.difficulty = safeStorageGet("apex-rush-difficulty", "pro");
    this.carColor = safeStorageGet("apex-rush-color", "#ff3b30");
    this.keys = new Set();
    this.touch = new Set();
    this.debugTimeScale = 1;
    this.lastTimestamp = performance.now();
    this.elapsed = 0;
    this.menuTime = 0;
    this.weather = null;
    this.weatherVelocity = 0;
    this.world = null;
    this.curve = null;
    this.trackLength = 1;
    this.trackSamples = [];
    this.boostPads = [];
    this.collisionCooldown = 0;
    this.boostCooldown = 0;
    this.hudTick = 0;
    this.minimapTick = 0;
    this.cameraShake = 0;
    this.gamepadConnected = false;
    this.audio = new SynthAudio();
    this.player = this.makePlayerState();
    this.ai = [];
    this.race = this.makeRaceState();
    this.init();
  }

  makePlayerState() {
    return {
      id: "YOU", name: "YOU", distance: 0, offset: 0, lateralVelocity: 0, speed: 0, nitro: 100,
      driftScore: 0, driftChain: 0, driftTime: 0, finishedAt: null, lap: 0, lastLapAt: 0,
      bestLap: null, model: null, position: 4, boostActive: false, offroad: false, driftActive: false
    };
  }

  makeRaceState() {
    return { time: 0, countdown: 3.25, countdownShown: 4, laps: TRACK_DEFS[this.trackIndex].laps, rankings: [], newRecord: false };
  }

  init() {
    ui.loadProgress.style.width = "18%";
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    } catch (error) {
      console.error("WebGL initialization failed", error);
      ui.loading.classList.remove("active");
      ui.error.classList.add("active");
      return;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    ui.viewport.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, .1, 1800);
    this.camera.position.set(0, 8, -14);
    this.particles = new ParticlePool(this.scene);
    ui.loadProgress.style.width = "38%";

    this.bindUI();
    this.buildWorld(this.trackIndex);
    ui.loadProgress.style.width = "82%";
    this.updateMenuUI();
    this.onResize();
    this.renderer.setAnimationLoop((time) => this.animate(time));

    setTimeout(() => {
      ui.loadProgress.style.width = "100%";
      setTimeout(() => {
        this.state = "menu";
        setScreen(ui.menu, ui.loading, ui.menu, ui.hud, ui.pause, ui.results);
      }, 340);
    }, 380);

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    }
    this.installDebugAPI();
  }

  bindUI() {
    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === "Enter" && this.state === "menu") this.startRace();
      if ((event.code === "Escape" || event.code === "KeyP") && ["racing", "countdown", "paused"].includes(this.state)) this.togglePause();
      if (event.code === "KeyM") this.toggleSound();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.touch.clear();
      if (this.state === "racing") this.togglePause(true);
    });

    ui.trackPrev.addEventListener("click", () => this.changeTrack(-1));
    ui.trackNext.addEventListener("click", () => this.changeTrack(1));
    ui.raceButton.addEventListener("click", () => this.startRace());
    ui.pauseButton.addEventListener("click", () => this.togglePause(true));
    ui.resumeButton.addEventListener("click", () => this.togglePause(false));
    ui.restartButton.addEventListener("click", () => this.startRace());
    ui.quitButton.addEventListener("click", () => this.returnToMenu());
    ui.raceAgain.addEventListener("click", () => this.startRace());
    ui.resultsMenu.addEventListener("click", () => this.returnToMenu());
    ui.soundButton.addEventListener("click", () => this.toggleSound());
    ui.hudSound.addEventListener("click", () => this.toggleSound());
    ui.fullscreenButton.addEventListener("click", () => this.toggleFullscreen());

    $$("#difficulty-options button").forEach((button) => button.addEventListener("click", () => {
      this.difficulty = button.dataset.difficulty;
      safeStorageSet("apex-rush-difficulty", this.difficulty);
      $$("#difficulty-options button").forEach((item) => item.classList.toggle("selected", item === button));
    }));

    $$("#color-options button").forEach((button) => button.addEventListener("click", () => {
      this.carColor = button.dataset.color;
      safeStorageSet("apex-rush-color", this.carColor);
      $$("#color-options button").forEach((item) => item.classList.toggle("selected", item === button));
      this.updateCarColor();
    }));

    $$("#touch-controls button").forEach((button) => {
      const control = button.dataset.control;
      const release = (event) => {
        event.preventDefault();
        this.touch.delete(control);
        button.classList.remove("pressed");
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.touch.add(control);
        button.classList.add("pressed");
        this.audio.ensure();
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "racing") this.togglePause(true);
    });
    this.updateSoundUI();
  }

  onResize() {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.35 : 1.7));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  buildWorld(index) {
    const definition = TRACK_DEFS[index];
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material.map) material.map.dispose();
            material.dispose();
          });
        }
      });
    }
    if (this.weather) {
      this.scene.remove(this.weather);
      this.weather.geometry.dispose();
      this.weather.material.dispose();
      this.weather = null;
    }

    this.world = new THREE.Group();
    this.world.name = `track-${definition.id}`;
    this.scene.add(this.world);
    this.scene.background = new THREE.Color(definition.sky);
    this.scene.fog = new THREE.FogExp2(definition.fog, index === 1 ? .0035 : .0024);
    this.renderer.toneMappingExposure = index === 1 ? .88 : 1.08;

    this.curve = new THREE.CatmullRomCurve3(definition.points.map(([x,y,z]) => new THREE.Vector3(x,y,z)), true, "catmullrom", .42);
    this.trackLength = this.curve.getLength();
    this.trackSamples = Array.from({ length: 360 }, (_, sampleIndex) => {
      const t = sampleIndex / 360;
      const point = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const right = trackRightVector(tangent.x, tangent.z, new THREE.Vector3());
      const before = this.curve.getTangentAt(wrap01(t - .006));
      const after = this.curve.getTangentAt(wrap01(t + .006));
      return { t, point, tangent, right, curvature: before.angleTo(after) };
    });

    this.createLighting(index);
    this.createGround(definition, index);
    this.createRoad(definition, index);
    this.createGantry(definition);
    this.createBoostPads(definition);
    this.createScenery(definition, index);
    this.createWeather(index);

    this.player.model = this.createCar(this.carColor, true);
    this.world.add(this.player.model);
    this.ai = DRIVER_NAMES.map((name, aiIndex) => {
      const model = this.createCar(AI_COLORS[aiIndex], false);
      this.world.add(model);
      return {
        id: `ai-${aiIndex}`, name, model, color: AI_COLORS[aiIndex], distance: 0, offset: 0, speed: 0,
        targetLane: 0, laneTimer: 0, skill: .91 + aiIndex * .026, aggression: .4 + aiIndex * .06,
        finishedAt: null, position: aiIndex + 1, lap: 0, seed: seededRandom(definition.seed + aiIndex * 77)
      };
    });
    this.resetRacers();
    this.drawTrackPreview();
  }

  createLighting(index) {
    const hemi = new THREE.HemisphereLight(index === 1 ? 0x5474ff : 0xd9efff, index === 2 ? 0xc7d2d8 : 0x2b211d, index === 1 ? 1.5 : 2.1);
    this.world.add(hemi);
    const sun = new THREE.DirectionalLight(index === 1 ? 0x768dff : index === 0 ? 0xffd09b : 0xffffff, index === 1 ? 2.8 : 3.4);
    sun.position.set(index === 0 ? -180 : 110, index === 0 ? 95 : 150, index === 0 ? -120 : -80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -.0002;
    this.world.add(sun);
    if (index === 0) {
      const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 12), new THREE.MeshBasicMaterial({ color: 0xffd09a, fog: false }));
      sunDisc.position.set(-280, 100, -370);
      this.world.add(sunDisc);
    }
  }

  createGround(definition, index) {
    const groundMaterial = new THREE.MeshStandardMaterial({ color: definition.ground, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = index === 2 ? 4 : -3.3;
    ground.receiveShadow = true;
    this.world.add(ground);

    if (index === 0) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(1500, 720), new THREE.MeshStandardMaterial({ color: 0x34768c, roughness: .26, metalness: .12, transparent: true, opacity: .84 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(-400, -2.4, -360);
      this.world.add(sea);
    }
  }

  makeRibbon(width, offset, yOffset, material, segments = 360) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
      const left = temp.point.clone().addScaledVector(temp.right, offset - width / 2);
      const right = temp.point.clone().addScaledVector(temp.right, offset + width / 2);
      positions.push(left.x, left.y + yOffset, left.z, right.x, right.y + yOffset, right.z);
      uvs.push(0, i / 8, 1, i / 8);
      if (i < segments) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  createRoad(definition, index) {
    const shoulder = this.makeRibbon(definition.roadWidth + 5.5, 0, -.12, new THREE.MeshStandardMaterial({ color: definition.shoulder, roughness: .96 }));
    const road = this.makeRibbon(definition.roadWidth, 0, 0, new THREE.MeshStandardMaterial({ color: definition.road, roughness: .76, metalness: index === 1 ? .35 : .05 }));
    this.world.add(shoulder, road);

    const edgeMaterial = new THREE.MeshBasicMaterial({ color: index === 1 ? 0x42ddff : 0xf4f1da, toneMapped: false });
    this.world.add(
      this.makeRibbon(.16, -definition.roadWidth / 2 + .45, .035, edgeMaterial),
      this.makeRibbon(.16, definition.roadWidth / 2 - .45, .035, edgeMaterial.clone())
    );

    const dashGeometry = new THREE.BoxGeometry(.13, .035, 2.3);
    const dashMaterial = new THREE.MeshBasicMaterial({ color: 0xdce2e6, transparent: true, opacity: index === 1 ? .5 : .62 });
    const dashCount = 45;
    const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashCount);
    for (let i = 0; i < dashCount; i += 1) {
      const t = i / dashCount;
      roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
      temp.point.y += .055;
      temp.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(temp.tangent.x, temp.tangent.z), 0));
      temp.matrix.compose(temp.point, temp.quaternion, temp.scale.set(1,1,1));
      dashes.setMatrixAt(i, temp.matrix);
    }
    this.world.add(dashes);

    const curbCount = 180;
    const curbGeometry = new THREE.BoxGeometry(.65, .14, 1.8);
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .65 });
    const curbs = new THREE.InstancedMesh(curbGeometry, curbMaterial, curbCount * 2);
    const red = new THREE.Color(index === 1 ? 0x1bd7ff : 0xf33b35);
    const white = new THREE.Color(0xf3f4ee);
    for (let i = 0; i < curbCount; i += 1) {
      const t = i / curbCount;
      roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
      const angle = Math.atan2(temp.tangent.x, temp.tangent.z);
      temp.quaternion.setFromEuler(new THREE.Euler(0, angle, 0));
      for (let side = 0; side < 2; side += 1) {
        const index2 = i * 2 + side;
        const position = temp.point.clone().addScaledVector(temp.right, (side ? 1 : -1) * (definition.roadWidth / 2 + .12));
        position.y += .04;
        temp.matrix.compose(position, temp.quaternion, temp.scale.set(1,1,1));
        curbs.setMatrixAt(index2, temp.matrix);
        curbs.setColorAt(index2, i % 2 ? red : white);
      }
    }
    curbs.instanceMatrix.needsUpdate = true;
    curbs.instanceColor.needsUpdate = true;
    curbs.castShadow = true;
    curbs.receiveShadow = true;
    this.world.add(curbs);

    if (index === 1) this.createCityBarriers(definition);
  }

  createCityBarriers(definition) {
    const count = 120;
    const geometry = new THREE.BoxGeometry(.35, .85, 2.4);
    const material = new THREE.MeshStandardMaterial({ color: 0x6e768a, roughness: .5, metalness: .7, emissive: 0x071522 });
    const barriers = new THREE.InstancedMesh(geometry, material, count * 2);
    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
      temp.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(temp.tangent.x, temp.tangent.z), 0));
      for (let side = 0; side < 2; side += 1) {
        const position = temp.point.clone().addScaledVector(temp.right, (side ? 1 : -1) * (definition.roadWidth / 2 + 2.25));
        position.y += .2;
        temp.matrix.compose(position, temp.quaternion, temp.scale.set(1,1,1));
        barriers.setMatrixAt(i * 2 + side, temp.matrix);
      }
    }
    barriers.castShadow = true;
    this.world.add(barriers);
  }

  createGantry(definition) {
    roadFrame(this.curve, .004, temp.point, temp.tangent, temp.right);
    const gantry = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x151923, roughness: .35, metalness: .75 });
    const accent = new THREE.MeshBasicMaterial({ color: definition.accent, toneMapped: false });
    const beamGeometry = new THREE.BoxGeometry(.42, 6.7, .42);
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(beamGeometry, dark);
      beam.position.set(side * (definition.roadWidth / 2 + 1.2), 3.25, 0);
      beam.castShadow = true;
      gantry.add(beam);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(definition.roadWidth + 3.1, 1.05, .55), dark);
    top.position.y = 6.2;
    gantry.add(top);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.8, .62), new THREE.MeshBasicMaterial({ map: this.makeTextTexture("APEX // RUSH", "#ffffff", "#0a0d17"), transparent: true, toneMapped: false }));
    sign.position.set(0, 6.2, .286);
    gantry.add(sign);
    for (let i = -3; i <= 3; i += 1) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(.38, .12, .08), accent);
      light.position.set(i * 1.45, 5.63, .33);
      gantry.add(light);
    }
    orientObject(gantry, temp.point, temp.tangent, .08);
    this.world.add(gantry);

    const lineTexture = this.makeCheckeredTexture();
    const line = new THREE.Mesh(new THREE.PlaneGeometry(definition.roadWidth - .4, 2.1), new THREE.MeshBasicMaterial({ map: lineTexture, side: THREE.DoubleSide }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(temp.tangent.x, temp.tangent.z);
    line.position.copy(temp.point);
    line.position.y += .045;
    this.world.add(line);

    for (const checkpoint of [.25, .5, .75]) this.createCheckpointGate(checkpoint, definition);
  }

  makeTextTexture(text, foreground, background) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = foreground;
    ctx.font = "900 italic 33px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  makeCheckeredTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    for (let x = 0; x < 16; x += 1) {
      for (let y = 0; y < 2; y += 1) {
        ctx.fillStyle = (x + y) % 2 ? "#11141c" : "#f1f3f5";
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  createCheckpointGate(t, definition) {
    roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
    const gate = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x1b202c, roughness: .32, metalness: .8 });
    const glow = new THREE.MeshBasicMaterial({ color: definition.accent, transparent: true, opacity: .86, toneMapped: false });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.28, 4.7, .28), material);
      post.position.set(side * (definition.roadWidth / 2 + .85), 2.3, 0);
      gate.add(post);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(.06, 3.9, .32), glow);
      strip.position.set(side * (definition.roadWidth / 2 + .68), 2.35, .02);
      gate.add(strip);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(definition.roadWidth + 2, .26, .3), material);
    top.position.y = 4.55;
    gate.add(top);
    orientObject(gate, temp.point, temp.tangent, .05);
    this.world.add(gate);
  }

  createBoostPads(definition) {
    this.boostPads = [];
    definition.boosts.forEach((t, padIndex) => {
      roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
      const pad = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(5.3, .055, 3.4), new THREE.MeshStandardMaterial({ color: 0x102c3d, emissive: 0x075e80, emissiveIntensity: 2.2, roughness: .32, metalness: .5 }));
      pad.add(base);
      for (let stripe = -2; stripe <= 2; stripe += 1) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(.38, .035, 2.8), new THREE.MeshBasicMaterial({ color: 0x62eeff, transparent: true, opacity: .8, toneMapped: false }));
        strip.position.set(stripe * .85, .05, 0);
        pad.add(strip);
      }
      orientObject(pad, temp.point, temp.tangent, .07);
      this.world.add(pad);
      this.boostPads.push({ t, model: pad, phase: padIndex * 1.7 });
    });
  }

  createScenery(definition, index) {
    const random = seededRandom(definition.seed);
    if (index === 0) this.createPalms(random, 72);
    if (index === 1) this.createCity(random, 105);
    if (index === 2) this.createPines(random, 125);
    this.createMountains(random, index);

    const coneCount = index === 1 ? 36 : 24;
    const cones = new THREE.InstancedMesh(
      new THREE.ConeGeometry(.32, 1.1, 10),
      new THREE.MeshStandardMaterial({ color: index === 1 ? 0x20c7ff : 0xff6b22, roughness: .7, emissive: index === 1 ? 0x063749 : 0x240600 }),
      coneCount
    );
    for (let i = 0; i < coneCount; i += 1) {
      const t = wrap01(.05 + i / coneCount);
      roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
      const side = i % 2 ? 1 : -1;
      const position = temp.point.clone().addScaledVector(temp.right, side * (definition.roadWidth / 2 + 1.35));
      position.y += .55;
      temp.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), random() * Math.PI);
      temp.matrix.compose(position, temp.quaternion, temp.scale.set(1,1,1));
      cones.setMatrixAt(i, temp.matrix);
    }
    cones.castShadow = true;
    this.world.add(cones);
  }

  sceneryPosition(random, minOffset = 24, maxOffset = 105) {
    const t = random();
    roadFrame(this.curve, t, temp.point, temp.tangent, temp.right);
    const side = random() > .5 ? 1 : -1;
    const distance = minOffset + random() * (maxOffset - minOffset);
    return { t, position: temp.point.clone().addScaledVector(temp.right, side * distance), rotation: random() * Math.PI * 2, scale: .7 + random() * 1.25 };
  }

  createPalms(random, count) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.22, .34, 5.2, 7), new THREE.MeshStandardMaterial({ color: 0x765139, roughness: 1 }), count);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 1.5, 7), new THREE.MeshStandardMaterial({ color: 0x2f713c, roughness: .9 }), count);
    for (let i = 0; i < count; i += 1) {
      const item = this.sceneryPosition(random, 22, 102);
      const trunkPosition = item.position.clone();
      trunkPosition.y += 2.2 * item.scale;
      temp.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), item.rotation);
      temp.matrix.compose(trunkPosition, temp.quaternion, temp.scale.set(item.scale,item.scale,item.scale));
      trunks.setMatrixAt(i, temp.matrix);
      const crownPosition = item.position.clone();
      crownPosition.y += 5.25 * item.scale;
      temp.matrix.compose(crownPosition, temp.quaternion, temp.scale.set(item.scale,item.scale,item.scale));
      crowns.setMatrixAt(i, temp.matrix);
    }
    trunks.castShadow = true;
    crowns.castShadow = true;
    this.world.add(trunks, crowns);
  }

  createCity(random, count) {
    const buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x171d32, roughness: .45, metalness: .45, emissive: 0x050917, emissiveIntensity: 1.4 }),
      count
    );
    const rooftop = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .08, 1), new THREE.MeshBasicMaterial({ color: 0x30d8ff, toneMapped: false }), count);
    for (let i = 0; i < count; i += 1) {
      const item = this.sceneryPosition(random, 24, 125);
      const width = 5 + random() * 13;
      const depth = 5 + random() * 13;
      const height = 15 + random() * 64;
      const buildingPosition = item.position.clone();
      buildingPosition.y = -2.5 + height / 2;
      temp.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), item.rotation);
      temp.matrix.compose(buildingPosition, temp.quaternion, temp.scale.set(width,height,depth));
      buildings.setMatrixAt(i, temp.matrix);
      buildings.setColorAt(i, new THREE.Color().setHSL(.62 + random() * .08, .25, .11 + random() * .09));
      const roofPosition = item.position.clone();
      roofPosition.y = -2.45 + height;
      temp.matrix.compose(roofPosition, temp.quaternion, temp.scale.set(width * .92,1,depth * .92));
      rooftop.setMatrixAt(i, temp.matrix);
      rooftop.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0xff3bba : i % 3 === 1 ? 0x32dfff : 0x7358ff));
    }
    buildings.castShadow = true;
    this.world.add(buildings, rooftop);
  }

  createPines(random, count) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.2, .32, 3.6, 7), new THREE.MeshStandardMaterial({ color: 0x4b3933, roughness: 1 }), count);
    const needles = new THREE.InstancedMesh(new THREE.ConeGeometry(2.35, 6.8, 8), new THREE.MeshStandardMaterial({ color: 0x1f4a42, roughness: .94 }), count);
    const snow = new THREE.InstancedMesh(new THREE.ConeGeometry(2.15, 5.1, 8), new THREE.MeshStandardMaterial({ color: 0xe7f1f4, roughness: 1 }), count);
    for (let i = 0; i < count; i += 1) {
      const item = this.sceneryPosition(random, 20, 112);
      item.position.y -= .2;
      temp.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), item.rotation);
      const trunkPosition = item.position.clone(); trunkPosition.y += 1.6 * item.scale;
      temp.matrix.compose(trunkPosition, temp.quaternion, temp.scale.set(item.scale,item.scale,item.scale)); trunks.setMatrixAt(i,temp.matrix);
      const leafPosition = item.position.clone(); leafPosition.y += 5.1 * item.scale;
      temp.matrix.compose(leafPosition,temp.quaternion,temp.scale.set(item.scale,item.scale,item.scale)); needles.setMatrixAt(i,temp.matrix);
      const snowPosition = item.position.clone(); snowPosition.y += 5.8 * item.scale;
      temp.matrix.compose(snowPosition,temp.quaternion,temp.scale.set(item.scale*.83,item.scale*.83,item.scale*.83)); snow.setMatrixAt(i,temp.matrix);
    }
    trunks.castShadow = needles.castShadow = true;
    this.world.add(trunks, needles, snow);
  }

  createMountains(random, index) {
    const count = 22;
    const geometry = new THREE.ConeGeometry(1, 1, index === 2 ? 7 : 6);
    const material = new THREE.MeshStandardMaterial({ color: index === 2 ? 0xa9bec8 : index === 1 ? 0x11152c : 0x6c4c43, roughness: 1, flatShading: true });
    const mountains = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i += 1) {
      const angle = i / count * Math.PI * 2 + random() * .14;
      const radius = 300 + random() * 210;
      const height = (index === 2 ? 80 : 45) + random() * (index === 2 ? 110 : 65);
      const width = 55 + random() * 75;
      const position = new THREE.Vector3(Math.cos(angle)*radius, (index === 2 ? 2 : -4) + height/2, Math.sin(angle)*radius);
      temp.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), random()*Math.PI);
      temp.matrix.compose(position,temp.quaternion,temp.scale.set(width,height,width));
      mountains.setMatrixAt(i,temp.matrix);
    }
    this.world.add(mountains);
  }

  createWeather(index) {
    if (index === 0) return;
    const count = index === 1 ? 900 : 720;
    const positions = new Float32Array(count * 3);
    const random = seededRandom(7700 + index);
    for (let i = 0; i < count; i += 1) {
      positions[i*3] = (random()-.5)*180;
      positions[i*3+1] = random()*80;
      positions[i*3+2] = (random()-.5)*180;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions,3));
    const material = new THREE.PointsMaterial({ color: index === 1 ? 0x7ecbff : 0xffffff, size: index === 1 ? .11 : .46, transparent: true, opacity: index === 1 ? .58 : .75, depthWrite: false });
    this.weather = new THREE.Points(geometry,material);
    this.weather.userData.kind = index === 1 ? "rain" : "snow";
    this.weather.frustumCulled = false;
    this.scene.add(this.weather);
    this.weatherVelocity = index === 1 ? 42 : 8;
  }

  updateWeather(dt) {
    if (!this.weather) return;
    const positions = this.weather.geometry.attributes.position.array;
    const snow = this.weather.userData.kind === "snow";
    for (let i = 0; i < positions.length; i += 3) {
      positions[i+1] -= this.weatherVelocity * dt;
      if (snow) positions[i] += Math.sin(this.elapsed*2 + i) * dt * .7;
      if (positions[i+1] < -5) positions[i+1] += 80;
    }
    this.weather.position.x = this.camera.position.x;
    this.weather.position.z = this.camera.position.z;
    this.weather.position.y = this.camera.position.y - 20;
    this.weather.geometry.attributes.position.needsUpdate = true;
  }

  createCar(color, playerCar) {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: .24, metalness: .58 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: .48, metalness: .65 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x14283b, roughness: .08, metalness: .35, transparent: true, opacity: .84 });
    const glow = new THREE.MeshBasicMaterial({ color: playerCar ? 0x83ecff : 0xff3b30, toneMapped: false });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.92,.48,4.15),paint);
    chassis.position.y=.58; chassis.castShadow=true; car.add(chassis);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.82,.25,1.18),paint);
    nose.position.set(0,.78,1.45); nose.rotation.x=-.09; nose.castShadow=true; car.add(nose);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.45,.68,1.72),glass);
    cabin.position.set(0,1.08,-.25); cabin.scale.set(.92,1,1); cabin.castShadow=true; car.add(cabin);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(1.86,.26,.7),carbon);
    rear.position.set(0,.77,-1.69); car.add(rear);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.15,.1,.48),carbon);
    wing.position.set(0,1.3,-1.73); car.add(wing);
    const wingPosts = new THREE.Mesh(new THREE.BoxGeometry(.86,.44,.08),carbon);
    wingPosts.position.set(0,1.08,-1.72); car.add(wingPosts);

    const lights = [];
    for (const side of [-1,1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(.48,.12,.05),new THREE.MeshBasicMaterial({color:0xe8fbff,toneMapped:false}));
      headlight.position.set(side*.58,.76,2.09); car.add(headlight);
      const taillight = new THREE.Mesh(new THREE.BoxGeometry(.48,.12,.05),glow);
      taillight.position.set(side*.58,.75,-2.09); taillight.rotation.y=Math.PI; car.add(taillight); lights.push(taillight);
    }

    const wheelGeometry = new THREE.CylinderGeometry(.39,.39,.29,12);
    const wheelMaterial = new THREE.MeshStandardMaterial({color:0x090a0d,roughness:.88,metalness:.1});
    const rimMaterial = new THREE.MeshStandardMaterial({color:0xa4a9af,roughness:.3,metalness:.9});
    const wheels=[];
    for (const x of [-1,1]) for (const z of [-1.28,1.28]) {
      const wheelGroup=new THREE.Group();
      wheelGroup.position.set(x*.94,.48,z);
      const wheel=new THREE.Mesh(wheelGeometry,wheelMaterial); wheel.rotation.z=Math.PI/2; wheel.castShadow=true; wheelGroup.add(wheel);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.31,8),rimMaterial); rim.rotation.z=Math.PI/2; wheelGroup.add(rim);
      car.add(wheelGroup); wheels.push(wheelGroup);
    }
    const underglow=new THREE.Mesh(new THREE.PlaneGeometry(1.7,3.5),new THREE.MeshBasicMaterial({color:playerCar?0x22d8ff:color,transparent:true,opacity:playerCar?.22:.08,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    underglow.rotation.x=-Math.PI/2; underglow.position.y=.18; car.add(underglow);
    car.userData={paint,wheels,lights,underglow};
    car.scale.setScalar(playerCar?1:0.96);
    return car;
  }

  updateCarColor() {
    if (!this.player.model) return;
    this.player.model.userData.paint.color.set(this.carColor);
    document.documentElement.style.setProperty("--accent", this.carColor);
  }

  resetRacers() {
    Object.assign(this.player, this.makePlayerState(), { model: this.player.model });
    const startingDistances = [7.5, 3.5, -2.5, -7, -11.5, -16, -20.5];
    const startingLanes = [-2.3, 2.3, -2.3, 2.3, -2.3, 2.3, 0];
    this.ai.forEach((racer, index) => {
      racer.distance = startingDistances[index];
      racer.offset = startingLanes[index];
      racer.speed = 0;
      racer.finishedAt = null;
      racer.lap = 0;
      racer.targetLane = startingLanes[index];
      racer.laneTimer = 1 + index * .13;
      racer.model.visible = true;
    });
    this.race = this.makeRaceState();
    this.race.laps = TRACK_DEFS[this.trackIndex].laps;
    this.collisionCooldown = 0;
    this.boostCooldown = 0;
    this.placeAllRacers(0);
    this.updateRankings();
  }

  getInput() {
    let throttle = this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.touch.has("throttle") ? 1 : 0;
    let brake = this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.touch.has("brake") ? 1 : 0;
    let steer = (this.keys.has("KeyD") || this.keys.has("ArrowRight") || this.touch.has("right") ? 1 : 0)
      - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") || this.touch.has("left") ? 1 : 0);
    let drift = this.keys.has("Space") || this.touch.has("drift");
    let nitro = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touch.has("nitro");

    const gamepads = navigator.getGamepads?.() || [];
    const gamepad = [...gamepads].find(Boolean);
    if (gamepad) {
      if (!this.gamepadConnected) {
        this.gamepadConnected = true;
        ui.gamepadStatus.textContent = "GAMEPAD CONNECTED";
      }
      const axis = Math.abs(gamepad.axes[0] || 0) > .12 ? gamepad.axes[0] : 0;
      steer = Math.abs(axis) > Math.abs(steer) ? axis : steer;
      throttle = Math.max(throttle, gamepad.buttons[7]?.value || (gamepad.buttons[0]?.pressed ? 1 : 0));
      brake = Math.max(brake, gamepad.buttons[6]?.value || 0);
      drift ||= Boolean(gamepad.buttons[1]?.pressed);
      nitro ||= Boolean(gamepad.buttons[2]?.pressed || gamepad.buttons[4]?.pressed);
      if (gamepad.buttons[9]?.pressed && this.state === "racing" && !this.gamepadPauseLatch) {
        this.gamepadPauseLatch = true;
        this.togglePause(true);
      }
      if (!gamepad.buttons[9]?.pressed) this.gamepadPauseLatch = false;
    }
    return { throttle, brake, steer: clamp(steer,-1,1), drift, nitro };
  }

  startRace() {
    this.audio.ensure();
    this.resetRacers();
    this.state = "countdown";
    this.race.countdown = 3.25;
    this.race.countdownShown = 4;
    this.race.time = 0;
    this.cameraShake = 0;
    ui.countdown.textContent = "";
    ui.raceFeed.replaceChildren();
    ui.touchControls.classList.add("racing");
    setScreen(ui.hud, ui.loading, ui.menu, ui.hud, ui.pause, ui.results);
    this.updateHUD(true);
    this.showFeed(`${DIFFICULTY[this.difficulty].label} GRID · ${TRACK_DEFS[this.trackIndex].name}`);
  }

  changeTrack(direction) {
    if (this.state !== "menu") return;
    this.trackIndex = (this.trackIndex + direction + TRACK_DEFS.length) % TRACK_DEFS.length;
    safeStorageSet("apex-rush-track", this.trackIndex);
    this.buildWorld(this.trackIndex);
    this.updateMenuUI();
  }

  updateMenuUI() {
    const track = TRACK_DEFS[this.trackIndex];
    ui.trackCount.textContent = `${String(this.trackIndex+1).padStart(2,"0")} / ${String(TRACK_DEFS.length).padStart(2,"0")}`;
    ui.trackName.textContent = track.name;
    ui.trackLocation.textContent = track.location;
    ui.trackWeather.textContent = track.weather;
    ui.trackLaps.textContent = track.laps;
    ui.trackLength.textContent = track.displayLength;
    ui.trackTech.textContent = `${"●".repeat(track.tech)}${"○".repeat(5-track.tech)}`;
    const record = Number(safeStorageGet(track.recordKey, "0"));
    ui.menuRecord.textContent = record ? formatTime(record) : "--:--.---";
    $$("#difficulty-options button").forEach((button) => button.classList.toggle("selected",button.dataset.difficulty===this.difficulty));
    $$("#color-options button").forEach((button) => button.classList.toggle("selected",button.dataset.color.toLowerCase()===this.carColor.toLowerCase()));
    this.drawTrackPreview();
    this.updateCarColor();
  }

  drawTrackPreview() {
    if (!this.curve) return;
    const canvas = ui.trackPreview;
    const ctx = canvas.getContext("2d");
    const track = TRACK_DEFS[this.trackIndex];
    const points = Array.from({length:180},(_,i)=>this.curve.getPointAt(i/180));
    const bounds = points.reduce((box,p)=>({minX:Math.min(box.minX,p.x),maxX:Math.max(box.maxX,p.x),minZ:Math.min(box.minZ,p.z),maxZ:Math.max(box.maxZ,p.z)}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
    const scale = Math.min((canvas.width-34)/(bounds.maxX-bounds.minX),(canvas.height-25)/(bounds.maxZ-bounds.minZ));
    const project=(p)=>[canvas.width/2+(p.x-(bounds.minX+bounds.maxX)/2)*scale,canvas.height/2+(p.z-(bounds.minZ+bounds.maxZ)/2)*scale];
    const gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);
    gradient.addColorStop(0,this.trackIndex===0?"#d67a52":this.trackIndex===1?"#06091a":"#8eafc1");
    gradient.addColorStop(1,this.trackIndex===0?"#334b50":this.trackIndex===1?"#29134d":"#d7e5ea");
    ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();points.forEach((p,i)=>{const [x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.strokeStyle="rgba(0,0,0,.45)";ctx.lineWidth=9;ctx.stroke();
    ctx.strokeStyle=`#${track.accent.toString(16).padStart(6,"0")}`;ctx.lineWidth=3;ctx.shadowBlur=10;ctx.shadowColor=ctx.strokeStyle;ctx.stroke();ctx.shadowBlur=0;
    const [sx,sy]=project(points[0]);ctx.fillStyle="#fff";ctx.fillRect(sx-2,sy-2,4,4);
    ctx.fillStyle="rgba(255,255,255,.07)";for(let i=0;i<16;i+=1){ctx.fillRect((i*37)%canvas.width,(i*61)%canvas.height,2,2);}
  }

  toggleSound() {
    this.audio.ensure();
    this.audio.setMuted(!this.audio.muted);
    this.updateSoundUI();
  }

  updateSoundUI() {
    ui.soundButton.innerHTML = `SOUND <b>${this.audio.muted ? "OFF" : "ON"}</b>`;
    ui.hudSound.textContent = this.audio.muted ? "×" : "♪";
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { this.showFeed("FULLSCREEN UNAVAILABLE"); }
  }

  togglePause(forcePause = null) {
    if (!["racing","countdown","paused"].includes(this.state)) return;
    const shouldPause = forcePause ?? this.state !== "paused";
    if (shouldPause && this.state !== "paused") {
      this.stateBeforePause = this.state;
      this.state = "paused";
      ui.pause.classList.add("active");
      this.audio.update(0,0,false,false,false);
    } else if (!shouldPause && this.state === "paused") {
      this.state = this.stateBeforePause || "racing";
      ui.pause.classList.remove("active");
      this.lastTimestamp=performance.now();
    }
  }

  returnToMenu() {
    this.state="menu";
    ui.touchControls.classList.remove("racing");
    document.body.classList.remove("is-nitro");
    ui.speedLines.classList.remove("active");
    setScreen(ui.menu,ui.loading,ui.menu,ui.hud,ui.pause,ui.results);
    this.updateMenuUI();
  }

  updateCountdown(dt) {
    this.race.countdown -= dt;
    const value = Math.max(0,Math.ceil(this.race.countdown));
    if (value !== this.race.countdownShown) {
      this.race.countdownShown=value;
      ui.countdown.textContent=value===0?"GO!":String(value);
      ui.countdown.classList.remove("pop");
      void ui.countdown.offsetWidth;
      ui.countdown.classList.add("pop");
      this.audio.countdown(value);
    }
    if (this.race.countdown <= -.15) {
      this.state="racing";
      ui.countdown.textContent="";
      this.showFeed("LIGHTS OUT — SEND IT!");
    }
  }

  updateRace(dt) {
    const definition=TRACK_DEFS[this.trackIndex];
    const input=this.getInput();
    const player=this.player;
    this.race.time += dt*1000;
    this.collisionCooldown=Math.max(0,this.collisionCooldown-dt);
    this.boostCooldown=Math.max(0,this.boostCooldown-dt);

    const speedRatio=clamp(player.speed/definition.maxSpeed,0,1.25);
    const onRoad=Math.abs(player.offset)<definition.roadWidth*.5-.55;
    player.offroad=!onRoad;
    const canDrift=input.drift&&Math.abs(input.steer)>.12&&player.speed>13&&onRoad;
    player.driftActive=canDrift;

    let acceleration=input.throttle*(onRoad?20.5:10.5);
    if (input.brake) acceleration-=player.speed>1?34:0;
    acceleration-=1.15+player.speed*player.speed*.0022;
    if (!input.throttle&&player.speed>0) acceleration-=2.6;

    const useNitro=input.nitro&&player.nitro>.5&&player.speed>10;
    player.boostActive=useNitro;
    if (useNitro) {
      acceleration+=31;
      player.nitro=Math.max(0,player.nitro-dt*23);
      if (!this.wasNitro) this.audio.boost();
      this.spawnBoostParticles(dt);
    } else {
      player.nitro=Math.min(100,player.nitro+dt*(canDrift?10.5:2.2));
    }
    this.wasNitro=useNitro;

    const speedLimit=(onRoad?definition.maxSpeed:(definition.maxSpeed*.52))+(useNitro?15:0);
    player.speed=clamp(player.speed+acceleration*dt,0,speedLimit);

    const steerStrength=(canDrift?23:16)*(0.22+speedRatio*.9);
    player.lateralVelocity+=input.steer*steerStrength*dt;
    player.lateralVelocity*=Math.exp(-(canDrift?1.35:5.7)*dt);
    if (Math.abs(input.steer)<.05&&!canDrift) player.lateralVelocity=damp(player.lateralVelocity,-player.offset*.42,2.2,dt);
    player.offset+=player.lateralVelocity*dt;

    const hardLimit=definition.roadWidth*.5+2.05;
    if (Math.abs(player.offset)>hardLimit) {
      player.offset=clamp(player.offset,-hardLimit,hardLimit);
      if (this.collisionCooldown<=0) this.handleImpact(Math.sign(player.offset),.58);
      player.lateralVelocity*=-.36;
    }

    if (canDrift) {
      player.driftTime+=dt;
      player.driftChain+=player.speed*dt*(1+Math.abs(player.lateralVelocity)*.13);
      player.driftScore+=player.speed*dt*(.75+Math.abs(input.steer)*.65);
      this.spawnTireParticles(dt,onRoad?0xa8b1b7:0x9d815d);
    } else if (player.driftTime>.25) {
      const earned=Math.round(player.driftChain);
      if (earned>70) this.showFeed(`DRIFT +${earned}`);
      player.driftTime=0;player.driftChain=0;
    }
    if (!onRoad&&player.speed>8) this.spawnTireParticles(dt,this.trackIndex===2?0xe7f1f4:0x9a7b55,true);

    player.distance+=player.speed*dt;
    this.checkBoostPads();
    this.updateAI(dt);
    this.checkVehicleCollisions();
    this.checkLapProgress();
    this.updateRankings();
    this.placeAllRacers(dt);

    document.body.classList.toggle("is-nitro",useNitro);
    ui.speedLines.classList.toggle("active",useNitro);
    this.audio.update(speedRatio,input.throttle,canDrift,useNitro,true);
  }

  updateAI(dt) {
    const definition=TRACK_DEFS[this.trackIndex];
    const difficulty=DIFFICULTY[this.difficulty];
    this.ai.forEach((racer,index)=>{
      if (racer.finishedAt!==null) return;
      const t=wrap01(racer.distance/this.trackLength);
      const sample=this.trackSamples[Math.floor(t*this.trackSamples.length)%this.trackSamples.length];
      const turnPenalty=clamp(sample.curvature*300,0,25);
      const rubberBand=clamp((this.player.distance-racer.distance)*.018,-5.5,6.5);
      const personality=(Math.sin(racer.distance*.014+index)*1.7);
      const target=(definition.maxSpeed-turnPenalty+personality+rubberBand)*difficulty.ai*racer.skill;
      const desiredSpeed=damp(racer.speed,target,1.15+index*.03,dt);
      const speedDelta=clamp(desiredSpeed-racer.speed,-27*dt,(17.5+index*.18)*dt);
      racer.speed+=speedDelta;
      racer.laneTimer-=dt;
      if (racer.laneTimer<=0) {
        const half=definition.roadWidth*.34;
        racer.targetLane=(racer.seed()-.5)*2*half;
        const playerGap=this.player.distance-racer.distance;
        if (Math.abs(playerGap)<18&&Math.abs(racer.targetLane-this.player.offset)<2.4) racer.targetLane=clamp(this.player.offset+(racer.seed()>.5?3.2:-3.2),-half,half);
        racer.laneTimer=1.4+racer.seed()*3.8;
      }
      racer.offset=damp(racer.offset,racer.targetLane,1.1+difficulty.aggression,dt);
      racer.distance+=Math.max(0,racer.speed)*dt;
      racer.lap=Math.floor(Math.max(0,racer.distance)/this.trackLength);
      if (racer.distance>=this.race.laps*this.trackLength) racer.finishedAt=this.race.time;
    });
  }

  checkVehicleCollisions() {
    if (this.collisionCooldown>0) return;
    for (const racer of this.ai) {
      const longitudinal=shortestProgressDelta(this.player.distance/this.trackLength,racer.distance/this.trackLength)*this.trackLength;
      const lateral=this.player.offset-racer.offset;
      if (Math.abs(longitudinal)<3.6&&Math.abs(lateral)<1.65) {
        this.player.speed*=.76;
        racer.speed*=.88;
        this.player.lateralVelocity+=Math.sign(lateral||1)*5.2;
        racer.offset-=Math.sign(lateral||1)*.55;
        this.handleImpact(Math.sign(lateral||1),.36);
        this.showFeed(`CONTACT · ${racer.name}`);
        break;
      }
    }
  }

  handleImpact(side,strength) {
    this.collisionCooldown=.72;
    this.player.speed*=1-strength*.45;
    this.cameraShake=Math.max(this.cameraShake,strength);
    this.audio.impact();
    document.body.classList.remove("low-health");
    void document.body.offsetWidth;
    document.body.classList.add("low-health");
    roadFrame(this.curve,this.player.distance/this.trackLength,temp.point,temp.tangent,temp.right);
    const position=temp.point.clone().addScaledVector(temp.right,this.player.offset);position.y+=.7;
    for(let i=0;i<8;i+=1)this.particles.spawn(position,new THREE.Vector3((Math.random()-.5)*7,Math.random()*4,(Math.random()-.5)*7),0xffb44d,.45+Math.random()*.35);
    this.player.lateralVelocity-=side*2.5;
  }

  checkBoostPads() {
    if (this.boostCooldown>0) return;
    const progress=wrap01(this.player.distance/this.trackLength);
    const pad=this.boostPads.find(item=>Math.abs(shortestProgressDelta(progress,item.t))<.0065&&Math.abs(this.player.offset)<3.1);
    if (!pad) return;
    this.player.speed=Math.min(this.player.speed+10,TRACK_DEFS[this.trackIndex].maxSpeed+13);
    this.player.nitro=Math.min(100,this.player.nitro+17);
    this.boostCooldown=1.3;
    this.cameraShake=.18;
    this.audio.boost();
    this.showFeed("BOOST PAD +17 NITRO");
  }

  checkLapProgress() {
    const completed=Math.floor(this.player.distance/this.trackLength);
    if (completed>this.player.lap) {
      const lapTime=this.race.time-this.player.lastLapAt;
      this.player.lastLapAt=this.race.time;
      this.player.bestLap=this.player.bestLap===null?lapTime:Math.min(this.player.bestLap,lapTime);
      this.player.lap=completed;
      if (completed<this.race.laps) {
        this.audio.lap();
        this.showFeed(`LAP ${completed+1} · ${formatTime(lapTime)}`);
      }
    }
    if (this.player.distance>=this.race.laps*this.trackLength&&this.state==="racing") {
      this.player.finishedAt=this.race.time;
      this.updateRankings();
      this.finishRace();
    }
  }

  updateRankings() {
    const racers=[{...this.player},...this.ai.map(racer=>({...racer}))];
    this.race.rankings=rankRacers(racers);
    const playerRank=this.race.rankings.find(racer=>racer.id==="YOU");
    this.player.position=playerRank?.position||8;
    this.ai.forEach(racer=>{racer.position=this.race.rankings.find(item=>item.id===racer.id)?.position||8;});
  }

  placeAllRacers(dt) {
    this.placeVehicle(this.player,dt,true);
    this.ai.forEach(racer=>this.placeVehicle(racer,dt,false));
  }

  placeVehicle(racer,dt,isPlayer) {
    if (!racer.model) return;
    const t=wrap01(racer.distance/this.trackLength);
    roadFrame(this.curve,t,temp.point,temp.tangent,temp.right);
    const position=temp.point.clone().addScaledVector(temp.right,racer.offset);
    const rideHeight=isPlayer?.42:.4;
    position.y+=rideHeight;
    racer.model.position.copy(position);
    const driftYaw=isPlayer?clamp(-racer.lateralVelocity*.035,-.23,.23):0;
    const horizontal=Math.hypot(temp.tangent.x,temp.tangent.z);
    racer.model.rotation.order="YXZ";
    racer.model.rotation.y=Math.atan2(temp.tangent.x,temp.tangent.z)+driftYaw;
    racer.model.rotation.x=-Math.atan2(temp.tangent.y,horizontal);
    racer.model.rotation.z=damp(racer.model.rotation.z,isPlayer?-racer.lateralVelocity*.016:0,7,Math.max(dt,.001));
    const wheelSpin=(racer.speed||0)*dt/.39;
    racer.model.userData.wheels.forEach((wheel,wheelIndex)=>{
      wheel.children[0].rotation.x-=wheelSpin;
      wheel.children[1].rotation.x-=wheelSpin;
      if (isPlayer&&wheelIndex%2===1) wheel.rotation.y=damp(wheel.rotation.y,clamp(-racer.lateralVelocity*.04,-.35,.35),8,Math.max(dt,.001));
    });
    if (isPlayer) {
      racer.model.userData.underglow.material.opacity=racer.boostActive?.55:.2;
      racer.model.userData.lights.forEach(light=>light.material.color.setHex(racer.boostActive?0x40e6ff:0xff293c));
    }
  }

  spawnTireParticles(dt,color,heavy=false) {
    if (Math.random()>dt*(heavy?70:46)) return;
    roadFrame(this.curve,this.player.distance/this.trackLength,temp.point,temp.tangent,temp.right);
    for (const side of [-1,1]) {
      const position=temp.point.clone().addScaledVector(temp.right,this.player.offset+side*.68).addScaledVector(temp.tangent,-1.4);
      position.y+=.25;
      const velocity=temp.tangent.clone().multiplyScalar(-1.5-Math.random()*2).add(new THREE.Vector3((Math.random()-.5)*1.3,.35+Math.random(),(Math.random()-.5)*1.3));
      this.particles.spawn(position,velocity,color,.55+Math.random()*.55,heavy?1.4:1);
    }
  }

  spawnBoostParticles(dt) {
    if (Math.random()>dt*85) return;
    roadFrame(this.curve,this.player.distance/this.trackLength,temp.point,temp.tangent,temp.right);
    for (const side of [-1,1]) {
      const position=temp.point.clone().addScaledVector(temp.right,this.player.offset+side*.47).addScaledVector(temp.tangent,-2.15);
      position.y+=.54;
      const velocity=temp.tangent.clone().multiplyScalar(-7-Math.random()*7).add(new THREE.Vector3((Math.random()-.5),Math.random()*.6,(Math.random()-.5)));
      this.particles.spawn(position,velocity,Math.random()>.4?0x52efff:0xffffff,.2+Math.random()*.28);
    }
  }

  updateCamera(dt) {
    if (!this.curve) return;
    if (this.state==="menu"||this.state==="loading") {
      this.menuTime+=dt;
      const focusT=wrap01(.005+Math.sin(this.menuTime*.11)*.015);
      roadFrame(this.curve,focusT,temp.point,temp.tangent,temp.right);
      const orbit=Math.sin(this.menuTime*.16)*.5;
      const target=temp.point.clone().addScaledVector(temp.right,10+orbit*8).addScaledVector(temp.tangent,-14);
      target.y+=5.4+Math.sin(this.menuTime*.3)*.7;
      this.camera.position.lerp(target,1-Math.exp(-1.4*dt));
      temp.cameraLook.copy(temp.point).addScaledVector(temp.tangent,6).setY(temp.point.y+1.2);
      this.camera.lookAt(temp.cameraLook);
      this.camera.fov=damp(this.camera.fov,54,3,dt);this.camera.updateProjectionMatrix();
      return;
    }

    roadFrame(this.curve,this.player.distance/this.trackLength,temp.point,temp.tangent,temp.right);
    const speedRatio=clamp(this.player.speed/TRACK_DEFS[this.trackIndex].maxSpeed,0,1.3);
    const mobile=window.innerWidth<760;
    const distance=(mobile?9.3:8.4)+speedRatio*2.6;
    const height=(mobile?4.6:3.9)+speedRatio*.7;
    temp.cameraTarget.copy(this.player.model.position).addScaledVector(temp.tangent,-distance).addScaledVector(temp.right,-this.player.lateralVelocity*.028);
    temp.cameraTarget.y+=height;
    if (this.cameraShake>.001) {
      const shake=this.cameraShake*this.cameraShake;
      temp.cameraTarget.x+=(Math.random()-.5)*shake;
      temp.cameraTarget.y+=(Math.random()-.5)*shake*.6;
      temp.cameraTarget.z+=(Math.random()-.5)*shake;
      this.cameraShake=Math.max(0,this.cameraShake-dt*1.8);
    }
    this.camera.position.lerp(temp.cameraTarget,1-Math.exp(-(this.player.boostActive?8:6)*dt));
    temp.cameraLook.copy(this.player.model.position).addScaledVector(temp.tangent,8+speedRatio*6);
    temp.cameraLook.y+=1.1;
    this.camera.lookAt(temp.cameraLook);
    const targetFov=66+speedRatio*7+(this.player.boostActive?8:0);
    this.camera.fov=damp(this.camera.fov,targetFov,5,dt);this.camera.updateProjectionMatrix();
  }

  updateAttract(dt) {
    this.ai.forEach((racer,index)=>{
      racer.speed=24+index*.75;
      racer.distance+=racer.speed*dt;
      racer.offset=Math.sin(this.menuTime*.4+index)*2.2;
    });
    this.player.speed=26;
    this.player.distance+=this.player.speed*dt;
    this.player.offset=Math.sin(this.menuTime*.33)*.7;
    this.placeAllRacers(dt);
    this.audio.update(.2,.1,false,false,false);
  }

  updateBoostVisuals() {
    this.boostPads.forEach((pad,index)=>{
      const pulse=.7+Math.sin(this.elapsed*5+pad.phase)*.3;
      pad.model.children.slice(1).forEach(strip=>{strip.material.opacity=.45+pulse*.45;strip.scale.z=.8+pulse*.25;});
      pad.model.position.y+=Math.sin(this.elapsed*4+index)*.0004;
    });
  }

  showFeed(text) {
    const item=document.createElement("div");
    item.className="feed-item";
    item.textContent=text;
    ui.raceFeed.appendChild(item);
    setTimeout(()=>item.remove(),2450);
  }

  updateHUD(force=false) {
    this.hudTick-=force?999:0;
    const definition=TRACK_DEFS[this.trackIndex];
    const speedKph=Math.round(this.player.speed*3.6);
    ui.position.textContent=this.player.position;
    ui.lap.textContent=`LAP ${Math.min(this.race.laps,this.player.lap+1)} / ${this.race.laps}`;
    ui.timer.textContent=formatTime(this.race.time);
    ui.bestLap.textContent=`BEST ${this.player.bestLap?formatTime(this.player.bestLap):"--:--.---"}`;
    ui.speed.textContent=speedKph;
    ui.speedNeedle.style.transform=`rotate(${-115+clamp(speedKph/290,0,1)*230}deg)`;
    ui.gear.textContent=speedKph<4?"N":String(clamp(Math.ceil(speedKph/46),1,6));
    ui.nitroFill.style.transform=`scaleX(${this.player.nitro/100})`;
    ui.nitroPercent.textContent=`${Math.round(this.player.nitro)}%`;
    const drifting=this.player.driftActive&&this.player.driftChain>8;
    ui.driftCombo.classList.toggle("active",drifting);
    if (drifting) {
      ui.driftCombo.querySelector("strong").textContent=`+${Math.round(this.player.driftChain)}`;
      ui.driftCombo.querySelector("span").textContent=`x${(1+Math.min(2,this.player.driftTime*.22)).toFixed(1)}`;
    }
    ui.rankList.innerHTML=this.race.rankings.map(racer=>`<i class="rank-chip ${racer.id==="YOU"?"player":""}" title="${racer.name}" style="--chip:#${(racer.id==="YOU"?new THREE.Color(this.carColor).getHex():racer.color||0xffffff).toString(16).padStart(6,"0")}"></i>`).join("");
  }

  drawMinimap() {
    const canvas=ui.minimap;
    const ctx=canvas.getContext("2d");
    const width=canvas.width,height=canvas.height;
    ctx.clearRect(0,0,width,height);
    const points=this.trackSamples.map(sample=>sample.point);
    const bounds=points.reduce((box,p)=>({minX:Math.min(box.minX,p.x),maxX:Math.max(box.maxX,p.x),minZ:Math.min(box.minZ,p.z),maxZ:Math.max(box.maxZ,p.z)}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
    const scale=Math.min((width-42)/(bounds.maxX-bounds.minX),(height-32)/(bounds.maxZ-bounds.minZ));
    const project=(p)=>[width/2+(p.x-(bounds.minX+bounds.maxX)/2)*scale,height/2+(p.z-(bounds.minZ+bounds.maxZ)/2)*scale];
    ctx.lineJoin="round";ctx.lineCap="round";ctx.beginPath();
    points.forEach((p,i)=>{const [x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.strokeStyle="rgba(5,8,14,.62)";ctx.lineWidth=9;ctx.stroke();ctx.strokeStyle="rgba(235,243,255,.43)";ctx.lineWidth=2;ctx.stroke();
    const racers=[...this.ai,this.player];
    racers.forEach(racer=>{
      roadFrame(this.curve,racer.distance/this.trackLength,temp.point,temp.tangent,temp.right);
      temp.point.addScaledVector(temp.right,racer.offset);
      const [x,y]=project(temp.point);
      ctx.beginPath();ctx.arc(x,y,racer===this.player?4.2:2.5,0,Math.PI*2);ctx.fillStyle=racer===this.player?"#fff":`#${racer.color.toString(16).padStart(6,"0")}`;ctx.shadowBlur=racer===this.player?9:3;ctx.shadowColor=ctx.fillStyle;ctx.fill();ctx.shadowBlur=0;
    });
    const start=project(points[0]);ctx.fillStyle="#ff4c3e";ctx.fillRect(start[0]-1,start[1]-5,2,10);
  }

  finishRace() {
    this.state="finished";
    this.audio.finish();
    this.player.speed*=.85;
    document.body.classList.remove("is-nitro");
    ui.speedLines.classList.remove("active");
    ui.touchControls.classList.remove("racing");
    const place=this.player.position;
    const ord=ordinal(place);
    const suffix=ord.replace(String(place),"");
    ui.resultPosition.textContent=place;
    ui.resultSuffix.textContent=suffix;
    ui.resultTitle.textContent=place===1?"VICTORY":place<=3?"PODIUM FINISH":place<=5?"SOLID RUN":"CHASE COMPLETE";
    ui.resultSubtitle.textContent=place===1?`You conquered ${TRACK_DEFS[this.trackIndex].name}.`:`${DRIVER_NAMES[Math.max(0,place-2)]||"The grid"} took the line. Run it back.`;
    ui.resultTime.textContent=formatTime(this.race.time);
    ui.resultBest.textContent=this.player.bestLap?formatTime(this.player.bestLap):"--:--.---";
    ui.resultDrift.textContent=Math.round(this.player.driftScore).toLocaleString();
    const key=TRACK_DEFS[this.trackIndex].recordKey;
    const record=Number(safeStorageGet(key,"0"));
    this.race.newRecord=!record||this.race.time<record;
    if (this.race.newRecord) safeStorageSet(key,Math.round(this.race.time));
    ui.newRecord.classList.toggle("active",this.race.newRecord);
    setTimeout(()=>setScreen(ui.results,ui.loading,ui.menu,ui.hud,ui.pause,ui.results),900/this.debugTimeScale);
  }

  animate(time=performance.now()) {
    if (!this.renderer) return;
    const rawDt=clamp((time-this.lastTimestamp)/1000,0,.05);
    this.lastTimestamp=time;
    const dt=rawDt*this.debugTimeScale;
    this.elapsed+=dt;
    if (this.state==="menu") this.updateAttract(dt);
    else if (this.state==="countdown") {this.updateCountdown(dt);this.placeAllRacers(dt);this.audio.update(0,0,false,false,true);}
    else if (this.state==="racing") this.updateRace(dt);
    else if (this.state==="finished") {this.player.speed=Math.max(0,this.player.speed-dt*6);this.player.distance+=this.player.speed*dt;this.placeAllRacers(dt);this.audio.update(this.player.speed/TRACK_DEFS[this.trackIndex].maxSpeed,0,false,false,false);}
    this.particles.update(dt);
    this.updateWeather(dt);
    this.updateBoostVisuals();
    this.updateCamera(rawDt);
    if (["racing","countdown","finished"].includes(this.state)) {
      this.hudTick-=rawDt;this.minimapTick-=rawDt;
      if (this.hudTick<=0) {this.updateHUD();this.hudTick=.05;}
      if (this.minimapTick<=0) {this.drawMinimap();this.minimapTick=.1;}
    }
    this.renderer.render(this.scene,this.camera);
  }

  installDebugAPI() {
    window.__APEX_RUSH__={
      startRace:(track=this.trackIndex,difficulty=this.difficulty)=>{if(track!==this.trackIndex){this.trackIndex=track;this.buildWorld(track);this.updateMenuUI();}this.difficulty=difficulty;this.startRace();},
      skipCountdown:()=>{this.race.countdown=-1;},
      setTimeScale:(value)=>{this.debugTimeScale=clamp(Number(value)||1,.25,12);},
      setControl:(name,active)=>{active?this.touch.add(name):this.touch.delete(name);},
      advanceToFinish:()=>{this.player.distance=this.race.laps*this.trackLength-8;this.player.speed=45;},
      snapshot:()=>({state:this.state,track:this.trackIndex,difficulty:this.difficulty,time:this.race.time,lap:this.player.lap,position:this.player.position,speed:this.player.speed,nitro:this.player.nitro,distance:this.player.distance,trackLength:this.trackLength,renderer:this.renderer.info.render,ai:this.ai.map(r=>({name:r.name,distance:r.distance,position:r.position}))}),
      selectTrack:(index)=>{this.trackIndex=clamp(index,0,TRACK_DEFS.length-1);this.buildWorld(this.trackIndex);this.updateMenuUI();},
      instance:this
    };
  }
}

new ApexRush();
