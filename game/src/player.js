// The player: acceleration, friction, gravity, crouch and jump, health and
// armour. Movement reads the held keys; the camera reads this module's eye
// and angles; damage comes in through hurt(), which spends armour first.
// The body itself lives in physics.js, shared with the bots.
import * as THREE from 'three';
import { createBody, moveBody, bodyOverlaps } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders) {
  const body = createBody(colliders, 0, 15.5, 0.34, STAND_HEIGHT);
  const state = {
    body,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armour: 0,
    alive: true,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching
      && !bodyOverlaps(body, body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const speed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    moveBody(body, dt, GRAVITY);
  }

  // Armour absorbs half of every hit until it runs out. Returns true when the
  // hit killed the player.
  function hurt(damage) {
    if (!state.alive) return false;
    let remaining = damage;
    if (state.armour > 0) {
      const absorbed = Math.min(state.armour, Math.ceil(damage / 2));
      state.armour -= absorbed;
      remaining = damage - absorbed;
    }
    state.health -= remaining;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
      return true;
    }
    return false;
  }

  function reset(x, z, yaw) {
    body.position.set(x, 0, z);
    body.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.pitch = 0;
    state.eye = STAND_EYE;
    state.crouching = false;
    state.height = STAND_HEIGHT;
    body.height = STAND_HEIGHT;
    state.health = 100;
    state.armour = 0;
    state.alive = true;
  }

  return {
    state,
    step,
    look,
    recoil,
    hurt,
    reset,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePosition(out) {
      out.set(body.position.x, body.position.y + state.eye, body.position.z);
      return out;
    },
  };
}
