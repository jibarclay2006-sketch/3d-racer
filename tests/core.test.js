import test from "node:test";
import assert from "node:assert/strict";
import { clamp, difficultyScale, formatTime, ordinal, rankRacers, seededRandom, shortestProgressDelta, wrap01 } from "../src/core.js";

test("numeric helpers clamp and wrap reliably", () => {
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(wrap01(1.25), 0.25);
  assert.equal(wrap01(-0.25), 0.75);
  assert.ok(Math.abs(shortestProgressDelta(0.02, 0.98) - 0.04) < 1e-9);
});

test("time and ordinal UI formatting", () => {
  assert.equal(formatTime(83_045), "01:23.045");
  assert.equal(formatTime(Number.NaN), "--:--.---");
  assert.equal(ordinal(1), "1ST");
  assert.equal(ordinal(12), "12TH");
  assert.equal(ordinal(23), "23RD");
});

test("race rankings prioritize finished time then track distance", () => {
  const ranked = rankRacers([
    { id: "player", distance: 400, finishedAt: null },
    { id: "ahead", distance: 500, finishedAt: null },
    { id: "winner", distance: 600, finishedAt: 42_000 }
  ]);
  assert.deepEqual(ranked.map((racer) => racer.id), ["winner", "ahead", "player"]);
  assert.equal(ranked[1].position, 2);
});

test("seeded scenery generator is deterministic", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.ok(difficultyScale("legend") > difficultyScale("rookie"));
});
