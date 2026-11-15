// The nine bots: four Vanguard teammates and five Dusk defenders. One state
// machine each — route, hold, engage, investigate, defuse — driven by a
// staggered sense step (vision by raycast, hearing by the shot reports the
// sim hands in), so nine bots never raycast on the same frame. A bot's route
// is a walk through the map's waypoint graph; its hold is a node it watches;
// its engage is a burst of hitscan fire with a reaction time, a spread and a
// reload, exactly like the player's gun, only slower to aim. Defenders rush a
// planted bomb and defuse it if the player lets them stand there.
import * as THREE from 'three';
import { createBody, moveBody } from './physics.js';
import { TEAM } from './palette.js';

const BOT_SPEED = 4.2;
const BOT_ACCEL = 30;
const VISION_RANGE = 45;
const VISION_HALF_FOV = 0.96;
const HEAR_RANGE = 26;
const SENSE_PERIOD = 0.15;

const TEAMMATE_NAMES = ['Rook', 'Vex', 'Hale', 'Mira'];
const ENEMY_NAMES = ['Ash', 'Noor', 'Kite', 'Bram', 'Sable'];

const BODY_MATERIALS = {};
const HEAD_MATERIALS = {};

function teamMaterials(team) {
  if (!BODY_MATERIALS[team]) {
    BODY_MATERIALS[team] = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM[team]), roughness: 0.65, metalness: 0.25 });
    HEAD_MATERIALS[team] = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23282e'), roughness: 0.55, metalness: 0.4 });
  }
  return { body: BODY_MATERIALS[team], head: HEAD_MATERIALS[team] };
}

