import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ALL_ROAD_RIBBONS,
  BUILDINGS,
  getRoadInfoAt,
  groundHeightAt,
  PROVING_PAD,
  RoadPoint,
  ROCK_PLACEMENTS,
  SEA_LEVEL,
  TREE_PLACEMENTS,
  WORLD_HALF_EXTENT,
} from './worldData';

export interface CarRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  frontLeftKnuckle: THREE.Group;
  frontRightKnuckle: THREE.Group;
  wheels: THREE.Group[]; // [FL, FR, RL, RR]
  brakeMat: THREE.MeshStandardMaterial;
  reverseMat: THREE.MeshStandardMaterial;
  contactShadow: THREE.Mesh;
}

export interface SmokePool {
  mesh: THREE.InstancedMesh;
  active: Uint8Array;
  pos: Float32Array;
  vel: Float32Array;
  age: Float32Array;
  maxAge: Float32Array;
  cursor: number;
  count: number;
}

export interface WorldSceneHandles {
  scene: THREE.Scene;
  car: CarRig;
  sunLight: THREE.DirectionalLight;
  checkpointGroup: THREE.Group;
  checkpointRing: THREE.Mesh;
  checkpointBeacon: THREE.Mesh;
  smokePool: SmokePool;
  dispose: () => void;
}

function createAsphaltTexture(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  ctx.fillStyle = '#2b2f38';
  ctx.fillRect(0, 0, size, size);

  // Subtle aggregate asphalt speckle
  for (let i = 0; i < 4200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 32 + Math.floor(Math.random() * 34);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // White edge lines (left and right margins)
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(10, 0, 5, size);
  ctx.fillRect(size - 15, 0, 5, size);

  // Amber dashed center divider
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(size / 2 - 3, 18, 6, 86);
  ctx.fillRect(size / 2 - 3, 146, 6, 86);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  // Grayscale bump map
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 128;
  bumpCanvas.height = 128;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const g = 90 + Math.floor(Math.random() * 90);
    bctx.fillStyle = `rgb(${g},${g},${g})`;
    bctx.fillRect(x, y, 2, 2);
  }
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

function createWindowFacadeTexture(maxAnisotropy: number, style: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  if (style === 'glass') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 128, 256);
    for (let y = 10; y < 246; y += 22) {
      for (let x = 8; x < 120; x += 20) {
        const lit = Math.random() > 0.65;
        ctx.fillStyle = lit ? '#bae6fd' : '#334155';
        ctx.fillRect(x, y, 14, 14);
      }
    }
  } else if (style === 'brick') {
    ctx.fillStyle = '#7c3f32';
    ctx.fillRect(0, 0, 128, 256);
    for (let y = 12; y < 246; y += 26) {
      for (let x = 10; x < 118; x += 24) {
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(x, y, 14, 16);
      }
    }
  } else {
    ctx.fillStyle = style === 'warehouse' ? '#475569' : '#64748b';
    ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = '#334155';
    for (let y = 0; y < 256; y += 32) {
      ctx.fillRect(0, y, 128, 3);
    }
    for (let x = 14; x < 114; x += 32) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x, 24, 18, 14);
      ctx.fillRect(x, 88, 18, 14);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds a 12+ part articulated GT Sports Coupe THREE.Group.
 */
