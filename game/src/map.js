// Station 9: a decommissioned freight yard at dusk. Three lanes — a container
// corridor down the middle, the fuel depot (Site A) to the west, the signal
// tower (Site B) to the east — between a south spawn and a north spawn. Every
// solid is a box or a cylinder, every solid is a collider for movement and a
// surface a bullet stops on, and the waypoint graph below is the only thing
// the bots navigate by, so a bot can never walk through a wall it cannot see.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const RUST = '#7a4a2b';
const TEAL = '#2f5d5a';
const OCHRE = '#8a6d2f';
const STEEL = '#3a444e';
const CONCRETE = '#232a31';

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {
    ground: new THREE.MeshStandardMaterial({ color: new THREE.Color('#1e242b'), roughness: 0.95, metalness: 0.02 }),
    concrete: new THREE.MeshStandardMaterial({ color: new THREE.Color(CONCRETE), roughness: 0.9, metalness: 0.04 }),
    steel: new THREE.MeshStandardMaterial({ color: new THREE.Color(STEEL), roughness: 0.6, metalness: 0.5 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(RUST), roughness: 0.85, metalness: 0.15 }),
    teal: new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAL), roughness: 0.8, metalness: 0.2 }),
    ochre: new THREE.MeshStandardMaterial({ color: new THREE.Color(OCHRE), roughness: 0.85, metalness: 0.15 }),
    amber: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.2, emissive: new THREE.Color('#442a00') }),
    siteA: new THREE.MeshStandardMaterial({ color: new THREE.Color('#c77b2d'), roughness: 0.9, metalness: 0.05 }),
    siteB: new THREE.MeshStandardMaterial({ color: new THREE.Color('#3f7d8c'), roughness: 0.9, metalness: 0.05 }),
  };

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground, 46 x 38 m, and the perimeter wall, 5 m high.
  box(46.4, 0.4, 38.4, 0, -0.2, 0, 'ground');
  box(0.4, 5, 38.4, -23.2, 2.5, 0, 'concrete');
  box(0.4, 5, 38.4, 23.2, 2.5, 0, 'concrete');
  box(46.4, 5, 0.4, 0, 2.5, -19.2, 'concrete');
  box(46.4, 5, 0.4, 0, 2.5, 19.2, 'concrete');

  // Painted lane lines on the ground: flat strips, no collision, no shadow.
  box(0.25, 0.02, 30, -8, 0.01, 0, 'amber', false).receiveShadow = false;
  box(0.25, 0.02, 30, 8, 0.01, 0, 'amber', false).receiveShadow = false;

  // --- Mid lane: the container corridor. ---
  box(6, 2.6, 2.4, -3.4, 1.3, 2, 'rust');
  box(6, 2.6, 2.4, 3.4, 1.3, -2, 'teal');
  box(2.4, 2.6, 6, -3.4, 1.3, -6, 'ochre');
  box(2.4, 2.6, 6, 3.4, 1.3, 6, 'ochre');
  box(6, 2.6, 2.4, -3.4, 3.9, 2, 'teal');
  box(1.2, 1.1, 1.2, 0, 0.55, 8, 'steel');
  box(1.2, 1.1, 1.2, -1.4, 0.55, 9.4, 'steel');
  box(1.2, 1.1, 1.2, 1.4, 0.55, 9.4, 'steel');
  // The gantry crane over mid: two legs and a beam, the yard's skyline.
  box(0.8, 9, 0.8, -8, 4.5, 0, 'steel');
  box(0.8, 9, 0.8, 8, 4.5, 0, 'steel');
  box(17.6, 1, 1.2, 0, 8.6, 0, 'steel');
  box(1.6, 0.5, 1.6, 0, 7.9, 0, 'amber');

  // --- Site A (west): the fuel depot. ---
  cylinder(2.2, 4.4, -18, 2.2, -10, 'rust');
  cylinder(1.6, 3.2, -15, 1.6, -14, 'teal');
  box(4, 0.5, 4, -18, 0.25, -4, 'concrete');
  box(2, 0.9, 1, -19, 0.45, -6.5, 'steel');
  box(2, 0.9, 1, -15.5, 0.45, -6.5, 'steel');
  box(0.3, 3.4, 6, -20.5, 1.7, -10, 'steel');
  box(6, 0.25, 6, -17, 0.12, -9, 'siteA', false).receiveShadow = false;

  // --- Site B (east): the signal tower. ---
  box(1, 8, 1, 18, 4, -12, 'steel');
  box(1, 8, 1, 18, 4, -8, 'steel');
  box(1, 8, 1, 21, 4, -12, 'steel');
  box(1, 8, 1, 21, 4, -8, 'steel');
  box(4.6, 0.6, 4.6, 19.5, 8.2, -10, 'steel');
  box(0.8, 0.8, 0.8, 19.5, 9, -10, 'amber');
  box(8, 1.2, 2.2, 16, 0.6, -4, 'rust');
  box(1.1, 1.1, 1.1, 14, 0.55, -8, 'steel');
  box(1.1, 1.1, 1.1, 20, 0.55, -14, 'steel');
  box(6, 0.25, 6, 18, 0.12, -10, 'siteB', false).receiveShadow = false;

  // --- Cover crates, barrels and the rail car on the east track. ---
  box(1.6, 1.1, 1.6, -12, 0.55, 6, 'ochre');
  box(1.6, 1.1, 1.6, 12, 0.55, 6, 'ochre');
  box(2.4, 1.1, 1.2, -12, 0.55, -2, 'steel');
  box(2.4, 1.1, 1.2, 12, 0.55, -2, 'steel');
  box(1.2, 1.1, 2.4, -6, 0.55, -12, 'teal');
  box(1.2, 1.1, 2.4, 6, 0.55, -12, 'teal');
  cylinder(0.55, 1.1, -10, 0.55, 10, 'rust');
  cylinder(0.55, 1.1, 10, 0.55, 10, 'rust');
  cylinder(0.55, 1.1, -8, 0.55, -14, 'teal');
  cylinder(0.55, 1.1, 8, 0.55, -14, 'teal');
  box(9, 2.4, 2.6, 14, 1.2, 12, 'steel');
  box(9, 0.3, 0.4, 14, 0.15, 10.2, 'steel', false);
  box(9, 0.3, 0.4, 14, 0.15, 13.8, 'steel', false);

  // --- Light: a low amber sun, a cool dusk sky, three sodium lamps. ---
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a6b7d'), new THREE.Color('#1a1410'), 1.2);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45c'), 2.2);
  sun.position.set(-14, 18, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d8ba0'), 0.65);
  fill.position.set(12, 10, -10);
  scene.add(fill);
  for (const [x, z] of [[-17, -9], [18, -10], [0, 2]]) {
    const lamp = new THREE.PointLight(new THREE.Color('#f0a830'), 14, 16, 1.6);
    lamp.position.set(x, 5.2, z);
    scene.add(lamp);
  }

  // Waypoints: the graph the bots navigate. Nodes are open ground; edges are
  // straight walks with no wall between them.
  const waypoints = {
    vSpawn: { x: 0, z: 15, to: ['vMid', 'aLane', 'bLane'] },
    vMid: { x: 0, z: 8, to: ['vSpawn', 'midLow', 'midHigh', 'aLane', 'bLane'] },
    midLow: { x: -4, z: 2, to: ['vMid', 'midCross', 'aLane'] },
    midHigh: { x: 4, z: 2, to: ['vMid', 'midCross', 'bLane'] },
    midCross: { x: 0, z: -4, to: ['midLow', 'midHigh', 'dMid', 'aEntry', 'bEntry'] },
    aLane: { x: -12, z: 8, to: ['vSpawn', 'vMid', 'midLow', 'aEntry'] },
    aEntry: { x: -14, z: -3, to: ['aLane', 'midCross', 'aSite', 'aHold'] },
    aSite: { x: -17, z: -9, to: ['aEntry', 'aHold'] },
    aHold: { x: -12, z: -12, to: ['aEntry', 'aSite', 'dA'] },
    bLane: { x: 12, z: 8, to: ['vSpawn', 'vMid', 'midHigh', 'bEntry'] },
    bEntry: { x: 14, z: -3, to: ['bLane', 'midCross', 'bSite', 'bHold'] },
    bSite: { x: 18, z: -10, to: ['bEntry', 'bHold'] },
    bHold: { x: 12, z: -12, to: ['bEntry', 'bSite', 'dB'] },
    dSpawn: { x: 0, z: -15, to: ['dMid', 'dA', 'dB'] },
    dMid: { x: 0, z: -9, to: ['dSpawn', 'midCross', 'dA', 'dB'] },
    dA: { x: -8, z: -13, to: ['dSpawn', 'dMid', 'aHold'] },
    dB: { x: 8, z: -13, to: ['dSpawn', 'dMid', 'bHold'] },
  };

  return {
    colliders,
    shootables,
    group,
    spawns: {
      vanguard: [
        [-2.5, 15.5], [0, 16], [2.5, 15.5], [-1, 13.5], [1, 13.5],
      ],
      dusk: [
        [-2.5, -15.5], [0, -16], [2.5, -15.5], [-1, -13.5], [1, -13.5],
      ],
    },
    sites: {
      A: { x: -17, z: -9, radius: 4.2 },
      B: { x: 18, z: -10, radius: 4.2 },
    },
    waypoints,
  };
}
