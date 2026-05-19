import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const FIREPLACE_BACKGROUND_SRC = "/assets/fireplace-bg-2560x720.png";
const flameHotspots = [
  { x: -1.5, count: 2, width: 0.12, height: 0.34, lift: -0.86, layer: 0.04, peaks: 0, sparkWeight: 0.7 },
  { x: -1.08, count: 4, width: 0.2, height: 0.5, lift: -0.85, layer: 0.16, peaks: 0, sparkWeight: 1.2 },
  { x: -0.56, count: 3, width: 0.16, height: 0.48, lift: -0.84, layer: 0.22, peaks: 0, sparkWeight: 1.1 },
  { x: -0.18, count: 5, width: 0.19, height: 0.78, lift: -0.83, layer: 0.62, peaks: 1, sparkWeight: 1.7 },
  { x: 0.22, count: 5, width: 0.17, height: 0.86, lift: -0.835, layer: 0.74, peaks: 2, sparkWeight: 1.9 },
  { x: 0.66, count: 4, width: 0.2, height: 0.46, lift: -0.85, layer: 0.2, peaks: 0, sparkWeight: 1.2 },
  { x: 1.18, count: 3, width: 0.18, height: 0.34, lift: -0.865, layer: 0.08, peaks: 0, sparkWeight: 0.8 },
  { x: 1.55, count: 2, width: 0.12, height: 0.28, lift: -0.875, layer: 0.03, peaks: 0, sparkWeight: 0.45 }
];

const FLAME_COUNT = flameHotspots.reduce((count, hotspot) => count + hotspot.count, 0);
const FLARE_COUNT = 2;
const BACK_WALL_FLARE_COUNT = 5;
const SPARK_COUNT = 420;
const EMBER_COUNT = 360;
const ASH_COUNT = 120;
const TARGET_FRAME_MS = 1000 / 24;

function randomRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pickHotspot() {
  const totalWeight = flameHotspots.reduce((sum, hotspot) => sum + hotspot.sparkWeight, 0);
  let cursor = Math.random() * totalWeight;
  for (const hotspot of flameHotspots) {
    cursor -= hotspot.sparkWeight;
    if (cursor <= 0) return hotspot;
  }
  return flameHotspots[flameHotspots.length - 1];
}

interface FlameSceneProps {
  lowPower?: boolean;
}

