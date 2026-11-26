// The valley itself, with no drawing and no browser in it: terrain height, the river,
// the patchwork fields, the runway, the ring course, the clouds and the hot-air
// balloons. Everything is a pure function of world position, so the renderer and the
// physics read the same ground. World units are metres: x east, z north, y up.
// The runway runs north from the origin; the course rings hang over the valley.
import { MISSIONS, RING_RADIUS, RUNWAY } from './config.js';
import { cellHash, makeNoise } from './random.js';

const noiseLow = makeNoise(11);
const noiseHigh = makeNoise(77);

/** The river's centre line: a slow sine wandering east as it runs north. */
export function riverCentreX(z) {
  return 340 + 260 * Math.sin(z * 0.00045) + 90 * Math.sin(z * 0.0013 + 1.7);
}

export function isRiver(x, z) {
  return Math.abs(x - riverCentreX(z)) < 26;
}

function nearRunway(x, z) {
  // The strip plus its southern approach corridor, so a landing approach flies over
  // flat valley floor, not into the hills south of the field.
  return Math.abs(x) < 110 && z > -1600 && z < RUNWAY.endZ + 260;
}

/** Ground height in metres: rolling hills, flattened along the runway strip. */
export function terrainHeight(x, z) {
  const hills = noiseLow(x * 0.0011, z * 0.0011) * 34 + noiseHigh(x * 0.004, z * 0.004) * 9;
  let height = 22 + hills;
  if (isRiver(x, z)) height = Math.min(height, 2);
  if (nearRunway(x, z)) {
    const edge = Math.min(1, (Math.abs(x) - RUNWAY.halfWidth) / 80);
    let along = 0;
    if (z < -1400) along = Math.min(1, (-z - 1400) / 200);
    else if (z > RUNWAY.endZ) along = Math.min(1, (z - RUNWAY.endZ) / 200);
    const flat = Math.max(edge, along);
    height = height * flat;
  }
  return Math.max(0, height);
}

/** Which field patch a ground point belongs to, for the patchwork look. */
export function fieldKind(x, z) {
  if (isRiver(x, z)) return 'river';
  if (Math.abs(x) < RUNWAY.halfWidth && z >= RUNWAY.startZ && z <= RUNWAY.endZ) return 'runway';
  if (Math.abs(x) < RUNWAY.halfWidth + 6 && z >= RUNWAY.startZ - 40 && z <= RUNWAY.endZ + 40) return 'runwayEdge';
  const roll = cellHash(Math.floor(x / 130), Math.floor(z / 130), 5);
  if (roll < 0.16) return 'forest';
  if (roll < 0.2) return 'town';
  return roll < 0.45 ? 'fieldA' : roll < 0.7 ? 'fieldB' : roll < 0.88 ? 'fieldC' : 'meadow';
}

export const FIELD_COLOURS = {
  fieldA: '#6fa055', fieldB: '#a8a04e', fieldC: '#7d9b4a', meadow: '#8fae62',
  forest: '#3f6b34', town: '#9a938a', river: '#3f7fa8', runway: '#5c6068', runwayEdge: '#c8c2b2',
};

const CLOUDS = [];
for (let index = 0; index < 26; index += 1) {
  CLOUDS.push({
    x: (cellHash(index, 3, 9) - 0.5) * 9000,
    z: 400 + cellHash(index, 7, 9) * 5200,
    alt: 420 + cellHash(index, 11, 9) * 260,
    size: 90 + cellHash(index, 13, 9) * 160,
  });
}

const BALLOONS = [
  { x: 500, z: 2300, alt: 210, colour: '#d84a4a', popped: false },
  { x: -540, z: 3400, alt: 170, colour: '#e8a13c', popped: false },
  { x: 120, z: 4600, alt: 240, colour: '#4a7fd8', popped: false },
];

/**
 * Project a world point into screen space from the camera (the plane). Returns null
 * when the point is behind the camera. screenX is centred on the view, screenY is
 * measured from the top; scale is pixels per metre at that depth, for sizing sprites.
 */
export function project(x, y, z, camera) {
  const dx = x - camera.x;
  const dz = z - camera.z;
  const sin = Math.sin(-camera.heading);
  const cos = Math.cos(-camera.heading);
  const forward = dx * sin + dz * cos;
  if (forward < 8) return null;
  const lateral = dx * cos - dz * sin;
  const scale = camera.focal / forward;
  return {
    x: camera.cx + lateral * scale,
    y: camera.horizonY - (y - camera.y) * scale + camera.pitch * camera.focal * 0.9,
    scale,
    forward,
  };
}

/** The flight state and the course for one sortie. step() is in physics.js. */
export function createFlight(mission, seed) {
  const rings = mission.rings.map((ring) => ({ ...ring, radius: RING_RADIUS, passed: false }));
  const balloons = BALLOONS.map((balloon) => ({ ...balloon, popped: false }));
  const state = {
    mission,
    seed,
    x: 0, z: 420, y: 0,
    heading: 0, pitch: 0, roll: 0,
    speedKts: 0, throttle: 0, fuel: mission.fuel,
    score: 0, ringIndex: 0, rings, balloons,
    elapsed: 0, landed: false, crashed: false, finished: false,
    damage: 0, stall: false, onGround: true, airborne: false, peakAlt: 0,
    dropDone: false, dropArmed: mission.drop !== undefined,
    message: '', messageTimer: 0, ringFlash: 0, streak: 0,
    verticalSpeed: 0, gust: 0, gustTimer: 0,
    landingQuality: '', finalScore: 0,
  };
  return state;
}

/** Put the plane back on the runway threshold, ready for takeoff. */
export function resetFlight(state) {
  const fresh = createFlight(state.mission, state.seed);
  Object.keys(fresh).forEach((key) => { state[key] = fresh[key]; });
  state.message = 'Line up on runway 36 — throttle up to take off';
  state.messageTimer = 6;
}

export function nextRing(state) {
  return state.rings[state.ringIndex] || null;
}

export function clouds() {
  return CLOUDS;
}

/** Trees are a hash of the field cell, so the same copse is always in the same place. */
export function treeAt(cellX, cellZ) {
  const roll = cellHash(cellX, cellZ, 21);
  if (roll < 0.55) return null;
  return {
    x: cellX * 130 + cellHash(cellX, cellZ, 22) * 130,
    z: cellZ * 130 + cellHash(cellX, cellZ, 23) * 130,
    size: 7 + cellHash(cellX, cellZ, 24) * 9,
  };
}