export function createBots(scene, map, shootables) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eye = new THREE.Vector3();
  const targetPoint = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const origin = new THREE.Vector3();

  const bots = [];

  function buildMesh(bot) {
    const { body, head } = teamMaterials(bot.team);
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 1.05, 12), body);
    torso.position.y = 0.95;
    torso.castShadow = true;
    torso.userData = { bot, part: 'body' };
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), head);
    headMesh.position.y = 1.62;
    headMesh.castShadow = true;
    headMesh.userData = { bot, part: 'head' };
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM[bot.team]), emissive: new THREE.Color(TEAM[bot.team]), emissiveIntensity: 0.7 }));
    visor.position.set(0, 1.64, 0.21);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.6, metalness: 0.4 }));
    gun.position.set(0.18, 1.15, -0.3);
    group.add(torso, headMesh, visor, gun);
    scene.add(group);
    return { group, torso, headMesh };
  }

  function makeBot(team, name, x, z) {
    const body = createBody(map.colliders, x, z, 0.34, 1.72);
    const bot = {
      team,
      name,
      body,
      yaw: team === 'vanguard' ? Math.PI : 0,
      pitch: 0,
      health: 100,
      alive: true,
      mode: 'route',
      route: [],
      routeIndex: 0,
      holdUntil: 0,
      scanYaw: 0,
      scanUntil: 0,
      target: null,
      targetLastSeen: new THREE.Vector3(),
      reactAt: 0,
      burstLeft: 0,
      shotAt: 0,
      reloadAt: 0,
      mag: 25,
      blindUntil: 0,
      investigateAt: new THREE.Vector3(),
      investigateUntil: 0,
      defusing: false,
      senseOffset: Math.random() * SENSE_PERIOD,
      damage: 22,
      mesh: null,
    };
    bot.mesh = buildMesh(bot);
    shootables.push(bot.mesh.torso, bot.mesh.headMesh);
    bots.push(bot);
    return bot;
  }

  function routeTo(bot, nodes) {
    bot.route = nodes.slice();
    bot.routeIndex = 0;
    bot.mode = 'route';
  }

  // Breadth-first walk over the waypoint graph, from the bot's nearest node.
  function findRoute(bot, goal) {
    const nodes = map.waypoints;
    let start = null;
    let best = Infinity;
    for (const [name, node] of Object.entries(nodes)) {
      const d = (node.x - bot.body.position.x) ** 2 + (node.z - bot.body.position.z) ** 2;
      if (d < best) {
        best = d;
        start = name;
      }
    }
    const prev = { [start]: null };
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of nodes[current].to) {
        if (!(next in prev)) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (!(goal in prev)) return [goal];
    const path = [];
    let node = goal;
    while (node) {
      path.unshift(node);
      node = prev[node];
    }
    return path;
  }

  function nearestNode(bot) {
    let best = null;
    let bestD = Infinity;
    for (const [name, node] of Object.entries(map.waypoints)) {
      const d = (node.x - bot.body.position.x) ** 2 + (node.z - bot.body.position.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  function canSee(bot, other) {
    eye.set(bot.body.position.x, bot.body.position.y + 1.5, bot.body.position.z);
    targetPoint.set(other.body.position.x, other.body.position.y + 1.2, other.body.position.z);
    toTarget.subVectors(targetPoint, eye);
    const distance = toTarget.length();
    if (distance > VISION_RANGE) return false;
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    toTarget.normalize();
    if (forward.dot(toTarget) < Math.cos(VISION_HALF_FOV)) return false;
    raycaster.set(eye, toTarget);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    if (!hit) return true;
    return hit.object.userData && hit.object.userData.bot === other;
  }

  function sense(bot, now, enemies, onHear) {
    if (bot.blindUntil > now) {
      bot.target = null;
      return;
    }
    for (const other of enemies) {
      if (!other.alive) continue;
      if (canSee(bot, other)) {
        bot.targetLastSeen.set(other.body.position.x, other.body.position.y, other.body.position.z);
        if (bot.target !== other) {
          bot.target = other;
          const distance = eye.distanceTo(targetPoint);
          bot.reactAt = now + 0.3 + Math.min(0.35, distance / 120) + Math.random() * 0.15;
          bot.burstLeft = 0;
        }
        return;
      }
    }
    bot.target = null;
  }

  function aimAt(bot, point, error) {
    const dx = point.x - bot.body.position.x;
    const dy = point.y - (bot.body.position.y + 1.5);
    const dz = point.z - bot.body.position.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
    let dyaw = wantYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += dyaw * 0.35 + (Math.random() - 0.5) * error;
    bot.pitch += (wantPitch - bot.pitch) * 0.35 + (Math.random() - 0.5) * error * 0.5;
  }

  function fireAt(bot, now, shoot) {
    if (now < bot.shotAt || now < bot.reloadAt) return;
    if (bot.mag <= 0) {
      bot.reloadAt = now + 2.1;
      bot.mag = 25;
      return;
    }
    bot.mag -= 1;
    bot.shotAt = now + 0.13;
    bot.burstLeft -= 1;
    eye.set(bot.body.position.x, bot.body.position.y + 1.5, bot.body.position.z);
    targetPoint.copy(bot.targetLastSeen);
    targetPoint.y = bot.body.position.y + 1.2 + (Math.random() - 0.5) * 0.4;
    toTarget.subVectors(targetPoint, eye).normalize();
    const spread = 0.014 + Math.random() * 0.012;
    toTarget.x += (Math.random() * 2 - 1) * spread;
    toTarget.y += (Math.random() * 2 - 1) * spread;
    toTarget.z += (Math.random() * 2 - 1) * spread;
    toTarget.normalize();
    raycaster.set(eye, toTarget);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    shoot(bot, eye, hit, toTarget);
  }

  function stepBot(bot, dt, now, enemies, shoot, report) {
    if (!bot.alive) return;
    if (bot.blindUntil > now) {
      bot.body.velocity.x *= 0.8;
      bot.body.velocity.z *= 0.8;
      moveBody(bot.body, dt, 20);
      bot.mesh.group.position.copy(bot.body.position);
      return;
    }
    // Sense on a stagger: one bot's vision check every SENSE_PERIOD, offset.
    if (now >= (bot.nextSense || 0)) {
      bot.nextSense = now + SENSE_PERIOD;
      sense(bot, now, enemies, report);
    }
    wish.set(0, 0, 0);
    if (bot.target) {
      if (now >= bot.reactAt) {
        aimAt(bot, bot.targetLastSeen, 0.02);
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(Math.random() * 3);
          bot.shotAt = now + 0.55 + Math.random() * 0.5;
        } else {
          fireAt(bot, now, shoot);
        }
      } else {
        aimAt(bot, bot.targetLastSeen, 0.05);
      }
    } else if (bot.mode === 'route' && bot.route.length) {
      const node = map.waypoints[bot.route[bot.routeIndex]];
      const dx = node.x - bot.body.position.x;
      const dz = node.z - bot.body.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.9) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.mode = 'hold';
          bot.holdUntil = now + 2.5 + Math.random() * 3;
          bot.scanUntil = 0;
        }
      } else {
        wish.set(dx / distance, 0, dz / distance);
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - bot.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        bot.yaw += dyaw * Math.min(1, dt * 6);
      }
    } else if (bot.mode === 'investigate') {
      const dx = bot.investigateAt.x - bot.body.position.x;
      const dz = bot.investigateAt.z - bot.body.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1.2 || now > bot.investigateUntil) {
        bot.mode = 'hold';
        bot.holdUntil = now + 2;
        bot.scanUntil = 0;
      } else {
        wish.set(dx / distance, 0, dz / distance);
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - bot.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        bot.yaw += dyaw * Math.min(1, dt * 6);
      }
    } else {
      // Hold: scan the angles, slowly, like someone watching a lane.
      if (now >= bot.scanUntil) {
        bot.scanYaw = bot.yaw + (Math.random() - 0.5) * 2.4;
        bot.scanUntil = now + 1.6 + Math.random() * 1.8;
      }
      let dyaw = bot.scanYaw - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.yaw += dyaw * Math.min(1, dt * 2);
      if (now > bot.holdUntil) {
        bot.mode = 'route';
        bot.route = [];
      }
    }
    const speed = bot.target ? BOT_SPEED * 0.4 : BOT_SPEED;
    const blend = Math.min(1, BOT_ACCEL * dt / speed);
    bot.body.velocity.x += (wish.x * speed - bot.body.velocity.x) * blend;
    bot.body.velocity.z += (wish.z * speed - bot.body.velocity.z) * blend;
    if (!wish.lengthSq()) {
      const damp = Math.max(0, 1 - 9 * dt);
      bot.body.velocity.x *= damp;
      bot.body.velocity.z *= damp;
    }
    moveBody(bot.body, dt, 20);
    bot.mesh.group.position.copy(bot.body.position);
    bot.mesh.group.rotation.y = bot.yaw;
  }

  function hearShot(bot, position, now) {
    if (!bot.alive || bot.target || bot.blindUntil > now) return;
    const dx = position.x - bot.body.position.x;
    const dz = position.z - bot.body.position.z;
    if (dx * dx + dz * dz > HEAR_RANGE * HEAR_RANGE) return;
    bot.investigateAt.set(position.x, 0, position.z);
    bot.investigateUntil = now + 6;
    bot.mode = 'investigate';
    bot.route = [];
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount * (part === 'head' ? 2.5 : 1);
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.target = null;
      bot.mesh.group.rotation.x = -Math.PI / 2;
      bot.mesh.group.position.y = 0.25;
      return true;
    }
    return false;
  }

  function reset(bot, x, z, round) {
    bot.body.position.set(x, 0, z);
    bot.body.velocity.set(0, 0, 0);
    bot.yaw = bot.team === 'vanguard' ? Math.PI : 0;
    bot.pitch = 0;
    bot.health = 100;
    bot.alive = true;
    bot.target = null;
    bot.mode = 'route';
    bot.route = [];
    bot.routeIndex = 0;
    bot.mag = 25;
    bot.blindUntil = 0;
    bot.defusing = false;
    bot.damage = round <= 1 ? 20 : round <= 3 ? 24 : 28;
    bot.mesh.group.rotation.set(0, bot.yaw, 0);
    bot.mesh.group.position.copy(bot.body.position);
  }

  // The nine bots are created once, at boot, and reset every round: their
  // meshes and their hit boxes never leave the scene.
  function createAll(round) {
    const spawns = map.spawns;
    TEAMMATE_NAMES.forEach((name, i) => {
      const [x, z] = spawns.vanguard[i];
      const bot = makeBot('vanguard', name, x, z);
      reset(bot, x, z, round);
    });
    ENEMY_NAMES.forEach((name, i) => {
      const [x, z] = spawns.dusk[i];
      const bot = makeBot('dusk', name, x, z);
      reset(bot, x, z, round);
    });
    return bots;
  }

  function resetAll(round) {
    const spawns = map.spawns;
    for (const bot of bots) {
      const list = bot.team === 'vanguard' ? spawns.vanguard : spawns.dusk;
      const index = bot.team === 'vanguard'
        ? TEAMMATE_NAMES.indexOf(bot.name)
        : ENEMY_NAMES.indexOf(bot.name);
      const [x, z] = list[index];
      reset(bot, x, z, round);
    }
  }

  return {
    bots,
    createAll,
    resetAll,
    reset,
    routeTo,
    findRoute,
    nearestNode,
    hearShot,
    damage,
    stepBot,
    origin,
  };
}
