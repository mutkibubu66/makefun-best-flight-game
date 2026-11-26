// The screenshot scenes behind ?shot=cover|rings|landing|menu. Each one plays the real
// rules forward from a staged flight, steered by a simple autopilot (bank toward the
// next ring, pitch to its altitude, throttle for cruise), so the frame is what a real
// sortie looks like and the same seed always gives the same frame.
import { MISSIONS, STEP } from './config.js';
import { nextRing, resetFlight } from './world.js';
import { stepFlight } from './physics.js';
import { SCREEN_CRASHED, SCREEN_LANDED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/** Bank toward the target, pitch to its altitude, hold cruise throttle. */
function autopilot(state, target, throttle) {
  const dx = target.x - state.x;
  const dz = target.z - state.z;
  const wantedHeading = Math.atan2(dx, dz);
  let error = wantedHeading - state.heading;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;
  const altError = target.alt - state.y;
  return {
    roll: clamp(error * 1.6, -1, 1),
    pitch: altError > 12 ? -1 : altError < -12 ? 0.6 : 0,
    throttle: state.throttle < throttle ? 1 : state.throttle > throttle + 0.05 ? -1 : 0,
    drop: false,
  };
}

/** Run the autopilot for `seconds`, steering at the next ring. */
function flyCourse(state, seconds, throttle) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const ring = nextRing(state);
    if (!ring) break;
    stepFlight(state, autopilot(state, ring, throttle || 0.72), STEP);
    if (state.crashed) break;
  }
}

/**
 * Set `flight` to the named scene and return the screen to draw over it and the best
 * score to show. cover: mid-flight with the next ring dead ahead. rings: low over the
 * river on the sunset sortie. landing: short final over runway 36. menu: the title.
 */
export function stageShot(name, flight) {
  flight.best = 1250;
  if (name === 'menu') {
    flight.selectedMission = 0;
    flight.mission = MISSIONS[0];
    resetFlight(flight);
    flight.selectedMission = 0;
    return { screen: SCREEN_TITLE, best: 1250 };
  }
  if (name === 'landing') {
    flight.mission = MISSIONS[0];
    flight.selectedMission = 0;
    resetFlight(flight);
    flight.rings.forEach((ring) => { ring.passed = true; });
    flight.ringIndex = flight.rings.length;
    flight.x = 30;
    flight.z = -750;
    flight.y = 95;
    flight.heading = 0.02;
    flight.pitch = 0.05;
    flight.roll = 0;
    flight.speedKts = 88;
    flight.throttle = 0.32;
    flight.onGround = false;
    flight.airborne = true;
    flight.fuel = 61;
    flight.score = 940;
    flight.message = 'Short final — runway 36 ahead, ease her down';
    flight.messageTimer = 10;
    for (let index = 0; index < Math.round(2.2 / STEP); index += 1) {
      stepFlight(flight, { roll: -0.05, pitch: 0.25, throttle: -1, drop: false }, STEP);
      if (flight.crashed || flight.landed) break;
    }
    return { screen: flight.landed ? SCREEN_LANDED : SCREEN_PLAY, best: 1250 };
  }
  if (name === 'rings') {
    flight.mission = MISSIONS[1];
    flight.selectedMission = 1;
    resetFlight(flight);
    flight.selectedMission = 1;
    flight.x = 330;
    flight.z = 2250;
    flight.y = 100;
    flight.heading = 0.12;
    flight.speedKts = 105;
    flight.throttle = 0.7;
    flight.onGround = false;
    flight.airborne = true;
    flight.fuel = 74;
    flight.score = 320;
    flight.ringIndex = 2;
    flight.rings[0].passed = true;
    flight.rings[1].passed = true;
    flight.message = 'Ring 3 of 8 — stay low over the river';
    flight.messageTimer = 10;
    flyCourse(flight, 1.5, 0.72);
    return { screen: SCREEN_PLAY, best: 1250 };
  }
  // cover: the morning Ring Run, ring dead ahead, valley below, runway behind us.
  flight.mission = MISSIONS[0];
  flight.selectedMission = 0;
  resetFlight(flight);
  flight.selectedMission = 0;
  flight.x = -30;
  flight.z = 780;
  flight.y = 118;
  flight.heading = 0.04;
  flight.speedKts = 112;
  flight.throttle = 0.72;
  flight.onGround = false;
  flight.airborne = true;
  flight.fuel = 88;
  flight.score = 210;
  flight.message = 'Ring 1 of 8 — through the gold ring!';
  flight.messageTimer = 10;
  flyCourse(flight, 2.5, 0.72);
  return { screen: flight.crashed ? SCREEN_CRASHED : SCREEN_PLAY, best: 1250 };
}
