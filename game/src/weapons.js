// The arsenal: four guns and a flashbang, each with its own price, damage,
// cadence, magazine, spread and recoil. This module owns the numbers, the view
// models and the firing state; main.js owns the ray and the damage, bots.js
// owns the bots' own loadouts. A tracer pool of four reused lines shows where
// a shot went, and a thrown flashbang is a small ballistic body that blinds
// anyone facing it when it pops.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 300, damage: 26, headMult: 3,
    mag: 12, reserve: 36, gap: 0.16, reload: 1.1, auto: false,
    spreadStill: 0.003, spreadMove: 0.02, kick: 0.006, range: 60,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, damage: 34, headMult: 3,
    mag: 30, reserve: 90, gap: 0.098, reload: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, range: 80,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', price: 4750, damage: 88, headMult: 2.5,
    mag: 10, reserve: 20, gap: 0.85, reload: 2.4, auto: false,
    spreadStill: 0.0008, spreadMove: 0.04, kick: 0.03, range: 100,
  },
  breacher: {
    id: 'breacher', name: 'Breacher-12', price: 1050, damage: 12, headMult: 2,
    mag: 6, reserve: 18, gap: 0.8, reload: 2.2, auto: false, pellets: 8,
    spreadStill: 0.02, spreadMove: 0.035, kick: 0.022, range: 30,
  },
};

export const FLASHBANG_PRICE = 200;
export const ARMOUR_PRICE = 650;

const TRACER_LIFE = 0.07;

export function createWeapons(camera, scene) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262c'), roughness: 0.7, metalness: 0.3 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#39414b'), roughness: 0.45, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.6, metalness: 0.4 });

  function gunBox(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    return mesh;
  }

  function buildModel(def) {
    const model = new THREE.Group();
    if (def.id === 'p9') {
      model.add(gunBox(0.05, 0.07, 0.22, 0, 0, -0.1, dark));
      model.add(gunBox(0.04, 0.09, 0.06, 0, -0.06, 0.02, grip));
    } else if (def.id === 'vk47') {
      model.add(gunBox(0.09, 0.1, 0.42, 0, 0, 0, body));
      model.add(gunBox(0.045, 0.045, 0.4, 0, 0.025, -0.38, grip));
      model.add(gunBox(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip));
      model.add(gunBox(0.04, 0.09, 0.1, 0, -0.08, -0.05, dark));
    } else if (def.id === 'longbow') {
      model.add(gunBox(0.08, 0.09, 0.55, 0, 0, -0.05, body));
      model.add(gunBox(0.03, 0.03, 0.5, 0, 0.02, -0.5, dark));
      model.add(gunBox(0.05, 0.06, 0.16, 0, 0.08, 0.02, grip));
      model.add(gunBox(0.07, 0.07, 0.2, 0, -0.02, 0.32, grip));
    } else {
      model.add(gunBox(0.1, 0.09, 0.5, 0, 0, -0.05, body));
      model.add(gunBox(0.06, 0.06, 0.34, 0, -0.01, -0.3, dark));
      model.add(gunBox(0.08, 0.06, 0.14, 0, -0.05, -0.18, grip));
      model.add(gunBox(0.075, 0.08, 0.2, 0, -0.02, 0.3, grip));
    }
    model.position.set(0.22, -0.22, -0.38);
    model.scale.setScalar(0.8);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  for (const def of Object.values(WEAPONS)) models[def.id] = buildModel(def);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.22, -0.2, -0.9);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.22, -0.18, -0.6);
  camera.add(flashLight);

  // Four reused tracers: a line each, a life each, never allocated in a frame.
  const tracers = [];
  for (let i = 0; i < 4; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  const grenadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.6 }),
  );
  grenadeMesh.visible = false;
  scene.add(grenadeMesh);

  const state = {
    current: 'vk47',
    owned: { vk47: { mag: 30, reserve: 90 } },
    flashbangs: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenade: null,
  };
  models.vk47.visible = true;

  function def() {
    return WEAPONS[state.current];
  }

  function ammo() {
    return state.owned[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.38 + state.kick;
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const d = def();
      model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - ammo().mag;
        const take = Math.min(need, ammo().reserve);
        ammo().mag += take;
        ammo().reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.85;
        if (tracer.life <= 0) tracer.line.material.opacity = 0;
      }
    }
    if (state.grenade) {
      const g = state.grenade;
      g.velocity.y -= 14 * dt;
      g.position.addScaledVector(g.velocity, dt);
      if (g.position.y < 0.07) {
        g.position.y = 0.07;
        g.velocity.y *= -0.35;
        g.velocity.x *= 0.6;
        g.velocity.z *= 0.6;
      }
      g.fuse -= dt;
      grenadeMesh.position.copy(g.position);
      if (g.fuse <= 0) {
        state.grenade = null;
        grenadeMesh.visible = false;
        g.onPop(g.position);
      }
    }
  }

  return {
    state,
    def,
    ammo,
    step,
    ready() {
      return ammo().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + d.kick * 0.7);
    },
    takeRound() {
      if (ammo().mag <= 0) return false;
      ammo().mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || ammo().mag === d.mag || ammo().reserve === 0) return false;
      state.reloadLeft = d.reload;
      return true;
    },
    spread(speed, moving) {
      const d = def();
      const base = d.spreadStill + Math.min(1, speed / 5.4) * d.spreadMove;
      return base + state.bloom + (moving ? 0.004 : 0);
    },
    switchTo(id) {
      if (!WEAPONS[id] || !state.owned[id] || id === state.current) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.reloadLeft = 0;
      state.cooldown = 0.15;
      return true;
    },
    buy(id) {
      const d = WEAPONS[id];
      if (!d || state.owned[id]) return false;
      state.owned[id] = { mag: d.mag, reserve: d.reserve };
      return true;
    },
    refillAmmo() {
      for (const id of Object.keys(state.owned)) {
        const d = WEAPONS[id];
        state.owned[id] = { mag: d.mag, reserve: d.reserve };
      }
    },
    resetLoadout() {
      for (const model of Object.values(models)) model.visible = false;
      state.current = 'vk47';
      models.vk47.visible = true;
      state.owned = { vk47: { mag: 30, reserve: 90 } };
      state.flashbangs = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.grenade = null;
      grenadeMesh.visible = false;
    },
    throwFlash(from, direction, onPop) {
      if (state.flashbangs <= 0 || state.grenade) return false;
      state.flashbangs -= 1;
      const velocity = direction.clone().multiplyScalar(13);
      velocity.y += 3.5;
      state.grenade = { position: from.clone(), velocity, fuse: 1.1, onPop };
      grenadeMesh.visible = true;
      grenadeMesh.position.copy(from);
      return true;
    },
    trace(from, to) {
      const tracer = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % tracers.length;
      const positions = tracer.line.geometry.attributes.position.array;
      positions[0] = from.x;
      positions[1] = from.y;
      positions[2] = from.z;
      positions[3] = to.x;
      positions[4] = to.y;
      positions[5] = to.z;
      tracer.line.geometry.attributes.position.needsUpdate = true;
      tracer.life = TRACER_LIFE;
      tracer.line.material.opacity = 0.85;
    },
  };
}
