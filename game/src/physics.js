// The flight model: one fixed step of arcade flying. Throttle sets the target speed,
// pitch trades speed for altitude, roll turns the plane, and a stall drops the nose
// when the wing stops flying. Rings, the supply drop, balloons and the ground are all
// checked here; the step returns what happened as bit flags, so the caller can react
// (sounds, announcements) without the model knowing about screens or sound.
import { KNOT_TO_MS, M_TO_FT, PLANE, POINTS, RING_RADIUS, RUNWAY, STEP } from './config.js';
import { nextRing, terrainHeight, isRiver } from './world.js';

export const EVENT_RING = 1;
export const EVENT_DROP = 2;
export const EVENT_LAND = 4;
export const EVENT_CRASH = 8;
export const EVENT_BALLOON = 16;
export const EVENT_FINISH = 32;
export const EVENT_STALL = 64;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function approach(value, target, rate, dt) {
  if (value < target) return Math.min(target, value + rate * dt);
  return Math.max(target, value - rate * dt);
}

/**
 * One fixed step. `controls` is { roll, pitch, throttle, drop } from input.js.
 * While `onGround` the plane rolls down the runway until it is fast enough to fly.
 */
export function stepFlight(state, controls, dt) {
  let events = 0;
  state.elapsed += dt;
  if (state.finished || state.crashed) return events;

  // Wind gusts shove the nose around on the storm sortie; they come and go.
  state.gustTimer -= dt;
  if (state.gustTimer <= 0) {
    state.gust = (Math.random() * 2 - 1) * state.mission.wind * 0.06;
    state.gustTimer = 0.7 + Math.random() * 1.1;
  }

  // Throttle, then the speed it pulls the plane toward.
  state.throttle = clamp(state.throttle + controls.throttle * PLANE.throttleRate * dt, 0, 1);
  const targetSpeed = state.throttle * PLANE.maxSpeedKts;
  const speedRate = state.onGround ? 26 : 3.5;
  state.speedKts = approach(state.speedKts, targetSpeed, speedRate, dt);
  if (state.fuel <= 0) state.speedKts = approach(state.speedKts, 0, 6, dt);

  // Roll follows the stick and turns the plane; pitch follows the stick.
  const wantedRoll = clamp(controls.roll, -1, 1) * PLANE.maxRoll;
  state.roll = approach(state.roll, wantedRoll, PLANE.rollRate, dt);
  const wantedPitch = -clamp(controls.pitch, -1, 1) * PLANE.maxPitch;
  state.pitch = approach(state.pitch, wantedPitch, PLANE.pitchRate, dt);
  state.heading += state.roll * PLANE.turnRate * (state.speedKts / PLANE.cruiseSpeedKts) * dt + state.gust * dt;
  if (state.onGround) state.heading = approach(state.heading, 0, 1.2, dt);

  const speedMs = state.speedKts * KNOT_TO_MS;
  const stalled = !state.onGround && state.speedKts < PLANE.stallSpeedKts;
  if (stalled && !state.stall) events |= EVENT_STALL;
  state.stall = stalled;

  // Climb needs speed, but the wing keeps real authority down to approach speed:
  // a stalled wing (under 52 kt) sinks, a flying wing climbs with the pitch.
  const lift = clamp((state.speedKts - 38) / 55, 0, 1.4);
  let climb = Math.sin(state.pitch) * speedMs * lift;
  if (stalled) climb = -7;
  state.verticalSpeed = climb;
  state.y += climb * dt;
  state.x += Math.sin(state.heading) * speedMs * dt;
  state.z += Math.cos(state.heading) * speedMs * dt;

  // Takeoff: fast enough and pulling up lifts off the runway.
  if (state.onGround) {
    state.y = 0;
    if (state.speedKts > 62 && state.pitch > 0.06) {
      state.onGround = false;
      state.airborne = true;
      state.peakAlt = 0;
      state.message = 'Airborne — fly the rings, then land back on runway 36';
      state.messageTimer = 5;
    }
  }

  // Fuel burns with the throttle; an empty tank means a glide, not a fall.
  if (state.speedKts > 1) {
    state.fuel = Math.max(0, state.fuel - (PLANE.fuelBurnPerSecond + PLANE.fuelBurnThrottle * state.throttle) * dt);
    if (state.fuel === 0 && state.throttle > 0) {
      state.throttle = 0;
      state.message = 'Fuel empty — glide her in!';
      state.messageTimer = 4;
    }
  }

  // Rings: crossing the ring's plane inside its circle scores, streaks pay extra.
  const ring = nextRing(state);
  if (ring && !state.onGround) {
    const prevZ = state.z - Math.cos(state.heading) * speedMs * dt;
    const crossed = (prevZ - ring.z) * (state.z - ring.z) <= 0 && Math.abs(state.z - ring.z) < 60;
    if (crossed) {
      const dx = state.x - ring.x;
      const dy = state.y - ring.alt;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < RING_RADIUS) {
        ring.passed = true;
        state.ringIndex += 1;
        state.streak += 1;
        state.score += POINTS.ring + POINTS.ringStreak * Math.min(state.streak - 1, 4);
        state.ringFlash = 1;
        state.message = state.ringIndex >= state.rings.length
          ? 'All rings flown — bring her home to runway 36'
          : `Ring ${state.ringIndex} of ${state.rings.length} — nice flying!`;
        state.messageTimer = 3;
        events |= EVENT_RING;
      }
    }
  }
  if (state.ringFlash > 0) state.ringFlash = Math.max(0, state.ringFlash - dt * 1.4);
  if (state.messageTimer > 0) state.messageTimer -= dt;

  // Supply drop: Space over the riverside cabin, low and slow, drops the crate.
  if (controls.drop && state.dropArmed && !state.dropDone && state.mission.drop) {
    const drop = state.mission.drop;
    const dx = state.x - drop.x;
    const dz = state.z - drop.z;
    if (Math.sqrt(dx * dx + dz * dz) < 170 && state.y < 160 && !state.onGround) {
      state.dropDone = true;
      state.score += POINTS.drop;
      state.message = 'Supplies away — the cabin has what it needs (+500)';
      state.messageTimer = 4;
      events |= EVENT_DROP;
    } else {
      state.message = 'Too far or too high for the drop — get closer and lower';
      state.messageTimer = 2.5;
    }
  }

  // Balloons: a bump costs damage and pops the balloon; three bumps end the flight.
  for (let index = 0; index < state.balloons.length; index += 1) {
    const balloon = state.balloons[index];
    if (balloon.popped || state.onGround) continue;
    const dx = state.x - balloon.x;
    const dy = state.y - balloon.alt;
    const dz = state.z - balloon.z;
    if (dx * dx + dy * dy + dz * dz < 30 * 30) {
      balloon.popped = true;
      state.damage += PLANE.damageBalloon;
      state.message = 'Balloon strike! The Kestrel is hurt — fly gentle';
      state.messageTimer = 3;
      events |= EVENT_BALLOON;
      if (state.damage >= 100) {
        state.crashed = true;
        events |= EVENT_CRASH;
        return events;
      }
    }
  }

  // The ground: a gentle touchdown on the runway is a landing, anywhere else is a crash.
  // The check only bites once the plane has truly left the ground (5 m above it) or is
  // sinking into it — the liftoff itself, still climbing just above the runway, is not
  // a landing a heartbeat after takeoff.
  const ground = terrainHeight(state.x, state.z);
  if (!state.onGround) state.peakAlt = Math.max(state.peakAlt, state.y - ground);
  if (state.y <= ground + 0.5 && !state.onGround && (state.peakAlt > 5 || state.verticalSpeed < -0.5)) {
    const onRunway = Math.abs(state.x) < RUNWAY.halfWidth && state.z >= RUNWAY.startZ && state.z <= RUNWAY.endZ;
    const aligned = Math.abs(state.heading) < 0.5 || Math.abs(state.heading - Math.PI * 2) < 0.5;
    // The runway forgives a lot: any touchdown on it, wings near level and lined up
    // at a sane speed, is a landing — a fast or steeply sinking one is just a hard one.
    // Anywhere else, or far too fast, or badly banked, is a crash.
    if (onRunway && aligned && state.speedKts < PLANE.gearSpeedKts + 25 && Math.abs(state.roll) < 0.35) {
      state.onGround = true;
      state.landed = true;
      state.y = 0;
      const smooth = state.verticalSpeed > -1.8 && state.speedKts < 80;
      const hard = state.verticalSpeed <= -3.5;
      state.landingQuality = smooth ? 'a greaser' : hard ? 'a hard drop-in' : 'a firm one';
      if (hard) state.damage = Math.min(99, state.damage + 15);
      state.score += POINTS.landing + (smooth ? POINTS.smoothLanding : 0);
      state.message = `Down safe — ${state.landingQuality}!`;
      state.messageTimer = 4;
      events |= EVENT_LAND;
      if (state.ringIndex >= state.rings.length && (!state.dropArmed || state.dropDone)) {
        state.finished = true;
        state.finalScore = state.score + Math.max(0, Math.round((420 - state.elapsed) * POINTS.timeBonusPerSecond));
        state.score = state.finalScore;
        events |= EVENT_FINISH;
      }
    } else {
      state.crashed = true;
      state.y = ground;
      events |= EVENT_CRASH;
      if (isRiver(state.x, state.z)) state.message = 'Ditched in the river!';
      else if (state.stall) state.message = 'Stalled into the hillside!';
      else state.message = 'Crashed into the terrain!';
      return events;
    }
  }

  // Rolling out after landing: bleed speed, then stop on the runway.
  if (state.onGround && state.landed) {
    state.speedKts = approach(state.speedKts, 0, 22, dt);
    state.pitch = approach(state.pitch, 0, 1, dt);
    state.roll = approach(state.roll, 0, 2, dt);
  }
  return events;
}

/** Readouts for the HUD, in the units a pilot reads. */
export function hudReadout(state) {
  const headingDeg = ((state.heading * 180 / Math.PI) % 360 + 360) % 360;
  return {
    altitudeFt: Math.round(state.y * M_TO_FT),
    speedKts: Math.round(state.speedKts),
    headingDeg: Math.round(headingDeg),
    verticalSpeedFpm: Math.round(state.verticalSpeed * M_TO_FT * 60),
  };
}

export { STEP };
