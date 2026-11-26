// Drawing only: the flight state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred. The chase view is a real
// perspective projection: the ground is painted in depth strips from the horizon to
// the nose, the runway and the rings are projected from world coordinates, and the
// Kestrel is drawn in the foreground with its instruments lit below it.
import { FONT, MISSIONS, PLANE, POINTS, RING_RADIUS, RUNWAY, SKIES, VIEW } from './config.js';
import { FIELD_COLOURS, clouds, fieldKind, nextRing, project, riverCentreX, terrainHeight, treeAt } from './world.js';
import { hudReadout } from './physics.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CRASHED = 'crashed';
export const SCREEN_LANDED = 'landed';

const W = VIEW.width;
const H = VIEW.height;
const PANEL_Y = 598;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  let skyGradient = null;
  let skyKey = '';

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / W, height / H);
    view.x = (width - W * view.scale) / 2;
    view.y = (height - H * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, bold) {
    const key = size + (bold ? 'b' : '');
    if (!fonts.has(key)) fonts.set(key, `${bold ? '700 ' : ''}${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function roundRect(x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  /** The camera rides just above the plane and looks along its heading. */
  function cameraFor(state) {
    return {
      x: state.x, y: state.y + 5, z: state.z, heading: state.heading, pitch: 0,
      focal: VIEW.focal, cx: W / 2,
      horizonY: VIEW.horizonY + state.pitch * VIEW.focal * 0.45,
    };
  }

  function drawSky(state, camera) {
    const sky = SKIES[state.mission.sky];
    const key = state.mission.sky;
    if (key !== skyKey) {
      skyGradient = context.createLinearGradient(0, 0, 0, camera.horizonY + 40);
      skyGradient.addColorStop(0, sky.top);
      skyGradient.addColorStop(0.55, sky.mid);
      skyGradient.addColorStop(1, sky.low);
      skyKey = key;
    }
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, W, camera.horizonY + 40);
    // The sun (or moon) hangs where the sky says, dimmed by the haze near the horizon.
    const sunX = sky.sunX * W;
    const sunY = sky.sunY * H;
    const glow = context.createRadialGradient(sunX, sunY, 4, sunX, sunY, 120);
    glow.addColorStop(0, sky.sun);
    glow.addColorStop(0.25, sky.sun);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow;
    context.fillRect(sunX - 120, sunY - 120, 240, 240);
    // Far ridge silhouettes, two layers, sliding with the heading so they feel fixed.
    const ridge = (base, amp, colour, seed) => {
      context.fillStyle = colour;
      context.beginPath();
      context.moveTo(0, camera.horizonY + 2);
      for (let sx = 0; sx <= W; sx += 16) {
        const bearing = (sx / W - 0.5) * 1.9 + state.heading;
        const peak = Math.sin(bearing * 2.1 + seed) * 0.5 + Math.sin(bearing * 5.3 + seed * 2) * 0.3 + Math.sin(bearing * 11 + seed * 3) * 0.2;
        context.lineTo(sx, camera.horizonY + 2 - base - peak * amp);
      }
      context.lineTo(W, camera.horizonY + 2);
      context.closePath();
      context.fill();
    };
    ridge(26, 46, 'rgba(70,90,120,0.55)', 1.3);
    ridge(10, 30, 'rgba(52,72,96,0.7)', 4.1);
    // A haze band softens where the sky meets the ground.
    context.fillStyle = SKIES[state.mission.sky].haze;
    context.globalAlpha = 0.35;
    context.fillRect(0, camera.horizonY - 8, W, 16);
    context.globalAlpha = 1;
  }

  /** The ground, painted in depth strips from the horizon down to the nose. */
  function drawGround(state, camera) {
    const cols = 16;
    const colW = W / cols;
    const depths = [];
    for (let d = 6; d < 5200; d *= 1.16) depths.push(d);
    depths.push(5200);
    // Screen y of the ground at each column, starting at the horizon. Rows run far
    // to near, so each nearer strip paints over the one behind it, down to the nose.
    let prevY = new Array(cols + 1).fill(camera.horizonY);
    for (let row = depths.length - 1; row >= 0; row -= 1) {
      const d = depths[row];
      const aheadX = state.x + Math.sin(state.heading) * d;
      const aheadZ = state.z + Math.cos(state.heading) * d;
      const perpX = Math.cos(state.heading);
      const perpZ = -Math.sin(state.heading);
      const curY = new Array(cols + 1);
      for (let col = 0; col <= cols; col += 1) {
        const lateral = ((col / cols) - 0.5) * 2 * (d / VIEW.focal) * (W / 2);
        const wx = aheadX + perpX * lateral;
        const wz = aheadZ + perpZ * lateral;
        const groundY = terrainHeight(wx, wz);
        const p = project(wx, groundY, wz, camera);
        curY[col] = p ? Math.min(H, p.y) : H;
        if (row === 0) curY[col] = Math.max(curY[col], camera.horizonY);
      }
      for (let col = 0; col < cols; col += 1) {
        const lateral = ((col + 0.5) / cols - 0.5) * 2 * (d / VIEW.focal) * (W / 2);
        const wx = aheadX + perpX * lateral;
        const wz = aheadZ + perpZ * lateral;
        context.fillStyle = FIELD_COLOURS[fieldKind(wx, wz)];
        const top = Math.min(prevY[col], prevY[col + 1]);
        const bottom = Math.max(curY[col], curY[col + 1]);
        if (bottom > top) context.fillRect(col * colW, top, colW + 1, bottom - top);
      }
      prevY = curY;
    }
  }

  function drawRunway(state, camera) {
    const corners = [
      [-RUNWAY.halfWidth, 0, RUNWAY.startZ], [RUNWAY.halfWidth, 0, RUNWAY.startZ],
      [RUNWAY.halfWidth, 0, RUNWAY.endZ], [-RUNWAY.halfWidth, 0, RUNWAY.endZ],
    ].map((c) => project(c[0], c[1], c[2], camera));
    if (corners.some((c) => c === null)) return;
    context.beginPath();
    context.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i += 1) context.lineTo(corners[i].x, corners[i].y);
    context.closePath();
    context.fillStyle = '#565a62';
    context.fill();
    context.strokeStyle = '#e8e4d2';
    context.lineWidth = 2;
    context.stroke();
    // Centreline dashes and the threshold bars, drawn in perspective.
    context.fillStyle = '#f2efdf';
    for (let z = RUNWAY.startZ + 60; z < RUNWAY.endZ; z += 120) {
      const a = project(0, 0.4, z, camera);
      const b = project(0, 0.4, z + 45, camera);
      if (!a || !b) continue;
      const width = Math.max(1, 3 * a.scale);
      context.fillRect(a.x - width / 2, Math.min(a.y, b.y), width, Math.abs(b.y - a.y) + 1);
    }
    // The windsock and the little hangar beside the threshold.
    const sock = project(-34, 12, 120, camera);
    if (sock && sock.forward < 2600) {
      context.strokeStyle = '#8a7a5a';
      context.lineWidth = Math.max(1, 2 * sock.scale);
      context.beginPath();
      context.moveTo(sock.x, sock.y);
      context.lineTo(sock.x, sock.y - 12 * sock.scale);
      context.stroke();
      context.fillStyle = '#e86a3c';
      context.beginPath();
      context.moveTo(sock.x, sock.y - 12 * sock.scale);
      context.lineTo(sock.x + 14 * sock.scale, sock.y - 10 * sock.scale);
      context.lineTo(sock.x, sock.y - 6 * sock.scale);
      context.closePath();
      context.fill();
    }
    const hangar = project(44, 0, 90, camera);
    if (hangar && hangar.forward < 2600) {
      const w = 46 * hangar.scale;
      const h = 18 * hangar.scale;
      context.fillStyle = '#7a6a58';
      context.fillRect(hangar.x - w / 2, hangar.y - h, w, h);
      context.fillStyle = '#4a4038';
      context.beginPath();
      context.moveTo(hangar.x - w / 2, hangar.y - h);
      context.lineTo(hangar.x, hangar.y - h * 1.7);
      context.lineTo(hangar.x + w / 2, hangar.y - h);
      context.closePath();
      context.fill();
      text('RIDGEFIELD', hangar.x, hangar.y - h * 1.7 - 6 * hangar.scale, Math.max(8, 11 * hangar.scale), '#f2efdf', 'center', true);
    }
  }

  function drawClouds(state, camera) {
    for (const cloud of clouds()) {
      const p = project(cloud.x, cloud.alt, cloud.z, camera);
      if (!p || p.forward > 6000) continue;
      const alpha = clamp(1.4 - p.forward / 4200, 0.08, 0.85);
      const size = cloud.size * p.scale;
      if (size < 4) continue;
      context.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(2) + ')';
      context.beginPath();
      context.ellipse(p.x, p.y, size, size * 0.36, 0, 0, Math.PI * 2);
      context.ellipse(p.x - size * 0.55, p.y + size * 0.08, size * 0.6, size * 0.26, 0, 0, Math.PI * 2);
      context.ellipse(p.x + size * 0.55, p.y + size * 0.06, size * 0.65, size * 0.28, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawTrees(state, camera) {
    const range = 900;
    const cell = 130;
    const aheadX = state.x + Math.sin(state.heading) * range * 0.5;
    const aheadZ = state.z + Math.cos(state.heading) * range * 0.5;
    const minCellX = Math.floor((aheadX - range) / cell);
    const maxCellX = Math.floor((aheadX + range) / cell);
    const minCellZ = Math.floor((aheadZ - range) / cell);
    const maxCellZ = Math.floor((aheadZ + range) / cell);
    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
        const tree = treeAt(cx, cz);
        if (!tree) continue;
        if (Math.abs(tree.x) < RUNWAY.halfWidth + 8 && tree.z >= RUNWAY.startZ && tree.z <= RUNWAY.endZ) continue;
        const groundY = terrainHeight(tree.x, tree.z);
        const p = project(tree.x, groundY, tree.z, camera);
        if (!p || p.forward > 1000 || p.x < -40 || p.x > W + 40) continue;
        const size = tree.size * p.scale * 1.6;
        if (size < 2) continue;
        context.fillStyle = '#2e4d24';
        context.beginPath();
        context.moveTo(p.x, p.y - size);
        context.lineTo(p.x - size * 0.55, p.y);
        context.lineTo(p.x + size * 0.55, p.y);
        context.closePath();
        context.fill();
      }
    }
  }

  function drawBalloons(state, camera) {
    for (const balloon of state.balloons) {
      if (balloon.popped) continue;
      const p = project(balloon.x, balloon.alt, balloon.z, camera);
      if (!p || p.forward > 3200) continue;
      const r = 13 * p.scale;
      if (r < 3) continue;
      context.fillStyle = balloon.colour;
      context.beginPath();
      context.ellipse(p.x, p.y, r, r * 1.2, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255,255,255,0.35)';
      context.beginPath();
      context.ellipse(p.x - r * 0.3, p.y - r * 0.4, r * 0.35, r * 0.5, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#5a4632';
      context.lineWidth = Math.max(1, r * 0.08);
      context.beginPath();
      context.moveTo(p.x - r * 0.6, p.y + r * 0.9);
      context.lineTo(p.x, p.y + r * 1.7);
      context.lineTo(p.x + r * 0.6, p.y + r * 0.9);
      context.stroke();
      context.fillStyle = '#8a6a42';
      context.fillRect(p.x - r * 0.28, p.y + r * 1.6, r * 0.56, r * 0.5);
    }
  }

  function drawDropZone(state, camera) {
    if (!state.dropArmed || state.dropDone || !state.mission.drop) return;
    const drop = state.mission.drop;
    const groundY = terrainHeight(drop.x, drop.z);
    const p = project(drop.x, groundY, drop.z, camera);
    if (!p || p.forward > 3000) return;
    const s = p.scale;
    // The riverside cabin.
    context.fillStyle = '#6a4a30';
    context.fillRect(p.x - 9 * s, p.y - 7 * s, 18 * s, 7 * s);
    context.fillStyle = '#a83c2a';
    context.beginPath();
    context.moveTo(p.x - 10 * s, p.y - 7 * s);
    context.lineTo(p.x, p.y - 13 * s);
    context.lineTo(p.x + 10 * s, p.y - 7 * s);
    context.closePath();
    context.fill();
    // Orange smoke marks the drop spot; a pulsing ring shows where the crate must land.
    const pulse = 0.6 + 0.4 * Math.sin(state.elapsed * 4);
    context.strokeStyle = 'rgba(255,140,40,' + (0.5 + 0.4 * pulse).toFixed(2) + ')';
    context.lineWidth = Math.max(2, 3 * s);
    context.beginPath();
    context.ellipse(p.x, p.y, 26 * s, 8 * s, 0, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = 'rgba(255,140,40,0.5)';
    context.lineWidth = Math.max(1, 2 * s);
    context.beginPath();
    context.moveTo(p.x, p.y - 60 * s);
    context.lineTo(p.x, p.y - 12 * s);
    context.stroke();
    if (p.forward < 1200) text('DROP ZONE — press SPACE low over the cabin', p.x, p.y - 66 * s, Math.max(11, 13 * s), '#ffb347', 'center', true);
  }

  function drawRings(state, camera) {
    const ringList = state.rings.slice().sort((a, b) => {
      const pa = project(a.x, a.alt, a.z, camera);
      const pb = project(b.x, b.alt, b.z, camera);
      return (pb ? pb.forward : -1) - (pa ? pa.forward : -1);
    });
    for (const ring of ringList) {
      if (ring.passed) continue;
      const p = project(ring.x, ring.alt, ring.z, camera);
      if (!p || p.forward > 4200) continue;
      const radius = RING_RADIUS * p.scale;
      if (radius < 3) continue;
      const isNext = ring === nextRing(state);
      const pulse = isNext ? 0.75 + 0.25 * Math.sin(state.elapsed * 5) : 0.55;
      context.save();
      context.globalAlpha = clamp(1.15 - p.forward / 3800, 0.25, 1) * pulse;
      context.strokeStyle = isNext ? '#ffd94a' : '#ff9d2e';
      context.lineWidth = Math.max(2, radius * 0.16);
      context.beginPath();
      context.ellipse(p.x, p.y, radius, radius * 0.92, 0, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = 'rgba(255,255,255,0.85)';
      context.lineWidth = Math.max(1, radius * 0.05);
      context.beginPath();
      context.ellipse(p.x, p.y, radius * 0.82, radius * 0.75, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      if (isNext && p.forward < 2400 && !state.onGround) {
        text(Math.round(p.forward) + ' m', p.x, p.y - radius - 10, Math.max(12, 15 * p.scale + 4), '#ffd94a', 'center', true);
      }
    }
  }

  /** The Kestrel herself, drawn big in the foreground, banking with the roll. */
  function drawPlane(state, time) {
    const cx = W / 2;
    const cy = 452 + state.pitch * 26;
    const scale = state.onGround ? 1.04 : 1;
    const propAngle = time * (18 + state.throttle * 30);
    context.save();
    context.translate(cx, cy);
    context.rotate(state.roll * 0.55);
    context.scale(scale, scale);
    // The shadow on the ground when she is low.
    if (state.y < 120 && !state.onGround) {
      const groundY = terrainHeight(state.x, state.z);
      const shadow = project(state.x, groundY + 1, state.z, { ...cameraFor(state), y: state.y + 5 });
      if (shadow) {
        context.restore();
        context.save();
        context.fillStyle = 'rgba(20,30,20,' + clamp(0.4 - state.y / 300, 0.08, 0.4).toFixed(2) + ')';
        context.beginPath();
        context.ellipse(shadow.x, shadow.y, 60 * shadow.scale + 20, 12 * shadow.scale + 5, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
        context.save();
        context.translate(cx, cy);
        context.rotate(state.roll * 0.55);
        context.scale(scale, scale);
      }
    }
    // Tail fin and tailplane.
    context.fillStyle = '#b8322a';
    context.beginPath();
    context.moveTo(-14, -6);
    context.lineTo(-58, -52);
    context.lineTo(-40, -58);
    context.lineTo(2, -14);
    context.closePath();
    context.fill();
    context.fillStyle = '#8e2a22';
    context.beginPath();
    context.moveTo(-52, 6);
    context.lineTo(-96, -14);
    context.lineTo(-92, -2);
    context.lineTo(-48, 16);
    context.closePath();
    context.fill();
    // Main wing, sweeping back from the fuselage.
    context.fillStyle = '#e8e2d2';
    context.beginPath();
    context.moveTo(-30, 2);
    context.lineTo(-190, 34);
    context.lineTo(-178, 52);
    context.lineTo(-20, 22);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(30, 2);
    context.lineTo(190, 34);
    context.lineTo(178, 52);
    context.lineTo(20, 22);
    context.closePath();
    context.fill();
    context.fillStyle = '#b8322a';
    context.fillRect(-190, 34, 22, 6);
    context.fillRect(168, 34, 22, 6);
    // Fuselage: cream body, red cheatline, blue windows, nose and spinner.
    context.fillStyle = '#f2ecdc';
    context.beginPath();
    context.moveTo(-78, 10);
    context.quadraticCurveTo(-70, -16, -20, -20);
    context.lineTo(58, -20);
    context.quadraticCurveTo(96, -14, 104, 2);
    context.quadraticCurveTo(96, 16, 58, 18);
    context.lineTo(-20, 18);
    context.quadraticCurveTo(-70, 16, -78, 10);
    context.closePath();
    context.fill();
    context.fillStyle = '#b8322a';
    context.fillRect(-76, 2, 172, 5);
    context.fillStyle = '#2a6ea8';
    context.beginPath();
    context.moveTo(34, -17);
    context.lineTo(66, -15);
    context.lineTo(70, -4);
    context.lineTo(34, -6);
    context.closePath();
    context.fill();
    context.fillStyle = '#2a6ea8';
    context.fillRect(8, -14, 18, 9);
    context.fillStyle = '#22303c';
    text('SKY-7', -8, 14, 11, '#22303c', 'center', true);
    // Spinning prop: a translucent disc and two blades.
    context.save();
    context.translate(106, -1);
    context.fillStyle = 'rgba(200,200,200,0.28)';
    context.beginPath();
    context.arc(0, 0, 34, 0, Math.PI * 2);
    context.fill();
    context.rotate(propAngle);
    context.fillStyle = 'rgba(40,40,40,0.75)';
    context.fillRect(-3, -34, 6, 68);
    context.rotate(Math.PI / 2);
    context.fillRect(-3, -34, 6, 68);
    context.restore();
    context.fillStyle = '#b8322a';
    context.beginPath();
    context.arc(106, -1, 7, 0, Math.PI * 2);
    context.fill();
    // Nav lights: red port, green starboard, blinking with the clock.
    const blink = Math.floor(time * 2) % 2 === 0;
    if (blink) {
      context.fillStyle = '#ff3b30';
      context.beginPath();
      context.arc(-190, 42, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#2eff5a';
      context.beginPath();
      context.arc(190, 42, 5, 0, Math.PI * 2);
      context.fill();
    }
    // Fixed gear on the ground, tucked away in the air.
    if (state.onGround || state.speedKts < 70) {
      context.strokeStyle = '#22303c';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-20, 16);
      context.lineTo(-26, 40);
      context.moveTo(20, 16);
      context.lineTo(26, 40);
      context.stroke();
      context.fillStyle = '#22303c';
      context.beginPath();
      context.arc(-26, 44, 8, 0, Math.PI * 2);
      context.arc(26, 44, 8, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawReticle() {
    context.strokeStyle = 'rgba(255,255,255,0.85)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(W / 2, 400, 14, 0, Math.PI * 2);
    context.moveTo(W / 2 - 22, 400);
    context.lineTo(W / 2 - 8, 400);
    context.moveTo(W / 2 + 8, 400);
    context.lineTo(W / 2 + 22, 400);
    context.moveTo(W / 2, 378);
    context.lineTo(W / 2, 392);
    context.moveTo(W / 2, 408);
    context.lineTo(W / 2, 422);
    context.stroke();
  }

  function drawHudTop(state) {
    const readout = hudReadout(state);
    const sky = SKIES[state.mission.sky];
    // Flight data, top left: altitude, speed and heading, big and lit.
    // Two rows: ALT + SPD on the first, HDG + V/S on the second.
    context.fillStyle = 'rgba(12,16,22,0.72)';
    roundRect(16, 14, 268, 112, 10);
    context.fill();
    context.strokeStyle = sky.panelLit;
    context.lineWidth = 1.5;
    context.stroke();
    text('ALT', 30, 38, 13, sky.panelLit, 'left', true);
    text(readout.altitudeFt.toLocaleString('en-US') + ' FT', 30, 64, 24, '#ffffff', 'left', true);
    text('SPD', 152, 38, 13, sky.panelLit, 'left', true);
    text(readout.speedKts + ' KT', 152, 64, 24, '#ffffff', 'left', true);
    text('HDG', 30, 92, 13, sky.panelLit, 'left', true);
    text(String(readout.headingDeg).padStart(3, '0') + '°', 30, 116, 22, '#ffffff', 'left', true);
    text('V/S', 152, 92, 13, sky.panelLit, 'left', true);
    text((readout.verticalSpeedFpm >= 0 ? '+' : '') + readout.verticalSpeedFpm + ' FPM', 152, 116, 18, '#cfe8f7', 'left', true);
    // Next ring, top centre, with a bearing arrow.
    const ring = nextRing(state);
    context.fillStyle = 'rgba(12,16,22,0.72)';
    roundRect(W / 2 - 150, 14, 300, 52, 10);
    context.fill();
    if (ring) {
      const dx = ring.x - state.x;
      const dz = ring.z - state.z;
      const dist = Math.round(Math.sqrt(dx * dx + dz * dz));
      const bearing = Math.atan2(dx, dz);
      let rel = bearing - state.heading;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const arrow = rel > 0.35 ? '▶▶' : rel < -0.35 ? '◀◀' : rel > 0.12 ? '▶' : rel < -0.12 ? '◀' : '▲';
      text('RING ' + (state.ringIndex + 1) + ' / ' + state.rings.length + '   ' + dist + ' m   ' + arrow, W / 2, 48, 22, '#ffd94a', 'center', true);
    } else if (state.landed) {
      text('ON THE GROUND — WELL FLOWN', W / 2, 48, 20, '#7dff8a', 'center', true);
    } else {
      text('ALL RINGS FLOWN — LAND ON RUNWAY 36', W / 2, 48, 20, '#7dff8a', 'center', true);
    }
    // Score, fuel and damage, top right.
    context.fillStyle = 'rgba(12,16,22,0.72)';
    roundRect(W - 284, 14, 268, 92, 10);
    context.fill();
    text('SCORE', W - 270, 40, 13, sky.panelLit, 'left', true);
    text(String(state.score), W - 270, 66, 26, '#ffffff', 'left', true);
    text(state.mission.name, W - 30, 40, 13, '#cfe8f7', 'right', true);
    // Fuel bar.
    context.fillStyle = '#2a2f38';
    context.fillRect(W - 270, 74, 130, 10);
    context.fillStyle = state.fuel < 20 ? '#ff5a4a' : '#ffb347';
    context.fillRect(W - 270, 74, 130 * (state.fuel / 100), 10);
    text('FUEL ' + Math.round(state.fuel) + '%', W - 270, 100, 13, state.fuel < 20 ? '#ff8a7a' : '#cfe8f7', 'left', true);
    // Damage bar.
    context.fillStyle = '#2a2f38';
    context.fillRect(W - 132, 74, 102, 10);
    context.fillStyle = state.damage > 60 ? '#ff5a4a' : '#7dff8a';
    context.fillRect(W - 132, 74, 102 * (1 - state.damage / 100), 10);
    text('HULL', W - 132, 100, 13, '#cfe8f7', 'left', true);
    // The pilot's message, under the ring bar.
    if (state.messageTimer > 0 && state.message) {
      context.fillStyle = 'rgba(12,16,22,0.66)';
      const width = context.measureText(state.message).width + 28;
      roundRect(W / 2 - width / 2 - 160, 76, width + 320, 34, 8);
      context.fill();
      text(state.message, W / 2, 100, 18, '#ffffff', 'center', true);
    }
    // Stall warning, flashing.
    if (state.stall && Math.floor(state.elapsed * 4) % 2 === 0) {
      text('⚠ STALL — NOSE DOWN, FULL THROTTLE', W / 2, 150, 24, '#ff5a4a', 'center', true);
    }
  }

  /** The lit instrument panel along the bottom: horizon, dials, compass, throttle. */
  function drawInstruments(state) {
    const sky = SKIES[state.mission.sky];
    context.fillStyle = sky.panel;
    context.fillRect(0, PANEL_Y, W, H - PANEL_Y);
    context.fillStyle = sky.panelLit;
    context.fillRect(0, PANEL_Y, W, 2);
    const cy = PANEL_Y + 61;

    // Artificial horizon: sky and ground split, rolling with the bank, sliding with pitch.
    const hx = 120;
    context.save();
    context.beginPath();
    context.arc(hx, cy, 46, 0, Math.PI * 2);
    context.clip();
    context.translate(hx, cy);
    context.rotate(-state.roll);
    context.translate(0, state.pitch * 120);
    context.fillStyle = '#4a90d8';
    context.fillRect(-50, -50, 100, 50);
    context.fillStyle = '#8a5a30';
    context.fillRect(-50, 0, 100, 50);
    context.fillStyle = '#ffffff';
    context.fillRect(-50, -2, 100, 3);
    context.restore();
    context.strokeStyle = sky.panelLit;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(hx, cy, 46, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#ffd94a';
    context.beginPath();
    context.moveTo(hx - 18, cy);
    context.lineTo(hx, cy - 5);
    context.lineTo(hx + 18, cy);
    context.lineTo(hx + 8, cy + 2);
    context.lineTo(hx - 8, cy + 2);
    context.closePath();
    context.fill();
    text('ATTITUDE', hx, PANEL_Y + 116, 11, '#9aa5b1', 'center', true);

    // Altimeter dial: needle sweeps with altitude.
    const altDial = (x, label) => {
      context.save();
      context.beginPath();
      context.arc(x, cy, 40, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = '#141a20';
      context.fillRect(x - 40, cy - 40, 80, 80);
      context.restore();
      context.strokeStyle = '#5a6a7a';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, cy, 40, 0, Math.PI * 2);
      context.stroke();
      const alt = hudReadout(state).altitudeFt;
      const angle = -Math.PI / 2 + (alt % 1000) / 1000 * Math.PI * 2;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, cy);
      context.lineTo(x + Math.cos(angle) * 32, cy + Math.sin(angle) * 32);
      context.stroke();
      context.fillStyle = sky.panelLit;
      context.beginPath();
      context.arc(x, cy, 4, 0, Math.PI * 2);
      context.fill();
      text(label, x, PANEL_Y + 116, 11, '#9aa5b1', 'center', true);
      text(String(alt), x, cy + 26, 11, '#ffffff', 'center', true);
    };
    altDial(250, 'ALT FT');

    // Airspeed dial: needle sweeps with knots.
    const spdX = 370;
    context.save();
    context.beginPath();
    context.arc(spdX, cy, 40, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = '#141a20';
    context.fillRect(spdX - 40, cy - 40, 80, 80);
    context.restore();
    context.strokeStyle = '#5a6a7a';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(spdX, cy, 40, 0, Math.PI * 2);
    context.stroke();
    const spdAngle = -Math.PI * 0.75 + clamp(state.speedKts / PLANE.maxSpeedKts, 0, 1) * Math.PI * 1.5;
    context.strokeStyle = state.stall ? '#ff5a4a' : '#ffffff';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(spdX, cy);
    context.lineTo(spdX + Math.cos(spdAngle) * 32, cy + Math.sin(spdAngle) * 32);
    context.stroke();
    context.fillStyle = sky.panelLit;
    context.beginPath();
    context.arc(spdX, cy, 4, 0, Math.PI * 2);
    context.fill();
    text('AIRSPEED', spdX, PANEL_Y + 116, 11, '#9aa5b1', 'center', true);
    text(Math.round(state.speedKts) + ' KT', spdX, cy + 26, 11, '#ffffff', 'center', true);

    // Compass strip: the heading tape scrolls with the nose, 2 px per degree.
    const compX = 560;
    const compW = 300;
    context.fillStyle = '#141a20';
    context.fillRect(compX, cy - 34, compW, 68);
    context.strokeStyle = '#5a6a7a';
    context.strokeRect(compX, cy - 34, compW, 68);
    const headingDeg = hudReadout(state).headingDeg;
    const firstTick = Math.floor((headingDeg - 75) / 5) * 5;
    for (let deg = firstTick; deg <= headingDeg + 75; deg += 5) {
      const shown = ((deg % 360) + 360) % 360;
      const x = compX + compW / 2 + (deg - headingDeg) * 2;
      const major = shown % 30 === 0;
      context.strokeStyle = major ? '#ffffff' : '#5a6a7a';
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x, cy - 34);
      context.lineTo(x, cy - 34 + (major ? 16 : 9));
      context.stroke();
      if (major) {
        const label = shown === 0 ? 'N' : shown === 90 ? 'E' : shown === 180 ? 'S' : shown === 270 ? 'W' : String(shown);
        text(label, x, cy - 2, 13, '#ffffff', 'center', true);
      }
    }
    context.fillStyle = '#ffd94a';
    context.beginPath();
    context.moveTo(compX + compW / 2 - 7, cy - 34);
    context.lineTo(compX + compW / 2 + 7, cy - 34);
    context.lineTo(compX + compW / 2, cy - 20);
    context.closePath();
    context.fill();
    text('COMPASS — HDG ' + String(headingDeg).padStart(3, '0') + '°', compX + compW / 2, PANEL_Y + 116, 11, '#9aa5b1', 'center', true);

    // Throttle lever, fuel gauge and warning lamps on the right.
    const thrX = 950;
    text('THROTTLE', thrX, PANEL_Y + 20, 11, '#9aa5b1', 'center', true);
    context.fillStyle = '#141a20';
    context.fillRect(thrX - 8, PANEL_Y + 28, 16, 72);
    context.fillStyle = '#ffb347';
    context.fillRect(thrX - 8, PANEL_Y + 100 - state.throttle * 72, 16, state.throttle * 72);
    context.fillStyle = '#ffffff';
    context.fillRect(thrX - 14, PANEL_Y + 96 - state.throttle * 72, 28, 6);
    text(Math.round(state.throttle * 100) + '%', thrX, PANEL_Y + 116, 11, '#ffffff', 'center', true);

    const fuelX = 1050;
    text('FUEL', fuelX, PANEL_Y + 20, 11, '#9aa5b1', 'center', true);
    context.fillStyle = '#141a20';
    context.fillRect(fuelX - 8, PANEL_Y + 28, 16, 72);
    context.fillStyle = state.fuel < 20 ? '#ff5a4a' : '#7dff8a';
    context.fillRect(fuelX - 8, PANEL_Y + 100 - state.fuel * 0.72, 16, state.fuel * 0.72);
    text(Math.round(state.fuel) + '%', fuelX, PANEL_Y + 116, 11, '#ffffff', 'center', true);

    // Warning lamps: stall, low fuel, gear.
    const lamp = (x, label, on, colour) => {
      context.fillStyle = on ? colour : '#2a2f38';
      context.beginPath();
      context.arc(x, cy - 12, 9, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#5a6a7a';
      context.lineWidth = 1;
      context.stroke();
      text(label, x, cy + 22, 10, on ? colour : '#5a6a7a', 'center', true);
    };
    lamp(1150, 'STALL', state.stall, '#ff5a4a');
    lamp(1200, 'FUEL', state.fuel < 20, '#ffb347');
    lamp(1245, 'GEAR', state.onGround || state.speedKts < 70, '#7dff8a');
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 30;
    const x = (W - width) / 2;
    const y = (H - height) / 2 - 40;
    context.fillStyle = 'rgba(10,14,20,0.88)';
    roundRect(x, y, width, height, 14);
    context.fill();
    context.strokeStyle = accent || '#ffd94a';
    context.lineWidth = 2;
    context.stroke();
    text(title, W / 2, y + 62, 42, '#ffffff', 'center', true);
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], W / 2, y + 108 + index * 30, 20, '#cfe8f7', 'center');
    }
    text(prompt, W / 2, y + height - 26, 20, accent || '#ffd94a', 'center', true);
  }

  function drawTitle(state, best) {
    // The menu sits over the live valley: the Kestrel waits on the runway.
    context.fillStyle = 'rgba(8,12,20,0.45)';
    context.fillRect(0, 0, W, 330);
    text('SKYLINE RIDGE', W / 2, 96, 64, '#ffffff', 'center', true);
    text('A bush-plane sortie over the valley — fly the rings, drop the supplies, land her home', W / 2, 132, 20, '#ffe9b0', 'center');
    const cardW = 300;
    const cardH = 150;
    const top = 168;
    MISSIONS.forEach((mission, index) => {
      const x = W / 2 - (cardW * 3 + 40) / 2 + index * (cardW + 20);
      context.fillStyle = 'rgba(12,16,22,0.82)';
      roundRect(x, top, cardW, cardH, 12);
      context.fill();
      context.strokeStyle = index === state.selectedMission ? '#ffd94a' : '#3a4a5a';
      context.lineWidth = index === state.selectedMission ? 3 : 1.5;
      context.stroke();
      text((index + 1) + ' — ' + mission.name, x + 18, top + 38, 22, '#ffffff', 'left', true);
      text(mission.tag, x + 18, top + 66, 15, '#cfe8f7', 'left');
      text(mission.rings.length + ' rings  •  fuel ' + mission.fuel + '%', x + 18, top + 94, 15, '#9aa5b1', 'left');
      text(mission.drop ? 'Supply drop included' : 'Land on runway 36 to finish', x + 18, top + 120, 15, '#ffb347', 'left');
    });
    text('Click a card or press 1, 2 or 3 — then ENTER to fly', W / 2, top + cardH + 36, 20, '#ffd94a', 'center', true);
    text('↑ ↓ pitch   ← → bank   SHIFT / CTRL throttle   SPACE drop supplies   P pause   M mute', W / 2, top + cardH + 68, 16, '#cfe8f7', 'center');
    text('Mouse steers too — hold the pointer off-centre. Best score: ' + best, W / 2, top + cardH + 96, 16, '#9aa5b1', 'center');
    text('An original game — the Kestrel, Ridgefield valley and every sound are made for this game.', W / 2, H - 24, 14, '#7a8a99', 'center');
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best, time) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#0e1420';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const camera = cameraFor(state);
    drawSky(state, camera);
    drawClouds(state, camera);
    drawGround(state, camera);
    drawRunway(state, camera);
    drawDropZone(state, camera);
    drawTrees(state, camera);
    drawBalloons(state, camera);
    drawRings(state, camera);
    if (screen === SCREEN_TITLE) {
      drawPlane(state, time);
      drawTitle(state, best);
      return;
    }
    drawPlane(state, time);
    drawReticle();
    drawHudTop(state);
    drawInstruments(state);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The valley will wait for you.'], 'Press P to keep flying', '#9fd8ff');
    } else if (screen === SCREEN_CRASHED) {
      const lines = [
        state.message || 'Crashed into the terrain!',
        'Rings flown: ' + state.ringIndex + ' of ' + state.rings.length + '   •   Score: ' + state.score,
        'Best: ' + best,
      ];
      drawPanel('CRASHED', lines, 'Press ENTER to fly again', '#ff5a4a');
    } else if (screen === SCREEN_LANDED) {
      const lines = [
        state.finished
          ? 'Sortie complete — every ring flown and a safe landing!'
          : 'Down safe on runway 36 — but the sortie is unfinished.',
        'Rings flown: ' + state.ringIndex + ' of ' + state.rings.length + '   •   Score: ' + state.score,
        'Best: ' + best,
      ];
      drawPanel(state.finished ? 'SORTIE COMPLETE' : 'LANDED', lines, 'Press ENTER to fly again', '#7dff8a');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
