import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const FIREPLACE_BACKGROUND_SRC = "/assets/fireplace-bg-2560x720.png";
const FLAME_COUNT = 24;
const SPARK_COUNT = 680;
const EMBER_COUNT = 600;
const ASH_COUNT = 640;

export function FlameScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [fallbackActive, setFallbackActive] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

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
        powerPreference: "high-performance"
      });
    } catch {
      setFallbackActive(true);
      return;
    }

    setFallbackActive(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;

    const disposables: Array<{ dispose: () => void }> = [];

    const flameBaseGeometry = new THREE.PlaneGeometry(1, 1, 12, 28);
    const flameGeometry = new THREE.InstancedBufferGeometry();
    flameGeometry.index = flameBaseGeometry.index;
    flameGeometry.attributes.position = flameBaseGeometry.attributes.position;
    flameGeometry.attributes.uv = flameBaseGeometry.attributes.uv;
    flameGeometry.instanceCount = FLAME_COUNT;

    const flameOffsets = new Float32Array(FLAME_COUNT * 3);
    const flameScales = new Float32Array(FLAME_COUNT * 2);
    const flameSeeds = new Float32Array(FLAME_COUNT);
    for (let index = 0; index < FLAME_COUNT; index += 1) {
      const lane = index / Math.max(1, FLAME_COUNT - 1);
      const centerBias = Math.sin(lane * Math.PI);
      flameOffsets[index * 3] = (lane - 0.5) * 2.5 + (Math.random() - 0.5) * 0.14;
      flameOffsets[index * 3 + 1] = -0.81 + Math.random() * 0.07;
      flameOffsets[index * 3 + 2] = 0;
      flameScales[index * 2] = 0.07 + Math.random() * 0.085 + centerBias * 0.03;
      flameScales[index * 2 + 1] = 0.18 + Math.random() * 0.2 + centerBias * 0.11;
      flameSeeds[index] = Math.random();
    }

    flameGeometry.setAttribute("iOffset", new THREE.InstancedBufferAttribute(flameOffsets, 3));
    flameGeometry.setAttribute("iScale", new THREE.InstancedBufferAttribute(flameScales, 2));
    flameGeometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(flameSeeds, 1));

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
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFlicker;

        void main() {
          vUv = uv;
          vSeed = iSeed;
          float height = uv.y;
          float sway = sin(uTime * (0.85 + iSeed * 0.55) + height * 7.0 + iSeed * 17.0);
          float curl = sin(uTime * (0.4 + iSeed * 0.5) + height * 4.0 + iSeed * 11.0);
          float taper = mix(1.0, 0.08, pow(height, 1.48));
          vec3 p = position;
          p.x = p.x * iScale.x * taper + sway * 0.035 * height + curl * 0.022 * height * height;
          p.y = p.y * iScale.y + iScale.y * 0.5;
          p += iOffset;
          vFlicker = 0.78 + 0.22 * sin(uTime * (1.45 + iSeed * 1.1) + iSeed * 24.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vSeed;
        varying float vFlicker;

        void main() {
          float height = vUv.y;
          float center = abs(vUv.x - 0.5);
          float width = mix(0.5, 0.035, pow(height, 1.22));
          float body = smoothstep(width, width - 0.13, center);
          float core = smoothstep(width * 0.28, width * 0.28 - 0.065, center);
          float baseFade = smoothstep(0.0, 0.1, height);
          float tipFade = 1.0 - smoothstep(0.58 + vSeed * 0.1, 0.94, height);
          float ripple = 0.68 + 0.32 * sin(height * 18.0 + vSeed * 21.0);
          vec3 outer = vec3(0.92, 0.22, 0.04);
          vec3 mid = vec3(1.0, 0.58, 0.14);
          vec3 whiteHot = vec3(1.0, 0.9, 0.54);
          vec3 color = mix(outer, mid, smoothstep(0.1, 0.76, height));
          color = mix(color, whiteHot, core * (1.0 - height * 0.48));
          float alpha = body * baseFade * tipFade * ripple * vFlicker * (0.17 + core * 0.34);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const flames = new THREE.Mesh(flameGeometry, flameMaterial);
    scene.add(flames);
    disposables.push(flameBaseGeometry, flameGeometry, flameMaterial);

    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(SPARK_COUNT * 3);
    const sparkSeeds = new Float32Array(SPARK_COUNT);
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      sparkPositions[index * 3] = (Math.random() - 0.5) * 6.2;
      sparkPositions[index * 3 + 1] = -0.82 + Math.random() * 1.45;
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
          float lift = mod(p.y + 0.86 + uTime * (0.06 + seed * 0.18) + seed * 1.85, 1.7) - 0.86;
          float life = smoothstep(-0.86, -0.1, lift) * (1.0 - smoothstep(0.58, 0.84, lift));
          p.y = lift;
          p.x += sin(uTime * (0.18 + seed * 0.48) + seed * 19.0) * 0.24 * life;
          p.x += (seed - 0.5) * 0.16 * life;
          vLife = life;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (4.0 + seed * 10.2) * (0.66 + life * 0.34) * uPixelRatio;
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
          vec3 color = mix(vec3(0.9, 0.24, 0.055), vec3(1.0, 0.66, 0.22), vSeed);
          float alpha = glow * (0.22 + core * 0.46) * vLife;
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
      emberPositions[index * 3] = (Math.random() - 0.5) * 5.4;
      emberPositions[index * 3 + 1] = -0.88 + Math.random() * 0.24;
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
          vPulse = 0.48 + 0.52 * sin(uTime * (0.9 + seed * 2.6) + seed * 28.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (3.4 + seed * 10.8) * uPixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vPulse;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float glow = smoothstep(0.5, 0.0, length(uv));
          vec3 color = mix(vec3(0.7, 0.08, 0.018), vec3(1.0, 0.38, 0.07), vPulse);
          gl_FragColor = vec4(color, glow * (0.14 + vPulse * 0.34));
        }
      `
    });

    const embers = new THREE.Points(emberGeometry, emberMaterial);
    scene.add(embers);
    disposables.push(emberGeometry, emberMaterial);

    const ashGeometry = new THREE.BufferGeometry();
    const ashPositions = new Float32Array(ASH_COUNT * 3);
    const ashSeeds = new Float32Array(ASH_COUNT);
    for (let index = 0; index < ASH_COUNT; index += 1) {
      ashPositions[index * 3] = (Math.random() - 0.5) * 6.8;
      ashPositions[index * 3 + 1] = -0.58 + Math.random() * 1.5;
      ashPositions[index * 3 + 2] = 0;
      ashSeeds[index] = Math.random();
    }
    ashGeometry.setAttribute("position", new THREE.BufferAttribute(ashPositions, 3));
    ashGeometry.setAttribute("seed", new THREE.BufferAttribute(ashSeeds, 1));

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
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vLife;
        varying float vSeed;

        void main() {
          vSeed = seed;
          vec3 p = position;
          float drift = uTime * (0.012 + seed * 0.042);
          float lift = mod(p.y + 0.62 + drift + seed * 1.76, 1.76) - 0.62;
          float life = smoothstep(-0.62, -0.22, lift) * (1.0 - smoothstep(0.66, 1.08, lift));
          p.y = lift;
          p.x += sin(uTime * (0.1 + seed * 0.22) + seed * 31.0) * (0.28 + seed * 0.26);
          p.x += cos(uTime * 0.06 + seed * 17.0) * 0.22;
          p.x += (seed - 0.5) * 0.34 * life;
          vLife = life;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (3.2 + seed * 8.8) * uPixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vLife;
        varying float vSeed;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dust = smoothstep(0.5, 0.0, length(uv));
          vec3 color = mix(vec3(0.14, 0.13, 0.12), vec3(0.4, 0.34, 0.28), vSeed);
          gl_FragColor = vec4(color, dust * vLife * (0.08 + vSeed * 0.15));
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
    const render = () => {
      frame = window.requestAnimationFrame(render);
      const elapsed = (performance.now() - startedAt) / 1000;
      flameMaterial.uniforms.uTime.value = elapsed;
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
  }, []);

  return (
    <div className={`flame-scene ${fallbackActive ? "is-fallback" : ""}`} aria-hidden="true">
      <img className="fireplace-backdrop" src={FIREPLACE_BACKGROUND_SRC} alt="" draggable={false} />
      <div className="flame-particle-layer" ref={mountRef}>
        {fallbackActive ? (
          <div className="flame-fallback">
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
