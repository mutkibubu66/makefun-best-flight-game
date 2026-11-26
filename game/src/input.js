// Keyboard and pointer input. Held keys give pitch/roll/throttle; one-shot presses
// (confirm, pause, drop, mission keys) are queued as bit flags and taken once by the
// loop, so a press between two frames is never lost and never counted twice. The mouse
// also steers: holding the pointer left or right of centre banks the plane, above or
// below centre pitches it — the same stick the keyboard drives.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_DROP = 4;
export const ACTION_MISSION_1 = 8;
export const ACTION_MISSION_2 = 16;
export const ACTION_MISSION_3 = 32;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const PITCH_UP = new Set(['ArrowUp', 'KeyW']);
const PITCH_DOWN = new Set(['ArrowDown', 'KeyS']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'KeyR']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'KeyF']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const DROP = new Set(['Space']);

export function createInput(target) {
  let left = false;
  let right = false;
  let pitchUp = false;
  let pitchDown = false;
  let throttleUp = false;
  let throttleDown = false;
  let actions = 0;
  let mouse = { active: false, x: 0, y: 0 };

  function releaseAll() {
    left = false;
    right = false;
    pitchUp = false;
    pitchDown = false;
    throttleUp = false;
    throttleDown = false;
    mouse.active = false;
  }

  window.addEventListener('keydown', (event) => {
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (PITCH_UP.has(event.code)) pitchUp = true;
    else if (PITCH_DOWN.has(event.code)) pitchDown = true;
    else if (THROTTLE_UP.has(event.code)) throttleUp = true;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (DROP.has(event.code)) {
      if (!event.repeat) actions |= ACTION_DROP;
    } else if (event.code === 'Digit1') {
      if (!event.repeat) actions |= ACTION_MISSION_1;
    } else if (event.code === 'Digit2') {
      if (!event.repeat) actions |= ACTION_MISSION_2;
    } else if (event.code === 'Digit3') {
      if (!event.repeat) actions |= ACTION_MISSION_3;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (PITCH_UP.has(event.code)) pitchUp = false;
    else if (PITCH_DOWN.has(event.code)) pitchDown = false;
    else if (THROTTLE_UP.has(event.code)) throttleUp = false;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', releaseAll);

  // Mouse steering: pointer position relative to the canvas centre, -1..1 each way.
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouse = {
      active: true,
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
    };
  });
  target.addEventListener('pointerleave', () => { mouse.active = false; });
  target.addEventListener('pointerdown', (event) => {
    const rect = target.getBoundingClientRect();
    mouse = {
      active: true,
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
    };
  });

  return {
    /** -1 for left, 1 for right, 0 for neither or both; mouse adds a gentle bank. */
    roll() {
      const keys = (right ? 1 : 0) - (left ? 1 : 0);
      if (keys !== 0) return keys;
      if (mouse.active && Math.abs(mouse.x) > 0.12) return Math.max(-1, Math.min(1, mouse.x * 1.4));
      return 0;
    },
    /** -1 for nose up, 1 for nose down; mouse adds a gentle pitch. */
    pitch() {
      const keys = (pitchDown ? 1 : 0) - (pitchUp ? 1 : 0);
      if (keys !== 0) return keys;
      if (mouse.active && Math.abs(mouse.y) > 0.12) return Math.max(-1, Math.min(1, mouse.y * 1.4));
      return 0;
    },
    /** -1, 0 or 1: throttle down, hold, up. */
    throttle() {
      return (throttleUp ? 1 : 0) - (throttleDown ? 1 : 0);
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
