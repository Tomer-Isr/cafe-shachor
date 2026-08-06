import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Пар — не спрайты и не видео, а шейдерное поле fbm-шума на трёх плоскостях.
 * Курсор расталкивает пар (та же идея, что «след на снегу» в геймдеве: воздействие
 * считается прямо в шейдере от позиции указателя, без физики).
 */

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorld;

  uniform float uTime;
  uniform float uIntensity;
  uniform float uSeed;
  uniform vec2  uPointer;   // позиция указателя в мировых координатах (плоскость пара)
  uniform float uPush;      // сила расталкивания
  uniform vec3  uTint;

  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // domain warping: без него шум читается как «телевизионный снег», а не как пар
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.02 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;

    // расталкивание указателем — по мировым координатам, чтобы работало на всех трёх плоскостях
    vec2 d = vWorld.xy - uPointer;
    float dist2 = dot(d, d);
    float influence = exp(-dist2 * 6.0) * uPush;
    uv += normalize(d + 1e-5) * influence * 0.22;

    // поднимающийся поток + расширение кверху
    vec2 p = uv;
    p.x = (p.x - 0.5) / mix(0.75, 1.9, uv.y) + 0.5;
    p.y -= uTime * 0.085;

    float warp = fbm(p * 3.0 + uSeed);
    float density = fbm(p * 4.5 + vec2(warp * 1.6, uTime * 0.05) + uSeed);

    // маски: гасим по краям и у самой кромки чашки, вверху растворяем
    float edgeX = smoothstep(0.0, 0.36, uv.x) * smoothstep(1.0, 0.64, uv.x);
    float rise  = smoothstep(0.0, 0.07, uv.y) * smoothstep(1.05, 0.3, uv.y);

    float a = density * edgeX * rise * uIntensity;
    a = smoothstep(0.2, 0.86, a);
    a *= 1.0 - influence * 0.55;   // там, где «раздвинули», пара меньше

    if (a < 0.002) discard;
    gl_FragColor = vec4(uTint, a);
  }
`

interface Props {
  pointerWorld: React.RefObject<THREE.Vector2>
  paused: boolean
  intensity: number
}

export function Steam({ pointerWorld, paused, intensity }: Props) {
  const materials = useRef<THREE.ShaderMaterial[]>([])

  const layers = useMemo(
    () => [
      { z: -0.14, scale: 1.15, seed: 0.0, opacity: 0.55, tint: new THREE.Color('#cdbba6') },
      { z: 0.0, scale: 1.0, seed: 4.7, opacity: 0.85, tint: new THREE.Color('#efe4d4') },
      { z: 0.13, scale: 0.82, seed: 9.3, opacity: 0.5, tint: new THREE.Color('#b9a894') },
    ],
    [],
  )

  useFrame((_, delta) => {
    const p = pointerWorld.current ?? new THREE.Vector2()
    materials.current.forEach((m, i) => {
      if (!m) return
      if (!paused) m.uniforms.uTime.value += delta
      m.uniforms.uPointer.value.set(p.x, p.y)
      m.uniforms.uPush.value = THREE.MathUtils.damp(m.uniforms.uPush.value, paused ? 0 : 1, 3, delta)
      // плотность живёт в твиках — читаем каждый кадр, иначе ползунок не двигал бы картинку
      m.uniforms.uIntensity.value = layers[i].opacity * intensity
    })
  })

  return (
    <group position={[0, 0.98, 0]}>
      {layers.map((l, i) => (
        <mesh key={i} position={[0, 0, l.z]} scale={[l.scale, l.scale, 1]}>
          <planeGeometry args={[1.15, 1.1, 1, 1]} />
          <shaderMaterial
            ref={(m) => {
              if (m) materials.current[i] = m
            }}
            vertexShader={vertex}
            fragmentShader={fragment}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={{
              uTime: { value: l.seed },
              uIntensity: { value: l.opacity * intensity },
              uSeed: { value: l.seed },
              uPointer: { value: new THREE.Vector2(999, 999) },
              uPush: { value: 0 },
              uTint: { value: l.tint },
            }}
          />
        </mesh>
      ))}
    </group>
  )
}
