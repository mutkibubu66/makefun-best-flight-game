// Skyline Ridge — every tuning number, colour and mission in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window, so no rule below depends on the screen size.
export const VIEW = { width: 1280, height: 720, horizonY: 296, focal: 760 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Metres, knots and feet the pilot sees: 1 knot is 0.514444 m/s, 1 m is 3.28084 ft. */
export const KNOT_TO_MS = 0.514444;
export const M_TO_FT = 3.28084;

export const PLANE = {
  maxSpeedKts: 165,
  cruiseSpeedKts: 120,
  stallSpeedKts: 52,
  climbRate: 9,
  turnRate: 0.55,
  rollRate: 2.4,
  pitchRate: 0.7,
  maxPitch: 0.42,
  maxRoll: 1.1,
  throttleRate: 0.7,
  fuelBurnPerSecond: 0.11,
  fuelBurnThrottle: 0.22,
  damageBalloon: 34,
  gearSpeedKts: 95,
};

export const RUNWAY = {
  halfWidth: 15,
  startZ: 0,
  endZ: 900,
  headingDeg: 0,
  name: 'RIDGEFIELD',
};

/** The three sorties on the menu. Each is a ring course plus a landing. */
export const MISSIONS = [
  {
    id: 'ring-run',
    name: 'RING RUN',
    tag: 'Morning valley circuit',
    sky: 'morning',
    wind: 2,
    fuel: 100,
    rings: [
      { x: 0, z: 1200, alt: 120 },
      { x: 260, z: 1900, alt: 150 },
      { x: 620, z: 2600, alt: 180 },
      { x: 480, z: 3500, alt: 140 },
      { x: 60, z: 4300, alt: 170 },
      { x: -420, z: 4900, alt: 150 },
      { x: -700, z: 4100, alt: 190 },
      { x: -380, z: 3200, alt: 130 },
    ],
  },
  {
    id: 'river-rescue',
    name: 'RIVER RESCUE',
    tag: 'Sunset supply drop on the river',
    sky: 'sunset',
    wind: 4,
    fuel: 100,
    drop: { x: 340, z: 2900, alt: 90 },
    rings: [
      { x: 120, z: 1100, alt: 100 },
      { x: 330, z: 1800, alt: 110 },
      { x: 420, z: 2600, alt: 95 },
      { x: 260, z: 3300, alt: 120 },
      { x: -80, z: 3900, alt: 110 },
      { x: -460, z: 3600, alt: 140 },
      { x: -560, z: 2700, alt: 120 },
      { x: -240, z: 1900, alt: 100 },
    ],
  },
  {
    id: 'storm-dusk',
    name: 'STORM DUSK',
    tag: 'Gusty dusk run, short fuel',
    sky: 'dusk',
    wind: 9,
    fuel: 78,
    rings: [
      { x: -60, z: 1300, alt: 160 },
      { x: -320, z: 2100, alt: 200 },
      { x: -180, z: 3000, alt: 170 },
      { x: 240, z: 3700, alt: 210 },
      { x: 620, z: 3300, alt: 180 },
      { x: 540, z: 2400, alt: 150 },
      { x: 180, z: 1700, alt: 190 },
      { x: 0, z: 1100, alt: 130 },
    ],
  },
];

export const SKIES = {
  morning: {
    top: '#2f6fd0', mid: '#7db4e8', low: '#cfe8f7', sun: '#fff3c4', sunX: 0.78, sunY: 0.16,
    haze: '#dceefb', groundFar: '#7fae6a', panel: '#20262e', panelLit: '#ffd27d',
  },
  sunset: {
    top: '#3a2a6e', mid: '#c65a3c', low: '#ffb347', sun: '#ffdf8a', sunX: 0.22, sunY: 0.30,
    haze: '#f2a56b', groundFar: '#8a7a4e', panel: '#241f28', panelLit: '#ffb347',
  },
  dusk: {
    top: '#101a33', mid: '#2c3a5e', low: '#5a6a8c', sun: '#e8ecff', sunX: 0.85, sunY: 0.12,
    haze: '#3d4a6b', groundFar: '#4d5a4a', panel: '#1b2027', panelLit: '#9fd8ff',
  },
};

export const POINTS = { ring: 100, ringStreak: 25, drop: 500, landing: 400, smoothLanding: 250, timeBonusPerSecond: 2 };
export const RING_RADIUS = 26;
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'skyline-ridge.best';