function buildSportsCoupe(isSoftwareGl: boolean): CarRig {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  root.add(chassisGroup);

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: 0xd91c38, // Deep metallic racing crimson
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: isSoftwareGl ? 0.35 : 1.0,
    clearcoatRoughness: 0.08,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161920,
    roughness: 0.58,
    metalness: 0.22,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1324,
    metalness: 0.25,
    roughness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd4d8e0,
    metalness: 0.92,
    roughness: 0.16,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x14161b,
    roughness: 0.88,
    metalness: 0.04,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.88,
    roughness: 0.2,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.32,
    metalness: 0.45,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.2,
    roughness: 0.1,
  });

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xef4444,
    emissiveIntensity: 0.55,
    roughness: 0.2,
  });

  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: 0xffffff,
    emissiveIntensity: 0.0,
    roughness: 0.2,
  });

  // 1. Primary Lower GT Body Beltline Profile (extruded lower wedge so greenhouse sits cleanly on top)
  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-2.12, 0.27);
  lowerShape.lineTo(2.14, 0.26);
  lowerShape.lineTo(2.24, 0.52); // Nose tip
  lowerShape.lineTo(1.88, 0.72); // Hood front
  lowerShape.lineTo(0.86, 0.84); // Cowl / base of windshield
  lowerShape.lineTo(-1.12, 0.86); // Rear deck base
  lowerShape.lineTo(-2.14, 0.84); // Tail deck
  lowerShape.lineTo(-2.22, 0.48); // Rear bumper
  lowerShape.closePath();

  const lowerGeo = new THREE.ExtrudeGeometry(lowerShape, {
    depth: 1.72,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  lowerGeo.translate(0, 0, -0.86);
  lowerGeo.rotateY(-Math.PI / 2);

  const mainHull = new THREE.Mesh(lowerGeo, paintMat);
  mainHull.castShadow = true;
  mainHull.receiveShadow = true;
  chassisGroup.add(mainHull);

  // 2. Wraparound Glass Canopy / Greenhouse (sits cleanly above beltline with sloped windshield & fastback)
  const canopyShape = new THREE.Shape();
  canopyShape.moveTo(-1.42, 0.83); // Rear fastback base
  canopyShape.lineTo(0.82, 0.83);  // Windshield base
  canopyShape.lineTo(0.18, 1.24);  // Windshield top
  canopyShape.lineTo(-0.84, 1.24); // Roof rear
  canopyShape.closePath();

  const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
    depth: 1.38,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 2,
  });
  canopyGeo.translate(0, 0, -0.69);
  canopyGeo.rotateY(-Math.PI / 2);
  const cabin = new THREE.Mesh(canopyGeo, glassMat);
  cabin.castShadow = true;
  chassisGroup.add(cabin);

  // 3. Sculpted Carbon Roof Panel + Side Roof Rails
  const roofGeo = new THREE.BoxGeometry(1.36, 0.05, 1.06);
  const roof = new THREE.Mesh(roofGeo, carbonMat);
  roof.position.set(0, 1.27, -0.34);
  roof.castShadow = true;
  chassisGroup.add(roof);

  // Hood sculpted power bulge
  const hoodGeo = new THREE.BoxGeometry(1.12, 0.05, 1.15);
  const hood = new THREE.Mesh(hoodGeo, paintMat);
  hood.position.set(0, 0.80, 1.42);
  hood.rotation.x = 0.095;
  chassisGroup.add(hood);

  // 4. Front aero splitter
  const splitterGeo = new THREE.BoxGeometry(1.92, 0.055, 0.42);
  const splitter = new THREE.Mesh(splitterGeo, carbonMat);
  splitter.position.set(0, 0.23, 2.12);
  chassisGroup.add(splitter);

  // 5. Rear carbon diffuser
  const diffuserGeo = new THREE.BoxGeometry(1.78, 0.16, 0.22);
  const diffuser = new THREE.Mesh(diffuserGeo, carbonMat);
  diffuser.position.set(0, 0.30, -2.18);
  chassisGroup.add(diffuser);

  // 6. Side skirts (Left & Right)
  const skirtGeo = new THREE.BoxGeometry(0.12, 0.09, 2.38);
  const skirtL = new THREE.Mesh(skirtGeo, carbonMat);
  skirtL.position.set(0.91, 0.24, 0);
  const skirtR = new THREE.Mesh(skirtGeo, carbonMat);
  skirtR.position.set(-0.91, 0.24, 0);
  chassisGroup.add(skirtL, skirtR);

  // 7. GT Rear Wing + Twin Uprights
  const wingGeo = new THREE.BoxGeometry(1.82, 0.05, 0.26);
  const wing = new THREE.Mesh(wingGeo, carbonMat);
  wing.position.set(0, 1.14, -2.04);
  wing.rotation.x = 0.09;
  wing.castShadow = true;
  chassisGroup.add(wing);

  const pylonGeo = new THREE.BoxGeometry(0.05, 0.28, 0.14);
  const pylonL = new THREE.Mesh(pylonGeo, carbonMat);
  pylonL.position.set(0.54, 0.98, -2.0);
  const pylonR = new THREE.Mesh(pylonGeo, carbonMat);
  pylonR.position.set(-0.54, 0.98, -2.0);
  chassisGroup.add(pylonL, pylonR);

  // 8. Side mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.18, 0.08, 0.14);
  const mirrorL = new THREE.Mesh(mirrorGeo, paintMat);
  mirrorL.position.set(0.92, 0.93, 0.45);
  const mirrorR = new THREE.Mesh(mirrorGeo, paintMat);
  mirrorR.position.set(-0.92, 0.93, 0.45);
  chassisGroup.add(mirrorL, mirrorR);

  // 9. Twin chrome exhaust tips
  const exGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.2, 12);
  exGeo.rotateX(Math.PI / 2);
  const exL = new THREE.Mesh(exGeo, chromeMat);
  exL.position.set(0.50, 0.29, -2.26);
  const exR = new THREE.Mesh(exGeo, chromeMat);
  exR.position.set(-0.50, 0.29, -2.26);
  chassisGroup.add(exL, exR);

  // 10. Front LED Headlights + Grille (flush outside front bumper bevel)
  const headGeo = new THREE.BoxGeometry(0.38, 0.09, 0.12);
  const headL = new THREE.Mesh(headGeo, headlightMat);
  headL.position.set(0.62, 0.56, 2.24);
  headL.rotation.y = 0.14;
  const headR = new THREE.Mesh(headGeo, headlightMat);
  headR.position.set(-0.62, 0.56, 2.24);
  headR.rotation.y = -0.14;
  const grilleGeo = new THREE.BoxGeometry(0.94, 0.19, 0.08);
  const grille = new THREE.Mesh(grilleGeo, carbonMat);
  grille.position.set(0, 0.41, 2.26);
  chassisGroup.add(headL, headR, grille);

  // 11. Rear LED Taillight bar + Brake & Reverse clusters + License recess
  const tailGeo = new THREE.BoxGeometry(0.54, 0.085, 0.08);
  const tailL = new THREE.Mesh(tailGeo, brakeMat);
  tailL.position.set(0.56, 0.72, -2.24);
  const tailR = new THREE.Mesh(tailGeo, brakeMat);
  tailR.position.set(-0.56, 0.72, -2.24);
  const revGeo = new THREE.BoxGeometry(0.18, 0.055, 0.08);
  const revL = new THREE.Mesh(revGeo, reverseMat);
  revL.position.set(0.22, 0.72, -2.24);
  const revR = new THREE.Mesh(revGeo, reverseMat);
  revR.position.set(-0.22, 0.72, -2.24);
  const plateGeo = new THREE.BoxGeometry(0.46, 0.16, 0.05);
  const plate = new THREE.Mesh(plateGeo, carbonMat);
  plate.position.set(0, 0.55, -2.23);
  chassisGroup.add(tailL, tailR, revL, revR, plate);

  // 12. 4 Multi-Part Wheel Assemblies (Tire + 5-spoke Rim + Brake Rotor + Caliper)
  const tireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.27, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.28, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.29, 0.40, 0.045);
  const caliperGeo = new THREE.BoxGeometry(0.08, 0.14, 0.12);

  const createWheel = (isLeft: boolean): THREE.Group => {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const spokeA = new THREE.Mesh(spokeGeo, rimMat);
    const spokeB = new THREE.Mesh(spokeGeo, rimMat);
    spokeB.rotation.x = Math.PI / 3;
    const spokeC = new THREE.Mesh(spokeGeo, rimMat);
    spokeC.rotation.x = (2 * Math.PI) / 3;
    const caliper = new THREE.Mesh(caliperGeo, caliperMat);
    caliper.position.set(isLeft ? -0.04 : 0.04, 0.1, -0.14);

    wg.add(tire, rim, spokeA, spokeB, spokeC, caliper);
    return wg;
  };

  const frontLeftKnuckle = new THREE.Group();
  frontLeftKnuckle.position.set(0.87, 0.35, 1.38);
  const flWheel = createWheel(true);
  frontLeftKnuckle.add(flWheel);
  root.add(frontLeftKnuckle);

  const frontRightKnuckle = new THREE.Group();
  frontRightKnuckle.position.set(-0.87, 0.35, 1.38);
  const frWheel = createWheel(false);
  frontRightKnuckle.add(frWheel);
  root.add(frontRightKnuckle);

  const rlWheel = createWheel(true);
  rlWheel.position.set(0.87, 0.35, -1.36);
  root.add(rlWheel);

  const rrWheel = createWheel(false);
  rrWheel.position.set(-0.87, 0.35, -1.36);
  root.add(rrWheel);

  // Contact shadow grounding plane beneath vehicle
  const shadowGeo = new THREE.PlaneGeometry(2.7, 5.2);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.03;
  root.add(contactShadow);

  return {
    root,
    chassisGroup,
    frontLeftKnuckle,
    frontRightKnuckle,
    wheels: [flWheel, frWheel, rlWheel, rrWheel],
    brakeMat,
    reverseMat,
    contactShadow,
  };
}

