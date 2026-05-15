import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const PARTICLE_COUNT = 540;

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
    renderer.setClearColor(0x080a0f, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 8);

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT);

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.35 + Math.random() * 3.4;
      positions[index * 3] = Math.cos(angle) * radius * 1.25;
      positions[index * 3 + 1] = -2.2 + Math.random() * 3.8;
      positions[index * 3 + 2] = Math.sin(angle) * radius * 0.24;
      seeds[index] = Math.random();
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
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
        varying float vSeed;
        varying float vLift;

        void main() {
          vSeed = seed;
          vec3 p = position;
          float t = uTime * (0.35 + seed * 0.8);
          float lift = mod(p.y + 2.4 + t + seed * 3.0, 4.6) - 2.2;
          float taper = smoothstep(2.4, -1.8, lift);
          p.x += sin(t * 2.4 + seed * 19.0) * 0.34 * taper;
          p.z += cos(t * 1.8 + seed * 11.0) * 0.12;
          p.y = lift;
          vLift = smoothstep(-2.2, 2.4, lift);

          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (44.0 + seed * 90.0) * (1.0 - vLift * 0.42) * uPixelRatio / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vSeed;
        varying float vLift;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          float glow = smoothstep(0.5, 0.0, dist);
          float core = smoothstep(0.18, 0.0, dist);
          vec3 ember = mix(vec3(0.75, 0.13, 0.03), vec3(1.0, 0.72, 0.18), core);
          vec3 smoke = vec3(0.12, 0.04, 0.02);
          vec3 color = mix(ember, smoke, vLift * 0.42);
          float alpha = glow * (0.18 + core * 0.72) * (1.0 - vLift * 0.52);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const points = new THREE.Points(geometry, material);
    points.rotation.x = -0.04;
    scene.add(points);

    const emberGeometry = new THREE.CircleGeometry(3.8, 64);
    const emberMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5a12,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending
    });
    const ember = new THREE.Mesh(emberGeometry, emberMaterial);
    ember.position.set(0, -2.25, -0.6);
    ember.scale.set(1.8, 0.22, 1);
    scene.add(ember);

    mount.appendChild(renderer.domElement);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };

    let frame = 0;
    const clock = new THREE.Clock();
    const render = () => {
      frame = window.requestAnimationFrame(render);
      material.uniforms.uTime.value = clock.getElapsedTime();
      points.rotation.y = Math.sin(material.uniforms.uTime.value * 0.12) * 0.04;
      emberMaterial.opacity = 0.12 + Math.sin(material.uniforms.uTime.value * 1.4) * 0.025;
      renderer.render(scene, camera);
    };

    resize();
    window.addEventListener("resize", resize);
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      mount.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      emberGeometry.dispose();
      emberMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className={`flame-scene ${fallbackActive ? "is-fallback" : ""}`} ref={mountRef} aria-hidden="true">
      {fallbackActive ? (
        <div className="flame-fallback">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </div>
  );
}
