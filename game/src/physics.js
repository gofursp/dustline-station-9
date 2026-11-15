// Collision, shared by the player and every bot: a body is a vertical box of a
// radius and a height, resolved one axis at a time against the world's
// colliders, so a wall never swallows a body and a body never climbs one it
// cannot jump. One function, one probe box, no per-frame allocation.
import * as THREE from 'three';

const probe = new THREE.Box3();

export function createBody(colliders, x, z, radius, height) {
  return {
    colliders,
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    radius,
    height,
    onGround: true,
  };
}

export function bodyOverlaps(body, x, y, z, height, lift) {
  probe.min.set(x - body.radius, y + lift, z - body.radius);
  probe.max.set(x + body.radius, y + height - lift, z + body.radius);
  for (const collider of body.colliders) {
    if (probe.intersectsBox(collider)) return collider;
  }
  return null;
}

// Move the body by its velocity for one step: X, then Z, then Y with gravity.
// Returns the collider landed on, if any.
export function moveBody(body, dt, gravity) {
  const nextX = body.position.x + body.velocity.x * dt;
  if (!bodyOverlaps(body, nextX, body.position.y, body.position.z, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!bodyOverlaps(body, body.position.x, body.position.y, nextZ, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }
  body.velocity.y -= gravity * dt;
  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = bodyOverlaps(body, body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
  return hit;
}