function buildRoadRibbonGeometry(points: RoadPoint[], closed: boolean): THREE.BufferGeometry {
  const n = points.length;
  const count = closed ? n + 1 : n;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];

  let accumDist = 0;

  for (let i = 0; i < count; i++) {
    const idx = i % n;
    const prevIdx = closed ? (idx - 1 + n) % n : Math.max(0, idx - 1);
    const nextIdx = closed ? (idx + 1) % n : Math.min(n - 1, idx + 1);

    const p = points[idx];
    const pPrev = points[prevIdx];
    const pNext = points[nextIdx];

    if (i > 0) {
      const prevPoint = points[(i - 1) % n];
      accumDist += Math.hypot(p.x - prevPoint.x, p.z - prevPoint.z);
    }

    let tx = pNext.x - pPrev.x;
    let tz = pNext.z - pPrev.z;
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;

    // Right-hand perpendicular normal in XZ
    const nx = -tz;
    const nz = tx;
    const halfW = p.width * 0.5;
    const y = groundHeightAt(p.x, p.z) + 0.045; // Offset cleanly above terrain to eliminate Z-fighting

    const vIdx = i * 2;
    positions[vIdx * 3 + 0] = p.x - nx * halfW;
    positions[vIdx * 3 + 1] = y;
    positions[vIdx * 3 + 2] = p.z - nz * halfW;

    positions[(vIdx + 1) * 3 + 0] = p.x + nx * halfW;
    positions[(vIdx + 1) * 3 + 1] = y;
    positions[(vIdx + 1) * 3 + 2] = p.z + nz * halfW;

    const vCoord = accumDist / 12;
    uvs[vIdx * 2 + 0] = 0;
    uvs[vIdx * 2 + 1] = vCoord;
    uvs[(vIdx + 1) * 2 + 0] = 1;
    uvs[(vIdx + 1) * 2 + 1] = vCoord;

    if (i < count - 1) {
      const a = vIdx;
      const b = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildOpenWorldScene(
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean,
): WorldSceneHandles {
  const scene = new THREE.Scene();
  const maxAnisotropy = isSoftwareGl ? 1 : renderer.capabilities.getMaxAnisotropy();

  // Studio environment reflections (RoomEnvironment via PMREM)
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmremGenerator.dispose();

  // Atmospheric Sky dome & matching fog
  const sky = new Sky();
  sky.scale.setScalar(4500);
  scene.add(sky);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 4.2;
  skyUniforms['rayleigh'].value = 1.65;
  skyUniforms['mieCoefficient'].value = 0.004;
  skyUniforms['mieDirectionalG'].value = 0.82;

  const sunVec = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - 24); // Golden afternoon sun elevation
  const theta = THREE.MathUtils.degToRad(138);
  sunVec.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sunVec);

  scene.fog = new THREE.FogExp2(0xcbd8e6, 0.00175);

  // Warm key sun light + cool sky/ground HemisphereLight
  const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sunLight.position.copy(sunVec).multiplyScalar(140);
  if (!isSoftwareGl) {
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    const d = 55;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 260;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
  }
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight(0x9ec5f8, 0x4b5542, 0.95);
  scene.add(hemiLight);

  // 1. Continuous Open-World Terrain Mesh
  const terrainSize = WORLD_HALF_EXTENT * 2 + 120;
  const segs = 136;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const vy = groundHeightAt(vx, vz);
    posAttr.setY(i, vy);

    const road = getRoadInfoAt(vx, vz);
    if (vy < -0.2) {
      tmpColor.setHex(0x9d8c60); // Coastal sand
    } else if (road.surface === 'shoulder') {
      tmpColor.setHex(0x4c4840); // Gravel shoulder
    } else if (vy > 11.5) {
      tmpColor.setHex(0x525861); // High alpine rock
    } else if (vy > 5.5) {
      tmpColor.setHex(0x364d32); // Foothill pine scrub
    } else {
      tmpColor.setHex(0x3a5c33); // Rich valley grass
    }
    colors[i * 3 + 0] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Roadside reflector guide posts along the outer highway loop (instanced for speed-sense parallax)
  const loopPts = ALL_ROAD_RIBBONS[0].points;
  const postPositions: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < loopPts.length; i += 2) {
    const p = loopPts[i];
    const pNext = loopPts[(i + 1) % loopPts.length];
    let tx = pNext.x - p.x;
    let tz = pNext.z - p.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const nx = -tz;
    const nz = tx;
    const offset = p.width * 0.5 + 1.35;
    for (const side of [-1, 1]) {
      const px = p.x + nx * offset * side;
      const pz = p.z + nz * offset * side;
      const py = groundHeightAt(px, pz);
      postPositions.push({ x: px, y: py, z: pz });
    }
  }
  const postGeo = new THREE.BoxGeometry(0.18, 1.05, 0.18);
  postGeo.translate(0, 0.525, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
  const postInst = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
  const capPostGeo = new THREE.BoxGeometry(0.2, 0.18, 0.2);
  capPostGeo.translate(0, 0.96, 0);
  const capPostMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });
  const capPostInst = new THREE.InstancedMesh(capPostGeo, capPostMat, postPositions.length);
  const postDummy = new THREE.Object3D();
  for (let i = 0; i < postPositions.length; i++) {
    const pp = postPositions[i];
    postDummy.position.set(pp.x, pp.y, pp.z);
    postDummy.rotation.set(0, 0, 0);
    postDummy.scale.setScalar(1);
    postDummy.updateMatrix();
    postInst.setMatrixAt(i, postDummy.matrix);
    capPostInst.setMatrixAt(i, postDummy.matrix);
  }
  postInst.computeBoundingSphere();
  capPostInst.computeBoundingSphere();
  scene.add(postInst, capPostInst);

  // 2. Coastal Bay Ocean Water Plane
  const waterGeo = new THREE.PlaneGeometry(800, 800);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0f4c6e,
    roughness: 0.14,
    metalness: 0.55,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.y = SEA_LEVEL;
  scene.add(waterMesh);

  // 3. Asphalt Road Ribbons
  const { map: asphaltMap, bumpMap: asphaltBump } = createAsphaltTexture(maxAnisotropy);
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: asphaltMap,
    bumpMap: asphaltBump,
    bumpScale: 0.04,
    roughness: 0.78,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  for (const ribbon of ALL_ROAD_RIBBONS) {
    const rGeo = buildRoadRibbonGeometry(ribbon.points, ribbon.closed);
    const rMesh = new THREE.Mesh(rGeo, roadMat);
    rMesh.receiveShadow = true;
    scene.add(rMesh);
  }

  // 4. Industrial Proving Ground Skidpad
  const padGeo = new THREE.CylinderGeometry(PROVING_PAD.radius, PROVING_PAD.radius, 0.16, 48);
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x2d323c,
    bumpMap: asphaltBump,
    bumpScale: 0.04,
    roughness: 0.76,
    metalness: 0.06,
  });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.position.set(PROVING_PAD.x, groundHeightAt(PROVING_PAD.x, PROVING_PAD.z) - 0.03, PROVING_PAD.z);
  padMesh.receiveShadow = true;
  scene.add(padMesh);

  // White skidpad drift circle markings
  const ringGeo = new THREE.RingGeometry(15.5, 16.3, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const skidRing = new THREE.Mesh(ringGeo, ringMat);
  skidRing.position.set(PROVING_PAD.x, padMesh.position.y + 0.1, PROVING_PAD.z);
  scene.add(skidRing);

  // 5. Downtown & Harbor Buildings (composite architectural blocks + rooftop trim)
  const facadeCache = new Map<string, THREE.MeshStandardMaterial>();
  for (const b of BUILDINGS) {
    if (!facadeCache.has(b.style)) {
      const tex = createWindowFacadeTexture(maxAnisotropy, b.style);
      facadeCache.set(
        b.style,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: tex,
          roughness: b.style === 'glass' ? 0.22 : 0.75,
          metalness: b.style === 'glass' ? 0.45 : 0.1,
        }),
      );
    }
    const baseY = groundHeightAt(b.x, b.z);
    const bGroup = new THREE.Group();
    bGroup.position.set(b.x, baseY, b.z);
    bGroup.rotation.y = b.rotationY;

    const towerGeo = new THREE.BoxGeometry(b.width, b.height, b.depth);
    const tower = new THREE.Mesh(towerGeo, facadeCache.get(b.style)!);
    tower.position.y = b.height * 0.5;
    tower.castShadow = true;
    tower.receiveShadow = true;
    bGroup.add(tower);

    // Rooftop crown parapet
    const capGeo = new THREE.BoxGeometry(b.width * 0.88, 1.4, b.depth * 0.88);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = b.height + 0.7;
    bGroup.add(cap);

    scene.add(bGroup);
  }

  // 6. Signature Landmarks: Lighthouse, Observatory Dome, Industrial Silos
  // Lighthouse (-205, 108)
  const lhBaseY = groundHeightAt(-205, 108);
  const lhGroup = new THREE.Group();
  lhGroup.position.set(-205, lhBaseY, 108);
  const lhShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 3.6, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 }),
  );
  lhShaft.position.y = 12;
  const lhStripe = new THREE.Mesh(
    new THREE.CylinderGeometry(2.65, 3.05, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 }),
  );
  lhStripe.position.y = 12;
  const lhLantern = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 1.9, 3.0, 12),
    new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 1.6 }),
  );
  lhLantern.position.y = 25.5;
  const lhRoof = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, 2.8, 12),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }),
  );
  lhRoof.position.y = 28.4;
  lhGroup.add(lhShaft, lhStripe, lhLantern, lhRoof);
  scene.add(lhGroup);

  // Observatory Summit Dome (208, -180)
  const obsY = groundHeightAt(208, -180);
  const obsGroup = new THREE.Group();
  obsGroup.position.set(208, obsY, -180);
  const obsBase = new THREE.Mesh(
    new THREE.CylinderGeometry(8.5, 9.5, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 }),
  );
  obsBase.position.y = 4;
  const obsDome = new THREE.Mesh(
    new THREE.SphereGeometry(8.4, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.35, roughness: 0.25 }),
  );
  obsDome.position.y = 8;
  const obsSlit = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 5.0, 8.8),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 }),
  );
  obsSlit.position.set(0, 10.2, 2.2);
  obsGroup.add(obsBase, obsDome, obsSlit);
  scene.add(obsGroup);

  // Industrial Silos
  const siloGeo = new THREE.CylinderGeometry(4.0, 4.0, 15, 18);
  const siloMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.65, roughness: 0.35 });
  for (const [sx, sz] of [[162, 96], [174, 92]]) {
    const sy = groundHeightAt(sx, sz);
    const silo = new THREE.Mesh(siloGeo, siloMat);
    silo.position.set(sx, sy + 7.5, sz);
    scene.add(silo);
  }

  // 7. Instanced Pine Trees (trunk + 2-tier foliage) & Canyon Rocks
  const treeCount = TREE_PLACEMENTS.length;
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.52, 2.6, 7);
  trunkGeo.translate(0, 1.3, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.92 });
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);

  const foliageGeo = new THREE.ConeGeometry(2.3, 5.8, 7);
  foliageGeo.translate(0, 4.9, 0);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);

  const dummy = new THREE.Object3D();
  const cTmp = new THREE.Color();
  for (let i = 0; i < treeCount; i++) {
    const tp = TREE_PLACEMENTS[i];
    dummy.position.set(tp.x, tp.y - 0.1, tp.z);
    dummy.rotation.set(0, tp.rotationY, 0);
    dummy.scale.setScalar(tp.scale);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);
    foliageInst.setMatrixAt(i, dummy.matrix);
    cTmp.setHSL(0.32 + tp.tint * 0.05, 0.38, 0.22 + tp.tint * 0.08);
    foliageInst.setColorAt(i, cTmp);
  }
  trunkInst.computeBoundingSphere();
  foliageInst.computeBoundingSphere();
  scene.add(trunkInst, foliageInst);

  // Rocks
  const rockCount = ROCK_PLACEMENTS.length;
  const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);
  rockGeo.translate(0, 0.75, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true });
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const rp = ROCK_PLACEMENTS[i];
    dummy.position.set(rp.x, rp.y - 0.2, rp.z);
    dummy.rotation.set(rp.tint * 0.4, rp.rotationY, 0);
    dummy.scale.set(rp.scale * 1.1, rp.scale * 0.85, rp.scale);
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);
    cTmp.setHSL(0.08, 0.08, 0.38 + rp.tint * 0.14);
    rockInst.setColorAt(i, cTmp);
  }
  rockInst.computeBoundingSphere();
  scene.add(rockInst);

  // 8. Hero Sports Coupe
  const car = buildSportsCoupe(isSoftwareGl);
  scene.add(car.root);

  // 9. Mission Checkpoint Beacon Group (hidden when in Freeroam)
  const checkpointGroup = new THREE.Group();
  checkpointGroup.visible = false;
  const cpRingGeo = new THREE.TorusGeometry(6.5, 0.32, 10, 32);
  cpRingGeo.rotateX(Math.PI / 2);
  const cpRingMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  const checkpointRing = new THREE.Mesh(cpRingGeo, cpRingMat);
  checkpointRing.position.y = 0.4;

  const cpBeaconGeo = new THREE.CylinderGeometry(0.45, 2.2, 48, 16, 1, true);
  const cpBeaconMat = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const checkpointBeacon = new THREE.Mesh(cpBeaconGeo, cpBeaconMat);
  checkpointBeacon.position.y = 24;

  checkpointGroup.add(checkpointRing, checkpointBeacon);
  scene.add(checkpointGroup);

  // 10. Pooled Tire-Smoke / Dust Particles (InstancedMesh ring buffer)
  const smokeCount = 96;
  const smokeGeo = new THREE.IcosahedronGeometry(0.42, 0);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0xdbe2ea,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, smokeCount);
  smokeMesh.frustumCulled = false;
  for (let i = 0; i < smokeCount; i++) {
    dummy.position.set(0, -100, 0);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    smokeMesh.setMatrixAt(i, dummy.matrix);
  }
  scene.add(smokeMesh);

  const smokePool: SmokePool = {
    mesh: smokeMesh,
    active: new Uint8Array(smokeCount),
    pos: new Float32Array(smokeCount * 3),
    vel: new Float32Array(smokeCount * 3),
    age: new Float32Array(smokeCount),
    maxAge: new Float32Array(smokeCount),
    cursor: 0,
    count: smokeCount,
  };

  const dispose = () => {
    envTex.dispose();
    asphaltMap.dispose();
    asphaltBump.dispose();
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });
  };

  return {
    scene,
    car,
    sunLight,
    checkpointGroup,
    checkpointRing,
    checkpointBeacon,
    smokePool,
    dispose,
  };
}