export function FlameScene({ lowPower = false }: FlameSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [fallbackActive, setFallbackActive] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (lowPower) {
      setFallbackActive(false);
      return;
    }

    const probeCanvas = document.createElement("canvas");
    const probeContext = probeCanvas.getContext("webgl2") ?? probeCanvas.getContext("webgl");
    if (!probeContext) {
      setFallbackActive(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "low-power"
      });
    } catch {
      setFallbackActive(true);
      return;
    }

    setFallbackActive(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;

    const disposables: Array<{ dispose: () => void }> = [];

    const firebedGeometry = new THREE.PlaneGeometry(6.7, 1.15, 1, 1);
    const firebedMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          float x = abs(vUv.x - 0.5) * 2.0;
          float y = vUv.y;
          float flicker = 0.84 + 0.16 * sin(uTime * 1.1) + 0.08 * sin(uTime * 2.3 + vUv.x * 12.0);
          float shelf = (1.0 - smoothstep(0.58, 1.0, x)) * smoothstep(0.04, 0.18, y) * (1.0 - smoothstep(0.46, 0.74, y));
          float leftPocket = 1.0 - smoothstep(0.0, 0.14, distance(vUv, vec2(0.34, 0.28)));
          float midLeftPocket = 1.0 - smoothstep(0.0, 0.13, distance(vUv, vec2(0.47, 0.34)));
          float midRightPocket = 1.0 - smoothstep(0.0, 0.13, distance(vUv, vec2(0.56, 0.36)));
          float rightPocket = 1.0 - smoothstep(0.0, 0.15, distance(vUv, vec2(0.66, 0.27)));
          float farRightPocket = 1.0 - smoothstep(0.0, 0.11, distance(vUv, vec2(0.73, 0.23)));
          float pockets = leftPocket * 0.42 + midLeftPocket * 0.78 + midRightPocket * 0.9 + rightPocket * 0.44 + farRightPocket * 0.22;
          float heat = shelf * 0.055 + pockets * 0.12;
          vec3 color = mix(vec3(0.72, 0.08, 0.018), vec3(1.0, 0.46, 0.08), y);
          gl_FragColor = vec4(color, heat * flicker);
        }
      `
    });
    const firebed = new THREE.Mesh(firebedGeometry, firebedMaterial);
    firebed.position.set(0, -0.78, -0.01);
    scene.add(firebed);
    disposables.push(firebedGeometry, firebedMaterial);

    const backWallFlareBaseGeometry = new THREE.PlaneGeometry(1, 1, 8, 24);
    const backWallFlareGeometry = new THREE.InstancedBufferGeometry();
    backWallFlareGeometry.index = backWallFlareBaseGeometry.index;
    backWallFlareGeometry.attributes.position = backWallFlareBaseGeometry.attributes.position;
    backWallFlareGeometry.attributes.uv = backWallFlareBaseGeometry.attributes.uv;
    backWallFlareGeometry.instanceCount = BACK_WALL_FLARE_COUNT;

    const backWallFlareSeeds = new Float32Array(BACK_WALL_FLARE_COUNT);
    for (let index = 0; index < BACK_WALL_FLARE_COUNT; index += 1) {
      backWallFlareSeeds[index] = Math.random();
    }
    backWallFlareGeometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(backWallFlareSeeds, 1));

    const backWallFlareMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        attribute float iSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying float vPresence;
        varying float vHeight;
        varying float vWallPocket;

        float hash(float value) {
          return fract(sin(value) * 43758.5453123);
        }

        void main() {
          vUv = uv;
          float cycleLength = 8.5 + iSeed * 6.5;
          float cycle = floor((uTime + iSeed * 23.0) / cycleLength);
          float phase = fract((uTime + iSeed * 23.0) / cycleLength);
          float appear = smoothstep(0.02, 0.09, phase);
          float vanish = 1.0 - smoothstep(0.28, 0.58, phase);
          float pulse = 0.72 + 0.28 * sin(phase * 31.416);
          float presence = max(0.018, appear * vanish * pulse);
          float randX = hash(cycle * 17.11 + iSeed * 71.9);
          float randH = hash(cycle * 3.29 + iSeed * 53.4);
          float randW = hash(cycle * 7.91 + iSeed * 19.6);
          float baseX = mix(-1.36, 1.36, randX);
          float flameHeight = mix(0.24, 0.42, randH);
          float flameWidth = mix(0.3, 0.52, randW);
          float wallPocket = smoothstep(0.18, 0.82, randX);
          float height = uv.y;
          float taper = mix(1.0, 0.08, pow(height, 1.18));
          float sway = sin(uTime * (0.42 + iSeed * 0.18) + height * 6.4 + iSeed * 13.0);
          vec3 p = position;
          p.x = p.x * flameWidth * taper + baseX + sway * 0.055 * height * presence;
          p.y = p.y * flameHeight * presence + flameHeight * 0.5 * presence - 0.58;
          p.z = -0.04;
          vPresence = presence;
          vHeight = randH;
          vWallPocket = wallPocket;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vPresence;
        varying float vHeight;
        varying float vWallPocket;

        void main() {
          float height = vUv.y;
          float center = abs(vUv.x - 0.5);
          float width = mix(0.48, 0.05, pow(height, 1.1));
          float body = smoothstep(width, width - 0.2, center);
          float core = smoothstep(width * 0.28, width * 0.28 - 0.08, center);
          float baseFade = smoothstep(0.0, 0.1, height);
          float tipFade = 1.0 - smoothstep(0.64, 0.98, height);
          vec3 emberRed = vec3(0.7, 0.065, 0.014);
          vec3 wallOrange = vec3(1.0, 0.42, 0.06);
          vec3 paleCore = vec3(1.0, 0.78, 0.28);
          vec3 color = mix(emberRed, wallOrange, height * 0.62 + core * 0.28);
          color = mix(color, paleCore, core * (0.55 - height * 0.22));
          color *= 0.72 + vHeight * 0.28 + vWallPocket * 0.08;
          float alpha = body * baseFade * tipFade * vPresence * (0.5 + core * 0.42);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const backWallFlares = new THREE.Mesh(backWallFlareGeometry, backWallFlareMaterial);
    backWallFlares.renderOrder = 1;
    scene.add(backWallFlares);
    disposables.push(backWallFlareBaseGeometry, backWallFlareGeometry, backWallFlareMaterial);

    const flameBaseGeometry = new THREE.PlaneGeometry(1, 1, 12, 24);
    const flameGeometry = new THREE.InstancedBufferGeometry();
    flameGeometry.index = flameBaseGeometry.index;
    flameGeometry.attributes.position = flameBaseGeometry.attributes.position;
    flameGeometry.attributes.uv = flameBaseGeometry.attributes.uv;
    flameGeometry.instanceCount = FLAME_COUNT;

    const flameOffsets = new Float32Array(FLAME_COUNT * 3);
    const flameScales = new Float32Array(FLAME_COUNT * 2);
    const flameSeeds = new Float32Array(FLAME_COUNT);
    const flameLayers = new Float32Array(FLAME_COUNT);
    const flameOpacities = new Float32Array(FLAME_COUNT);
    const flameDepths = new Float32Array(FLAME_COUNT);
    const flamePulses = new Float32Array(FLAME_COUNT * 3);
    let flameIndex = 0;
    for (const hotspot of flameHotspots) {
      for (let index = 0; index < hotspot.count && flameIndex < FLAME_COUNT; index += 1) {
        const localLane = hotspot.count <= 1 ? 0.5 : index / (hotspot.count - 1);
        const localCenterBias = Math.sin(localLane * Math.PI);
        const isPeak = index < hotspot.peaks;
        const layer = Math.min(1, Math.max(0, hotspot.layer + randomRange(-0.1, 0.08) + (isPeak ? 0.16 : 0)));
        const horizontalJitter = randomRange(-0.42, 0.42) * hotspot.width;
        const verticalJitter = randomRange(-0.018, 0.032) - (isPeak ? 0.004 : 0.014);
        const lowBreak = isPeak ? randomRange(0.94, 1.06) : randomRange(0.54, 0.82);
        flameOffsets[flameIndex * 3] = hotspot.x + (localLane - 0.5) * hotspot.width + horizontalJitter;
        flameOffsets[flameIndex * 3 + 1] = hotspot.lift + verticalJitter;
        flameOffsets[flameIndex * 3 + 2] = 0;
        flameScales[flameIndex * 2] = randomRange(0.055, 0.12) + layer * 0.025 + localCenterBias * 0.018;
        flameScales[flameIndex * 2 + 1] = (randomRange(0.26, 0.48) * hotspot.height + layer * 0.085 + localCenterBias * 0.045) * lowBreak;
        flameSeeds[flameIndex] = Math.random();
        flameLayers[flameIndex] = layer;
        flameOpacities[flameIndex] = isPeak ? randomRange(0.84, 0.98) : randomRange(0.34, 0.66) * (0.78 + layer * 0.22);
        flameDepths[flameIndex] = isPeak ? randomRange(0.58, 0.92) : randomRange(0.12, 0.78);
        flamePulses[flameIndex * 3] = randomRange(0, Math.PI * 2);
        flamePulses[flameIndex * 3 + 1] = isPeak ? randomRange(0.28, 0.48) : randomRange(0.38, 0.84);
        flamePulses[flameIndex * 3 + 2] = isPeak ? randomRange(0.58, 0.76) : randomRange(0.22, 0.48);
        flameIndex += 1;
      }
    }

    flameGeometry.setAttribute("iOffset", new THREE.InstancedBufferAttribute(flameOffsets, 3));
    flameGeometry.setAttribute("iScale", new THREE.InstancedBufferAttribute(flameScales, 2));
    flameGeometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(flameSeeds, 1));
    flameGeometry.setAttribute("iLayer", new THREE.InstancedBufferAttribute(flameLayers, 1));
    flameGeometry.setAttribute("iOpacity", new THREE.InstancedBufferAttribute(flameOpacities, 1));
    flameGeometry.setAttribute("iDepth", new THREE.InstancedBufferAttribute(flameDepths, 1));
    flameGeometry.setAttribute("iPulse", new THREE.InstancedBufferAttribute(flamePulses, 3));

    const flameMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        attribute vec3 iOffset;
        attribute vec2 iScale;
        attribute float iSeed;
        attribute float iLayer;
        attribute float iOpacity;
        attribute float iDepth;
        attribute vec3 iPulse;
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        varying float vLayer;
        varying float vOpacity;
        varying float vDepth;
        varying float vPresence;
        varying float vFlicker;

        void main() {
          vUv = uv;
          vSeed = iSeed;
          vLayer = iLayer;
          vOpacity = iOpacity;
          float height = uv.y;
          float cycle = 0.5 + 0.5 * sin(uTime * iPulse.y + iPulse.x);
          float flare = smoothstep(1.0 - iPulse.z, min(1.0, 1.14 - iPulse.z), cycle);
          float flutter = 0.86 + 0.14 * sin(uTime * (1.4 + iSeed * 1.2) + iSeed * 37.0);
          float presence = max(iLayer * 0.22, flare * flutter);
          float depth = clamp(iDepth + sin(uTime * (0.1 + iSeed * 0.08) + iSeed * 9.0) * 0.18 + (presence - 0.5) * 0.08, 0.0, 1.0);
          float depthScale = mix(0.72, 1.16, depth);
          float activityScale = mix(0.34, 1.08, presence);
          float sway = sin(uTime * (0.72 + iSeed * 0.78 + iLayer * 0.42) + height * 7.2 + iSeed * 17.0);
          float curl = sin(uTime * (0.34 + iSeed * 0.52) + height * 5.4 + iSeed * 11.0);
          float lick = sin(uTime * (1.15 + iLayer * 0.6) + height * 12.0 + iSeed * 31.0);
          float taper = mix(1.0, 0.045, pow(height, 1.36 + iLayer * 0.22));
          vec3 p = position;
          p.x = p.x * iScale.x * taper * depthScale + sway * (0.022 + iLayer * 0.024) * height * depthScale + curl * 0.026 * height * height + lick * 0.012 * pow(height, 2.2);
          p.y = p.y * iScale.y * (0.94 + lick * 0.035) * activityScale * depthScale + iScale.y * 0.5 * activityScale * depthScale;
          p += iOffset;
          p.x += (depth - iDepth) * 0.08;
          p.y += mix(-0.036, 0.024, depth);
          vDepth = depth;
          vPresence = presence;
          vFlicker = 0.7 + 0.3 * sin(uTime * (1.28 + iSeed * 1.4 + iLayer * 0.55) + iSeed * 24.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vSeed;
        varying float vLayer;
        varying float vOpacity;
        varying float vDepth;
        varying float vPresence;
        varying float vFlicker;

        void main() {
          float height = vUv.y;
          float center = abs(vUv.x - 0.5);
          float width = mix(0.46 + vLayer * 0.11, 0.022, pow(height, 1.22 + vLayer * 0.18));
          float body = smoothstep(width, width - 0.15, center);
          float inner = smoothstep(width * 0.46, width * 0.46 - 0.08, center);
          float core = smoothstep(width * 0.2, width * 0.2 - 0.055, center);
          float baseFade = smoothstep(0.0, 0.08, height);
          float tipFade = 1.0 - smoothstep(0.62 + vSeed * 0.12 + vLayer * 0.08, 1.0, height);
          float smokeBreak = 1.0 - smoothstep(0.62, 0.96, height) * (0.26 + vSeed * 0.18) * (1.0 - vLayer * 0.38);
          float notch = 0.72 + 0.28 * sin(height * (24.0 + vSeed * 5.0) + vSeed * 31.0);
          float ripple = (0.58 + 0.42 * sin(height * 19.0 + vSeed * 21.0)) * mix(notch, 1.0, vLayer);
          vec3 base = vec3(0.66, 0.08, 0.018);
          vec3 outer = vec3(0.96, 0.25, 0.035);
          vec3 mid = vec3(1.0, 0.62, 0.14);
          vec3 whiteHot = vec3(1.0, 0.92, 0.58);
          vec3 color = mix(base, outer, smoothstep(0.0, 0.22, height));
          color = mix(color, mid, inner * smoothstep(0.06, 0.78, height));
          color = mix(color, whiteHot, core * (1.0 - height * 0.54));
          color *= mix(0.72, 1.1, vDepth);
          float alpha = body * baseFade * tipFade * smokeBreak * ripple * vFlicker * vOpacity * mix(0.05, 1.0, vPresence) * mix(0.62, 1.16, vDepth) * (0.24 + inner * 0.22 + core * 0.36 + vLayer * 0.12);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const flames = new THREE.Mesh(flameGeometry, flameMaterial);
    scene.add(flames);
    disposables.push(flameBaseGeometry, flameGeometry, flameMaterial);

    const flareBaseGeometry = new THREE.PlaneGeometry(1, 1, 10, 24);
    const flareGeometry = new THREE.InstancedBufferGeometry();
    flareGeometry.index = flareBaseGeometry.index;
    flareGeometry.attributes.position = flareBaseGeometry.attributes.position;
    flareGeometry.attributes.uv = flareBaseGeometry.attributes.uv;
    flareGeometry.instanceCount = FLARE_COUNT;

    const flareSeeds = new Float32Array(FLARE_COUNT);
    for (let index = 0; index < FLARE_COUNT; index += 1) {
      flareSeeds[index] = Math.random();
    }
    flareGeometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(flareSeeds, 1));

    const flareMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        attribute float iSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying float vPresence;
        varying float vRand;

        float hash(float value) {
          return fract(sin(value) * 43758.5453123);
        }

        void main() {
          vUv = uv;
          float cycleLength = 7.2 + iSeed * 5.6;
          float cycle = floor((uTime + iSeed * 19.0) / cycleLength);
          float phase = fract((uTime + iSeed * 19.0) / cycleLength);
          float appear = smoothstep(0.06, 0.16, phase);
          float vanish = 1.0 - smoothstep(0.42, 0.72, phase);
          float presence = appear * vanish;
          float randX = hash(cycle * 13.17 + iSeed * 91.7);
          float randH = hash(cycle * 5.31 + iSeed * 37.2);
          float randW = hash(cycle * 2.27 + iSeed * 61.2);
          float baseX = mix(-1.36, 1.36, randX);
          float burstHeight = mix(0.62, 1.05, randH) * presence;
          float burstWidth = mix(0.045, 0.1, randW) * (0.7 + presence * 0.5);
          float height = uv.y;
          float taper = mix(1.0, 0.025, pow(height, 1.42));
          float sway = sin(uTime * 1.36 + height * 9.0 + iSeed * 13.0);
          vec3 p = position;
          p.x = p.x * burstWidth * taper + baseX + sway * 0.034 * height * presence;
          p.y = p.y * burstHeight + burstHeight * 0.5 - 0.86 + sin(uTime * 0.8 + iSeed * 11.0) * 0.014 * presence;
          p.z = 0.02;
          vPresence = presence;
          vRand = randH;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vPresence;
        varying float vRand;

        void main() {
          float height = vUv.y;
          float center = abs(vUv.x - 0.5);
          float width = mix(0.42, 0.02, pow(height, 1.22));
          float body = smoothstep(width, width - 0.16, center);
          float inner = smoothstep(width * 0.44, width * 0.44 - 0.09, center);
          float tipFade = 1.0 - smoothstep(0.78, 1.0, height);
          float baseFade = smoothstep(0.0, 0.08, height);
          vec3 color = mix(vec3(0.9, 0.14, 0.025), vec3(1.0, 0.76, 0.22), inner + height * 0.18);
          float alpha = body * baseFade * tipFade * vPresence * (0.22 + inner * 0.42 + vRand * 0.14);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const flares = new THREE.Mesh(flareGeometry, flareMaterial);
    scene.add(flares);
    disposables.push(flareBaseGeometry, flareGeometry, flareMaterial);

    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(SPARK_COUNT * 3);
    const sparkSeeds = new Float32Array(SPARK_COUNT);
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const hotspot = pickHotspot();
      const sparkFan = randomRange(-0.42, 0.42) + randomRange(-0.12, 0.12) * hotspot.sparkWeight;
      sparkPositions[index * 3] = hotspot.x + sparkFan;
      sparkPositions[index * 3 + 1] = randomRange(-0.9, 0.62);
      sparkPositions[index * 3 + 2] = 0;
      sparkSeeds[index] = Math.random();
    }
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute("seed", new THREE.BufferAttribute(sparkSeeds, 1));

    const sparkMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() }
      },
      vertexShader: `
        attribute float seed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vLife;
        varying float vSeed;

        void main() {
          vSeed = seed;
          vec3 p = position;
          float lift = mod(p.y + 0.86 + uTime * (0.05 + seed * 0.16) + seed * 1.85, 1.72) - 0.86;
          float life = smoothstep(-0.86, -0.12, lift) * (1.0 - smoothstep(0.58, 0.9, lift));
          p.y = lift;
          p.x += sin(uTime * (0.16 + seed * 0.44) + seed * 19.0) * 0.34 * life;
          p.x += cos(uTime * 0.09 + seed * 15.0) * 0.16 * life;
          p.x += (seed - 0.5) * 0.22 * life;
          vLife = life;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (3.8 + seed * 11.8) * (0.62 + life * 0.42) * uPixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vLife;
        varying float vSeed;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float glow = smoothstep(0.5, 0.0, length(uv));
          float core = smoothstep(0.18, 0.0, length(uv));
          vec3 color = mix(vec3(0.88, 0.2, 0.045), vec3(1.0, 0.7, 0.24), vSeed);
          float alpha = glow * (0.18 + core * 0.5) * vLife;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
    scene.add(sparks);
    disposables.push(sparkGeometry, sparkMaterial);

    const emberGeometry = new THREE.BufferGeometry();
    const emberPositions = new Float32Array(EMBER_COUNT * 3);
    const emberSeeds = new Float32Array(EMBER_COUNT);
    for (let index = 0; index < EMBER_COUNT; index += 1) {
      const hotspot = pickHotspot();
      emberPositions[index * 3] = hotspot.x + randomRange(-0.32, 0.32);
      emberPositions[index * 3 + 1] = hotspot.lift + randomRange(-0.055, 0.08);
      emberPositions[index * 3 + 2] = 0;
      emberSeeds[index] = Math.random();
    }
    emberGeometry.setAttribute("position", new THREE.BufferAttribute(emberPositions, 3));
    emberGeometry.setAttribute("seed", new THREE.BufferAttribute(emberSeeds, 1));

    const emberMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() }
      },
      vertexShader: `
        attribute float seed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vPulse;

        void main() {
          vPulse = 0.44 + 0.56 * sin(uTime * (0.7 + seed * 2.15) + seed * 28.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (3.8 + seed * 13.5) * uPixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vPulse;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float glow = smoothstep(0.5, 0.0, length(uv));
          vec3 color = mix(vec3(0.48, 0.035, 0.012), vec3(1.0, 0.42, 0.075), vPulse);
          gl_FragColor = vec4(color, glow * (0.12 + vPulse * 0.36));
        }
      `
    });

    const embers = new THREE.Points(emberGeometry, emberMaterial);
    scene.add(embers);
    disposables.push(emberGeometry, emberMaterial);

    const ashGeometry = new THREE.BufferGeometry();
    const ashPositions = new Float32Array(ASH_COUNT * 3);
    const ashSeeds = new Float32Array(ASH_COUNT);
    const ashSizes = new Float32Array(ASH_COUNT);
    const ashOpacities = new Float32Array(ASH_COUNT);
    const ashDepths = new Float32Array(ASH_COUNT);
    for (let index = 0; index < ASH_COUNT; index += 1) {
      const depth = Math.random();
      const wide = depth > 0.66 ? 6.4 : depth > 0.36 ? 5.8 : 5.1;
      ashPositions[index * 3] = randomRange(-wide * 0.5, wide * 0.5);
      ashPositions[index * 3 + 1] = randomRange(-0.52, 0.98);
      ashPositions[index * 3 + 2] = 0;
      ashSeeds[index] = Math.random();
      ashDepths[index] = depth;
      ashSizes[index] = depth > 0.66 ? randomRange(7, 12) : depth > 0.36 ? randomRange(4, 8) : randomRange(2, 5);
      ashOpacities[index] = depth > 0.66 ? randomRange(0.055, 0.12) : depth > 0.36 ? randomRange(0.04, 0.09) : randomRange(0.025, 0.06);
    }
    ashGeometry.setAttribute("position", new THREE.BufferAttribute(ashPositions, 3));
    ashGeometry.setAttribute("seed", new THREE.BufferAttribute(ashSeeds, 1));
    ashGeometry.setAttribute("size", new THREE.BufferAttribute(ashSizes, 1));
    ashGeometry.setAttribute("opacity", new THREE.BufferAttribute(ashOpacities, 1));
    ashGeometry.setAttribute("depth", new THREE.BufferAttribute(ashDepths, 1));

    const ashMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() }
      },
      vertexShader: `
        attribute float seed;
        attribute float size;
        attribute float opacity;
        attribute float depth;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vLife;
        varying float vSeed;
        varying float vOpacity;
        varying float vDepth;

        void main() {
          vSeed = seed;
          vOpacity = opacity;
          vDepth = depth;
          vec3 p = position;
          float drift = uTime * mix(0.018 + seed * 0.04, 0.008 + seed * 0.024, depth);
          float lift = mod(p.y + 0.66 + drift + seed * 1.84, 1.88) - 0.66;
          float life = smoothstep(-0.66, -0.2, lift) * (1.0 - smoothstep(0.66, 1.14, lift));
          p.y = lift;
          p.x += sin(uTime * (0.08 + seed * 0.18) + seed * 31.0) * mix(0.22, 0.52, depth);
          p.x += cos(uTime * (0.045 + depth * 0.025) + seed * 17.0) * mix(0.14, 0.34, depth);
          p.x += (seed - 0.5) * mix(0.24, 0.48, depth) * life;
          vLife = life;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = size * (0.65 + life * 0.24) * uPixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vLife;
        varying float vSeed;
        varying float vOpacity;
        varying float vDepth;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float radius = length(uv);
          float dust = smoothstep(0.52, 0.08, radius);
          float core = smoothstep(0.18, 0.0, radius);
          vec3 farDust = vec3(0.18, 0.16, 0.14);
          vec3 nearDust = vec3(0.48, 0.4, 0.32);
          vec3 color = mix(farDust, nearDust, vDepth);
          color = mix(color, vec3(0.76, 0.54, 0.36), core * 0.18 * vSeed);
          gl_FragColor = vec4(color, dust * vLife * vOpacity);
        }
      `
    });

    const ash = new THREE.Points(ashGeometry, ashMaterial);
    scene.add(ash);
    disposables.push(ashGeometry, ashMaterial);

    mount.appendChild(renderer.domElement);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(width, height, false);
      const aspect = width / Math.max(height, 1);
      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
    };

    let frame = 0;
    const startedAt = performance.now();
    let lastRenderAt = 0;
    const render = (timestamp = performance.now()) => {
      frame = window.requestAnimationFrame(render);
      if (timestamp - lastRenderAt < TARGET_FRAME_MS) {
        return;
      }
      lastRenderAt = timestamp - ((timestamp - lastRenderAt) % TARGET_FRAME_MS);
      const elapsed = (performance.now() - startedAt) / 1000;
      firebedMaterial.uniforms.uTime.value = elapsed;
      backWallFlareMaterial.uniforms.uTime.value = elapsed;
      flameMaterial.uniforms.uTime.value = elapsed;
      flareMaterial.uniforms.uTime.value = elapsed;
      sparkMaterial.uniforms.uTime.value = elapsed;
      emberMaterial.uniforms.uTime.value = elapsed;
      ashMaterial.uniforms.uTime.value = elapsed;
      renderer.render(scene, camera);
    };

    resize();
    window.addEventListener("resize", resize);
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      mount.removeChild(renderer.domElement);
      disposables.forEach((item) => item.dispose());
      renderer.dispose();
    };
  }, [lowPower]);

  return (
    <div className={`flame-scene ${fallbackActive ? "is-fallback" : ""} ${lowPower ? "is-low-power" : ""}`} aria-hidden="true">
      <img className="fireplace-backdrop" src={FIREPLACE_BACKGROUND_SRC} alt="" draggable={false} />
      <div className="flame-particle-layer" ref={mountRef}>
        {fallbackActive && !lowPower ? (
          <div className="flame-fallback">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>
    </div>
  );
}
