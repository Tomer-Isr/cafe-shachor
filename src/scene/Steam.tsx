import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Пар — шейдерное поле fbm на нескольких плоскостях.
 * Реализм даёт не число октав, а физика движения: поток ускоряется с высотой,
 * его сносит сквозняком, завихрения тянутся вслед за подъёмом (адвекция), а
 * видимость появляется не у самой кромки, а выше — там, где горячий воздух
 * успевает сконденсироваться.
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
  uniform vec2  uPointer;
  uniform float uPush;
  uniform float uTilt;      // 0 — чашка стоит, 1 — наклонена и льёт
  uniform vec3  uWarm;
  uniform vec3  uCool;

  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p, int octaves) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;

    // палец расталкивает поток: смещаем область выборки от точки указателя
    vec2 d = vWorld.xy - uPointer;
    float influence = exp(-dot(d, d) * 6.0) * uPush;
    uv += normalize(d + 1e-5) * influence * 0.2;

    float h = uv.y;                        // высота внутри слоя, 0 — у кромки

    // 1. Конус потока: у чашки узкий, кверху расходится и теряет форму
    vec2 p = uv;
    p.x = (p.x - 0.5) / mix(0.42, 2.0, pow(h, 0.8)) + 0.5;

    // 2. Сквозняк: медленный боковой снос, растущий с высотой — иначе столб стоит трубой
    float draft = sin(uTime * 0.23 + uSeed) * 0.55 + sin(uTime * 0.11 - uSeed * 1.7) * 0.3;
    p.x += draft * h * h * 0.18;

    // 3. Подъём с ускорением: верх уходит быстрее низа, поэтому клубы вытягиваются
    p.y -= uTime * (0.055 + h * 0.11);

    // 4. Двойной domain warp — то, что отличает пар от «телевизионного снега»
    float w1 = fbm(p * 2.6 + uSeed, 4);
    float w2 = fbm(p * 5.1 + vec2(w1 * 2.2, -uTime * 0.09) + uSeed * 0.5, 4);
    float density = fbm(p * 7.0 + vec2(w2 * 1.9, w1 * 1.2), 6);

    // 5. Маски: у кромки пар ещё прозрачный, вверху растворяется, по бокам рвётся
    float birth = smoothstep(0.02, 0.2, h);
    float fade  = smoothstep(1.0, 0.34, h);
    float sides = smoothstep(0.0, 0.3, uv.x) * smoothstep(1.0, 0.7, uv.x);

    float a = density * birth * fade * sides * uIntensity;

    // 6. Рваные края: степень делает границу клубов неровной, а не ватной
    a = pow(smoothstep(0.2, 0.84, a), 1.45);
    a *= 1.0 - influence * 0.6;
    a *= mix(1.0, 0.45, uTilt);

    if (a < 0.003) discard;

    // у чашки пар подсвечен тёплым, выше уходит в холодный и теряет плотность
    vec3 tint = mix(uWarm, uCool, smoothstep(0.1, 0.85, h));
    gl_FragColor = vec4(tint, a);
  }
`

interface Props {
  pointerWorld: React.RefObject<THREE.Vector2>
  paused: boolean
  intensity: number
  tiltRef: React.RefObject<number>
  /** мировая точка поверхности кофе: источник пара едет вместе с чашкой */
  anchorRef: React.RefObject<THREE.Vector3>
}

export function Steam({ pointerWorld, paused, intensity, tiltRef, anchorRef }: Props) {
  const group = useRef<THREE.Group>(null)
  const materials = useRef<THREE.ShaderMaterial[]>([])

  // слои с разной скоростью и плотностью: один слой всегда читается плоской картинкой
  const layers = useMemo(
    () => [
      { z: -0.16, scale: 1.2, seed: 0.0, opacity: 0.46, speed: 0.85 },
      { z: -0.04, scale: 0.95, seed: 4.7, opacity: 0.8, speed: 1.0 },
      { z: 0.09, scale: 0.8, seed: 9.3, opacity: 0.55, speed: 1.18 },
      { z: 0.2, scale: 0.66, seed: 13.1, opacity: 0.32, speed: 1.4 },
    ],
    [],
  )

  const warm = useMemo(() => new THREE.Color('#f0e0c9'), [])
  const cool = useMemo(() => new THREE.Color('#9aa3ab'), [])

  useFrame((_, delta) => {
    const p = pointerWorld.current ?? new THREE.Vector2()
    const tilt = tiltRef.current ?? 0
    const anchor = anchorRef.current
    if (group.current && anchor) {
      // плоскости пара стоят над поверхностью кофе и едут вместе с ней
      group.current.position.set(anchor.x, anchor.y + 0.58, anchor.z)
    }
    materials.current.forEach((m, i) => {
      if (!m) return
      if (!paused) m.uniforms.uTime.value += delta * layers[i].speed
      m.uniforms.uPointer.value.set(p.x, p.y)
      m.uniforms.uPush.value = THREE.MathUtils.damp(m.uniforms.uPush.value, paused ? 0 : 1, 3, delta)
      m.uniforms.uIntensity.value = layers[i].opacity * intensity
      m.uniforms.uTilt.value = tilt
    })
  })

  return (
    <group ref={group} position={[0, 1.05, 0]}>
      {layers.map((l, i) => (
        <mesh key={i} position={[0, 0, l.z]} scale={[l.scale, l.scale, 1]}>
          <planeGeometry args={[1.25, 1.25, 1, 1]} />
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
              uTime: { value: l.seed * 3.1 },
              uIntensity: { value: l.opacity * intensity },
              uSeed: { value: l.seed },
              uPointer: { value: new THREE.Vector2(999, 999) },
              uPush: { value: 0 },
              uTilt: { value: 0 },
              uWarm: { value: warm },
              uCool: { value: cool },
            }}
          />
        </mesh>
      ))}
    </group>
  )
}