const _pDummy = new THREE.Object3D();

export function spawnSmokePuff(
  pool: SmokePool,
  x: number,
  y: number,
  z: number,
  vx: number,
  vz: number,
): void {
  const idx = pool.cursor;
  pool.cursor = (pool.cursor + 1) % pool.count;
  pool.active[idx] = 1;
  pool.pos[idx * 3 + 0] = x;
  pool.pos[idx * 3 + 1] = y;
  pool.pos[idx * 3 + 2] = z;
  pool.vel[idx * 3 + 0] = vx + (Math.random() - 0.5) * 1.4;
  pool.vel[idx * 3 + 1] = 0.8 + Math.random() * 0.9;
  pool.vel[idx * 3 + 2] = vz + (Math.random() - 0.5) * 1.4;
  pool.age[idx] = 0;
  pool.maxAge[idx] = 0.55 + Math.random() * 0.35;
}

export function stepSmokePool(pool: SmokePool, dt: number): void {
  let dirty = false;
  for (let i = 0; i < pool.count; i++) {
    if (!pool.active[i]) continue;
    dirty = true;
    pool.age[i] += dt;
    const life = pool.age[i] / pool.maxAge[i];
    if (life >= 1) {
      pool.active[i] = 0;
      _pDummy.position.set(0, -100, 0);
      _pDummy.scale.setScalar(0.001);
      _pDummy.updateMatrix();
      pool.mesh.setMatrixAt(i, _pDummy.matrix);
      continue;
    }
    pool.pos[i * 3 + 0] += pool.vel[i * 3 + 0] * dt;
    pool.pos[i * 3 + 1] += pool.vel[i * 3 + 1] * dt;
    pool.pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
    const s = (0.45 + life * 1.65) * (1 - life * 0.35);
    _pDummy.position.set(pool.pos[i * 3 + 0], pool.pos[i * 3 + 1], pool.pos[i * 3 + 2]);
    _pDummy.scale.setScalar(s);
    _pDummy.updateMatrix();
    pool.mesh.setMatrixAt(i, _pDummy.matrix);
  }
  if (dirty) {
    pool.mesh.instanceMatrix.needsUpdate = true;
  }
}
