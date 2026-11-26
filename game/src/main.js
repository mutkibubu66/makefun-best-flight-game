// Boot and the one loop: input is read every frame, the flight advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer paints
// what is there. The game moves between five screens: title, play, paused, crashed
// and landed. On the title screen an autopilot flies the valley behind the menu.
//
// ?seed=N fixes the valley. ?shot=cover|rings|landing|menu (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady.
import { MISSIONS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createFlight, nextRing, resetFlight } from './world.js';
import { EVENT_BALLOON, EVENT_CRASH, EVENT_DROP, EVENT_FINISH, EVENT_LAND, EVENT_RING, EVENT_STALL, stepFlight } from './physics.js';
import { ACTION_CONFIRM, ACTION_DROP, ACTION_MISSION_1, ACTION_MISSION_2, ACTION_MISSION_3, ACTION_PAUSE, createInput } from './input.js';
import { createSoundEngine } from './audio.js';
import { createRenderer, SCREEN_CRASHED, SCREEN_LANDED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const flight = createFlight(MISSIONS[0], seed);
flight.selectedMission = 0;
flight.best = 0;
const renderer = createRenderer(canvas);
const sound = createSoundEngine();

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/** The title screen's demo pilot: bank toward the next ring, pitch to its altitude. */
function demoControls() {
  const ring = nextRing(flight);
  if (!ring) return { roll: 0, pitch: 0, throttle: 0, drop: false };
  const dx = ring.x - flight.x;
  const dz = ring.z - flight.z;
  const wantedHeading = Math.atan2(dx, dz);
  let error = wantedHeading - flight.heading;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;
  return {
    roll: clamp(error * 1.6, -1, 1),
    pitch: ring.alt - flight.y > 12 ? -1 : ring.alt - flight.y < -12 ? 0.6 : 0,
    throttle: flight.throttle < 0.7 ? 1 : 0,
    drop: false,
  };
}

function runShot(name) {
  const scene = stageShot(name, flight);
  let painted = 0;
  function paint() {
    renderer.draw(flight, scene.screen, scene.best, performance.now() / 1000);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = 0;
  let accumulator = 0;
  let last = performance.now();
  let muted = false;
  let dropQueued = false;

  function announce(message) {
    status.textContent = message;
  }

  function startSortie() {
    flight.mission = MISSIONS[flight.selectedMission];
    resetFlight(flight);
    flight.best = best;
    accumulator = 0;
    screen = SCREEN_PLAY;
    sound.ensureStarted();
    announce(`Flying ${flight.mission.name}. Throttle up to take off.`);
  }

  function endFlight(landed) {
    screen = landed ? SCREEN_LANDED : SCREEN_CRASHED;
    if (flight.score > best) best = flight.score;
    flight.best = best;
    announce(landed ? `Landed. Score ${flight.score}.` : `Crashed. Score ${flight.score}.`);
  }

  /** A click on a mission card on the title screen picks that sortie. */
  canvas.addEventListener('click', (event) => {
    if (screen !== SCREEN_TITLE) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 1280;
    const y = (event.clientY - rect.top) / rect.height * 720;
    const cardW = 300;
    const firstX = 640 - (cardW * 3 + 40) / 2;
    if (y >= 168 && y <= 318) {
      for (let index = 0; index < 3; index += 1) {
        if (x >= firstX + index * (cardW + 20) && x <= firstX + index * (cardW + 20) + cardW) {
          flight.selectedMission = index;
          sound.ensureStarted();
          break;
        }
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat) {
      muted = sound.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
  });

  function handleActions() {
    const actions = input.takeActions();
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_MISSION_1) flight.selectedMission = 0;
      if (actions & ACTION_MISSION_2) flight.selectedMission = 1;
      if (actions & ACTION_MISSION_3) flight.selectedMission = 2;
      if (actions & ACTION_CONFIRM) startSortie();
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
      if (actions & ACTION_DROP) dropQueued = true;
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Flying.');
      }
    } else if (actions & ACTION_CONFIRM) {
      screen = SCREEN_TITLE;
      flight.mission = MISSIONS[flight.selectedMission];
      resetFlight(flight);
      flight.best = best;
      announce('Skyline Ridge. Pick a sortie.');
    }
  }

  function reactTo(events) {
    if (events & EVENT_RING) sound.ringChime();
    if (events & EVENT_DROP) sound.dropThump();
    if (events & EVENT_LAND) sound.landingFanfare();
    if (events & EVENT_FINISH) sound.missionComplete();
    if (events & EVENT_CRASH) {
      sound.crash();
      endFlight(false);
    } else if (events & EVENT_LAND) {
      endFlight(true);
    }
    if (events & EVENT_BALLOON) sound.balloonPop();
    if (events & EVENT_STALL) sound.stallWarning();
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      const events = stepFlight(flight, demoControls(), STEP);
      if (flight.crashed || flight.landed) {
        flight.mission = MISSIONS[flight.selectedMission];
        resetFlight(flight);
        flight.best = best;
      }
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const controls = {
      roll: input.roll(),
      pitch: input.pitch(),
      throttle: input.throttle(),
      drop: dropQueued,
    };
    dropQueued = false;
    const events = stepFlight(flight, controls, STEP);
    sound.update(flight.throttle, flight.speedKts, !flight.onGround || flight.speedKts > 5);
    reactTo(events);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(flight, screen, best, now / 1000);
  }

  // Leaving the tab pauses a running sortie rather than letting it fly unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Skyline Ridge. Pick a sortie and press Enter to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
