// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. The player shoots with a hitscan ray; the bots shoot with
// the same ray through one shared raycaster; a flashbang is a ballistic pop
// that blinds whatever faces it. ?shot=start|play|site|end with &seed=N sets
// up a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, PHASE } from './state.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const map = createMap(scene);
const shootables = map.shootables;
const audio = createAudio();
const hud = createHud();
const player = createPlayer(map.colliders);
const weapons = createWeapons(camera, scene);
const bots = createBots(scene, map, shootables);
const rounds = createRounds(state, map, player, weapons, bots);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// The bomb on the ground: a dark case with a blinking amber light.
const bombMesh = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1f24'), roughness: 0.5, metalness: 0.5 }),
);
const bombLight = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.04, 0.06),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2 }),
);
bombLight.position.set(0, 0.12, 0);
bombMesh.add(bombCase, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const vanguardBots = [];
const duskBots = [];
bots.createAll(1);
for (const bot of bots.bots) {
  (bot.team === 'vanguard' ? vanguardBots : duskBots).push(bot);
}
// The player, as a target the bots can sense: alive is read live.
const playerTarget = {
  body: player.state.body,
  name: 'You',
  team: 'vanguard',
  get alive() {
    return player.state.alive;
  },
};

const cameraPosition = new THREE.Vector3();
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const toPlayer = new THREE.Vector3();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
let buyOpen = false;
let beepAt = 0;

const shootablesAll = shootables;

hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name);
hud.setScore(0, 0, 1);
hud.setMoney(800);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (state.phase === PHASE.MENU) {
    rounds.startMatch();
  } else if (state.phase === PHASE.MATCH_END) {
    rounds.startMatch();
  }
  input.requestLock();
});
hud.onBuy((id) => {
  if (rounds.buyItem(id)) {
    audio.buy();
    if (buyOpen) hud.showBuy(state.money, weapons.state.owned);
    refreshHud();
  } else {
    audio.denied();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (state.phase === PHASE.MENU) {
    hud.showOverlay('start');
  } else if (!player.state.alive) {
    hud.showOverlay('dead');
  } else if (state.phase !== PHASE.MATCH_END) {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  player.eyePosition(cameraPosition);
  camera.position.copy(cameraPosition);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimCameraAt(point) {
  const eye = player.eyePosition(cameraPosition);
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function reportShot(position) {
  for (const bot of bots.bots) bots.hearShot(bot, position, elapsed);
}

function shootPlayer(spread) {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return;
  }
  const def = weapons.def();
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  player.eyePosition(muzzle);
  scene.updateMatrixWorld(true);
  raycaster.set(muzzle, direction);
  const pellets = def.pellets || 1;
  let hitAny = false;
  let killedAny = false;
  for (let p = 0; p < pellets; p += 1) {
    const dir = direction.clone();
    if (pellets > 1) {
      dir.x += (random() * 2 - 1) * def.spreadStill * 2;
      dir.y += (random() * 2 - 1) * def.spreadStill * 2;
      dir.normalize();
    }
    raycaster.set(muzzle, dir);
    const hit = raycaster.intersectObjects(shootablesAll, false)[0];
    const end = hit ? hit.point : muzzle.clone().addScaledVector(dir, def.range);
    weapons.trace(muzzle, end);
    if (hit && hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const damage = def.damage * (part === 'head' ? def.headMult : 1);
      hitAny = true;
      if (bots.damage(victim, damage, part)) {
        killedAny = true;
        rounds.onKill('player', victim, part === 'head');
        audio.kill();
      } else {
        audio.hit();
      }
      hud.hitMarker(killedAny, shot ? 4000 : 90);
    }
  }
  if (hitAny && !killedAny) hud.hitMarker(false, shot ? 4000 : 90);
  weapons.pullTrigger();
  player.recoil(def.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot();
  reportShot(player.state.body.position);
  refreshHud();
}

// A bot's shot: the ray already found the nearest thing in shootables. The
// player has no mesh, so test the ray against the player's body by hand and
// let the nearer of the two decide.
function shootBot(bot, eye, hit, dir) {
  const worldDistance = hit ? hit.distance : Infinity;
  let end = hit ? hit.point : eye.clone().addScaledVector(dir, 60);
  // The player: a vertical body, radius 0.34, head a sphere at eye height.
  if (player.state.alive) {
    const px = player.state.body.position.x;
    const py = player.state.body.position.y;
    const pz = player.state.body.position.z;
    toPlayer.set(px - eye.x, 0, pz - eye.z);
    const along = toPlayer.dot(dir);
    if (along > 0 && along < worldDistance) {
      const closest = eye.clone().addScaledVector(dir, along);
      const radial = Math.hypot(closest.x - px, closest.z - pz);
      const headY = py + player.state.eye;
      const headDistance = Math.hypot(closest.x - px, closest.y - headY, closest.z - pz);
      const headHit = headDistance < 0.3 && closest.y > py + 1.2;
      if (radial < 0.36 && closest.y > py && closest.y < py + 1.72) {
        const damage = bot.damage * (headHit ? 2.5 : 1);
        const killed = player.hurt(damage);
        audio.hurt();
        hud.damageFlash();
        end = closest;
        weapons.trace(eye, end);
        if (killed) rounds.onKill(bot, 'player', headHit);
        audio.shot(true);
        return;
      }
    }
  }
  if (hit && hit.object.userData.bot) {
    const victim = hit.object.userData.bot;
    if (victim.team !== bot.team) {
      const part = hit.object.userData.part;
      const damage = bot.damage * (part === 'head' ? 2.5 : 1);
      if (bots.damage(victim, damage, part)) {
        rounds.onKill(bot, victim, part === 'head');
      }
    }
  }
  weapons.trace(eye, end);
  audio.shot(true);
}

function popFlash(position) {
  audio.flash();
  let playerStrength = 0;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const dx = position.x - bot.body.position.x;
    const dy = position.y - (bot.body.position.y + 1.5);
    const dz = position.z - bot.body.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > 18) continue;
    const toPop = new THREE.Vector3(dx / distance, dy / distance, dz / distance);
    const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (facing.dot(toPop) < 0.1) continue;
    rayOrigin.set(bot.body.position.x, bot.body.position.y + 1.5, bot.body.position.z);
    raycaster.set(rayOrigin, toPop);
    const hit = raycaster.intersectObjects(shootablesAll, false)[0];
    if (hit && hit.distance < distance - 0.5) continue;
    bot.blindUntil = elapsed + Math.max(0.8, 3 - distance * 0.12);
  }
  if (player.state.alive) {
    const eye = player.eyePosition(cameraPosition);
    const dx = position.x - eye.x;
    const dy = position.y - eye.y;
    const dz = position.z - eye.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 18) {
      camera.getWorldDirection(direction);
      const toPop = new THREE.Vector3(dx / distance, dy / distance, dz / distance);
      if (direction.dot(toPop) > 0.1) {
        raycaster.set(eye, toPop);
        const hit = raycaster.intersectObjects(shootablesAll, false)[0];
        if (!hit || hit.distance > distance - 0.5) {
          playerStrength = Math.max(0.3, 1 - distance / 22);
          state.flash = playerStrength;
        }
      }
    }
  }
  if (playerStrength > 0) hud.flashWhite(playerStrength);
}

function refreshHud() {
  hud.setHealth(Math.ceil(player.state.health));
  hud.setArmour(Math.ceil(player.state.armour));
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name);
  hud.setMoney(state.money);
  hud.setScore(state.score.vanguard, state.score.dusk, state.round);
}

function drainEvents() {
  for (const event of rounds.drainEvents()) {
    if (event.type === 'kill') {
      hud.pushKill(`${event.killer}  ✕  ${event.victim}${event.headshot ? '  (headshot)' : ''}`);
      if (event.killer === 'You') audio.kill();
      if (event.victim === 'You' && document.pointerLockElement) {
        document.exitPointerLock();
      }
    } else if (event.type === 'plant') {
      audio.plant();
      hud.showBanner('Charge planted', `Site ${event.site} — 35 seconds to detonation.`);
    } else if (event.type === 'explode') {
      audio.explosion();
      hud.flashWhite(0.6);
    } else if (event.type === 'round_end') {
      const won = event.winner === 'vanguard';
      if (won) audio.roundWin();
      else audio.roundLose();
      hud.showBanner(
        won ? 'Round won' : 'Round lost',
        `${event.reason} — Vanguard ${state.score.vanguard} : ${state.score.dusk} Dusk`,
      );
      if (buyOpen) {
        buyOpen = false;
        hud.hideBuy();
      }
    } else if (event.type === 'match_end') {
      const won = event.winner === 'vanguard';
      hud.showBanner(
        won ? 'Victory — the yard is yours' : 'Defeat — Dusk holds the yard',
        `Final: Vanguard ${state.score.vanguard} : ${state.score.dusk} Dusk`,
        8000,
      );
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (event.type === 'round_live') {
      if (buyOpen) {
        buyOpen = false;
        hud.hideBuy();
      }
    } else if (event.type === 'toggle_buy') {
      if (state.phase === PHASE.BUY) {
        buyOpen = !buyOpen;
        if (buyOpen) hud.showBuy(state.money, weapons.state.owned);
        else hud.hideBuy();
      }
    } else if (event.type === 'buy') {
      refreshHud();
    } else if (event.type === 'bomb_dropped') {
      hud.showBanner('Charge dropped', 'A teammate is moving to recover it.');
    } else if (event.type === 'bomb_picked_up') {
      hud.showBanner('Charge recovered', `${event.by} carries the charge.`);
    }
  }
}

function step(dt) {
  elapsed += dt;
  const pressed = input.takePressed();
  rounds.step(dt, elapsed, input.state.keys, pressed);
  drainEvents();

  if (state.phase === PHASE.LIVE) {
    player.step(dt, input.state.keys);
    weapons.step(dt);
    for (const bot of bots.bots) {
      const enemies = bot.team === 'dusk' ? [playerTarget, ...vanguardBots] : duskBots;
      bots.stepBot(bot, dt, elapsed, enemies, shootBot, null);
    }
    // The player's own firing: auto weapons fire while held, the rest once
    // per trigger pull.
    if (player.state.alive && (state.phase === PHASE.LIVE)) {
      const firing = input.state.firing;
      const triggerEdge = firing && !wasFiring;
      if (weapons.def().auto ? firing && weapons.ready() : triggerEdge && weapons.ready()) {
        shootPlayer(weapons.spread(player.groundSpeed(), player.state.crouching));
      }
      wasFiring = firing;
      if (pressed.has('KeyR') && weapons.reload()) audio.reload();
      if (pressed.has('Digit1')) weapons.switchTo('p9');
      if (pressed.has('Digit2')) weapons.switchTo('vk47');
      if (pressed.has('Digit3')) weapons.switchTo('longbow');
      if (pressed.has('Digit4')) weapons.switchTo('breacher');
      if (pressed.has('KeyQ')) {
        const owned = Object.keys(weapons.state.owned);
        const index = owned.indexOf(weapons.state.current);
        weapons.switchTo(owned[(index + 1) % owned.length]);
      }
      if (pressed.has('KeyG') && weapons.throwFlash(player.eyePosition(cameraPosition), direction.copy(camera.getWorldDirection(new THREE.Vector3())), popFlash)) {
        audio.buy();
      }
      if (pressed.has('Escape') && buyOpen) {
        buyOpen = false;
        hud.hideBuy();
      }
    }
    // The bomb's light blinks faster as the fuse runs down.
    if (state.bomb.status === 'planted' || state.bomb.status === 'dropped') {
      bombMesh.visible = true;
      bombMesh.position.set(state.bomb.position.x, 0.12, state.bomb.position.z);
      const rate = state.bomb.status === 'planted' ? Math.max(2, 14 - state.bomb.fuse * 0.35) : 2;
      bombLight.material.emissiveIntensity = (Math.sin(elapsed * rate) > 0 ? 2.5 : 0.2);
      if (state.bomb.status === 'planted' && elapsed > beepAt) {
        audio.beep(state.bomb.fuse < 5);
        beepAt = elapsed + Math.max(0.35, state.bomb.fuse / 18);
      }
    } else {
      bombMesh.visible = false;
    }
    if (state.flash > 0) {
      state.flash = Math.max(0, state.flash - dt * 0.5);
      hud.flashWhite(state.flash);
    }
  }
  refreshHud();
  updateHudText();
}

function updateHudText() {
  if (state.phase === PHASE.BUY) {
    hud.setTimer(`BUY ${Math.ceil(state.buyClock)}`, false);
  } else if (state.phase === PHASE.LIVE) {
    if (state.bomb.status === 'planted') {
      hud.setTimer(`BOMB ${Math.ceil(state.bomb.fuse)}`, state.bomb.fuse < 10);
    } else {
      const clock = Math.max(0, state.roundClock);
      hud.setTimer(`${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`, clock < 15);
    }
  } else if (state.phase === PHASE.ROUND_END) {
    hud.setTimer('—', false);
  }
  if (state.bomb.status === 'carried') {
    const site = rounds.siteAt(player.state.body.position.x, player.state.body.position.z);
    hud.setBomb(site ? `Hold E to plant at Site ${site}` : 'Carrying the charge — reach a site', state.bomb.plantProgress);
  } else if (state.bomb.status === 'planted') {
    hud.setBomb(`Charge planted at Site ${state.bomb.site} — defuse ${Math.round(state.bomb.defuseProgress * 100)}%`, state.bomb.defuseProgress);
  } else if (state.bomb.status === 'dropped') {
    hud.setBomb('Charge dropped — a teammate is recovering it', 0);
  } else {
    hud.setBomb('', 0);
  }
  const spreadPx = 4 + weapons.spread(player.groundSpeed(), player.state.crouching) * 900;
  hud.setCrosshairSpread(Math.min(26, spreadPx));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.state.alive || state.phase === PHASE.MENU) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  rounds.startMatch();
  if (name === 'start') {
    // Round 1, buy phase: the player at spawn, the buy menu open.
    player.state.body.position.set(0, 0, 15.5);
    player.state.yaw = Math.PI;
    player.state.pitch = 0;
    settle(20);
    buyOpen = true;
    hud.showBuy(state.money, weapons.state.owned);
    aimCameraAt(new THREE.Vector3(0, 1.4, -6));
  } else if (name === 'play') {
    // Mid lane, live: a Dusk bot in the crosshair, one hit landing.
    state.phase = PHASE.LIVE;
    state.roundClock = 78;
    player.state.body.position.set(0, 0, 6);
    const bot = duskBots[2];
    bot.body.position.set(0, 0, -3);
    bot.yaw = 0;
    bot.mode = 'hold';
    bot.holdUntil = elapsed + 100;
    bot.mesh.group.position.copy(bot.body.position);
    bot.mesh.group.rotation.y = 0;
    settle(10);
    aimCameraAt(new THREE.Vector3(0, 1.3, -3));
    shootPlayer(0);
    settle(6);
    aimCameraAt(new THREE.Vector3(0, 1.3, -3));
  } else if (name === 'site') {
    // Site A: the charge planted, the fuse running, a defender closing in.
    state.phase = PHASE.LIVE;
    state.roundClock = 0;
    state.bomb.status = 'planted';
    state.bomb.site = 'A';
    state.bomb.fuse = 24;
    state.bomb.position = { x: -17, z: -9 };
    state.bomb.carrier = null;
    player.state.body.position.set(-12, 0, -4);
    const bot = duskBots[0];
    bot.body.position.set(-14.5, 0, -7);
    bot.yaw = Math.PI * 0.75;
    bot.mode = 'hold';
    bot.holdUntil = elapsed + 100;
    bot.mesh.group.position.copy(bot.body.position);
    bot.mesh.group.rotation.y = bot.yaw;
    settle(10);
    aimCameraAt(new THREE.Vector3(-17, 1.2, -9));
  } else {
    // The round won: the banner up, the score 1:0.
    state.phase = PHASE.ROUND_END;
    state.score.vanguard = 1;
    state.roundWinner = 'vanguard';
    state.roundReason = 'Bomb detonated';
    state.bomb.status = 'gone';
    player.state.body.position.set(-10, 0, -2);
    settle(10);
    aimCameraAt(new THREE.Vector3(-17, 1.5, -9));
    hud.showBanner('Round won', 'Bomb detonated — Vanguard 1 : 0 Dusk', 60000);
  }
  refreshHud();
  updateHudText();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A small handle for automated checks: the sim's state, read-only enough to
// tell a test whether a round runs, a bot dies and a bomb plants. The test
// helpers aim and fire exactly like a player would, through the same code.
window.__game = {
  state, player, weapons, bots, rounds, map,
  test: {
    start() { rounds.startMatch(); },
    teleport(x, z) { player.state.body.position.set(x, 0, z); },
    shootAt(x, y, z) {
      aimCameraAt(new THREE.Vector3(x, y, z));
      const before = bots.bots.map((b) => b.health);
      shootPlayer(0);
      return bots.bots.map((b, i) => before[i] - b.health);
    },
    buy(id) { return rounds.buyItem(id); },
  },
};

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
