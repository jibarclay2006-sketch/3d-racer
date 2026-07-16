export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function damp(current, target, smoothing, dt) {
  return lerp(current, target, 1 - Math.exp(-smoothing * dt));
}

export function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

export function shortestProgressDelta(a, b) {
  let delta = wrap01(a) - wrap01(b);
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

export function formatTime(milliseconds, showHours = false) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--:--.---";
  const total = Math.floor(milliseconds);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const ms = total % 1000;
  if (showHours || hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function ordinal(value) {
  const n = Math.abs(Math.trunc(value));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}TH`;
  if (n % 10 === 1) return `${n}ST`;
  if (n % 10 === 2) return `${n}ND`;
  if (n % 10 === 3) return `${n}RD`;
  return `${n}TH`;
}

export function rankRacers(racers) {
  return [...racers]
    .sort((a, b) => (b.finishedAt ?? Infinity) === (a.finishedAt ?? Infinity)
      ? b.distance - a.distance
      : (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity))
    .map((racer, index) => ({ ...racer, position: index + 1 }));
}

export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function difficultyScale(name) {
  return ({ rookie: 0.9, pro: 1, legend: 1.075 })[name] ?? 1;
}

export const TRACKS = Object.freeze([
  {
    id: "solar",
    name: "SOLAR CREST",
    location: "PACIFIC COAST",
    weather: "GOLDEN HOUR",
    laps: 3,
    displayLength: "4.2 KM",
    tech: 3,
    recordKey: "apex-rush-record-solar"
  },
  {
    id: "neon",
    name: "NEON VELOCITY",
    location: "NOVA METRO",
    weather: "MIDNIGHT RAIN",
    laps: 3,
    displayLength: "5.1 KM",
    tech: 4,
    recordKey: "apex-rush-record-neon"
  },
  {
    id: "alpine",
    name: "WHITEOUT PASS",
    location: "ALPINE RANGE",
    weather: "LIGHT SNOW",
    laps: 3,
    displayLength: "4.7 KM",
    tech: 5,
    recordKey: "apex-rush-record-alpine"
  }
]);
