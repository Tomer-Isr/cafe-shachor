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
  uniform float uGate;      // 0 — чашка пуста и пара нет, 1 — полна и горяча
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

    // 1. Конус потока: у чашки узкий, кверху расходится и теряет форму.
    //    Раньше верх раздувался в 2 раза — получалось облако во весь кадр;
    //    у настоящего пара над эспрессо конус куда скромнее.
    vec2 p = uv;
    p.x = (p.x - 0.5) / mix(0.3, 1.05, pow(h, 0.7)) + 0.5;

    // 2. Сквозняк: медленный боковой снос, растущий с высотой — иначе столб стоит трубой
    float draft = sin(uTime * 0.23 + uSeed) * 0.55 + sin(uTime * 0.11 - uSeed * 1.7) * 0.3;
    p.x += draft * h * h * 0.18;

    // 3. Подъём с ускорением: верх уходит быстрее низа, поэтому клубы вытягиваются
    p.y -= uTime * (0.055 + h * 0.11);

    // 4. Двойной domain warp — то, что отличает пар от «телевизионного снега».
    //    Поле сжато по горизонтали и растянуто по вертикали: пар идёт нитями,
    //    вытянутыми потоком, а не круглыми клубами дыма.
    vec2 q = vec2(p.x * 2.2, p.y * 0.85);
    float w1 = fbm(q * 3.4 + uSeed, 4);
    float w2 = fbm(q * 6.2 + vec2(w1 * 1.8, -uTime * 0.09) + uSeed * 0.5, 4);
    float density = fbm(q * 9.5 + vec2(w2 * 1.6, w1 * 1.0), 5);

    // 5. Маски: у кромки пар ещё прозрачный, вверху растворяется, по бокам рвётся.
    //    Верх гасится вдвое раньше прежнего — струйка живёт две-три высоты чашки,
    //    а не до края экрана.
    float birth = smoothstep(0.0, 0.13, h);
    float fade  = smoothstep(0.72, 0.16, h);
    float sides = smoothstep(0.0, 0.34, uv.x) * smoothstep(1.0, 0.66, uv.x);

    float a = density * birth * fade * sides * uIntensity;

    // 6. Порог выше и степень круче: остаются только плотные жилы потока,
    //    вся ватная масса между ними уходит в ноль.
    a = pow(smoothstep(0.42, 0.92, a), 2.1);
    a *= 1.0 - influence * 0.6;
    a *= uGate;

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
  /** насколько чашка полна: от пустой посуды пар не идёт */
  fillRef: React.RefObject<number>
  /** мировая точка поверхности кофе: источник пара едет вместе с чашкой */
  anchorRef: React.RefObject<THREE.Vector3>
}

export function Steam({ pointerWorld, paused, intensity, fillRef, anchorRef }: Props) {
  const group = useRef<THREE.Group>(null)
  const materials = useRef<THREE.ShaderMaterial[]>([])

  // Слои с разной скоростью: один слой всегда читается плоской картинкой.
  // Плотность срезана втрое против прежней — пар над чашкой почти не виден,
  // и именно этим отличается от дыма.
  const layers = useMemo(
    () => [
      { z: -0.1, scale: 1.0, seed: 0.0, opacity: 0.16, speed: 0.85 },
      { z: 0.0, scale: 0.82, seed: 4.7, opacity: 0.26, speed: 1.0 },
      { z: 0.1, scale: 0.62, seed: 9.3, opacity: 0.15, speed: 1.22 },
    ],
    [],
  )

  // Пар не белый: он подкрашен тем, что его освещает. Белый выдаёт «дым из аэрозоли».
  const warm = useMemo(() => new THREE.Color('#cdbba4'), [])
  const cool = useMemo(() => new THREE.Color('#6f7780'), [])

  useFrame((_, delta) => {
    const p = pointerWorld.current ?? new THREE.Vector2()
    const fill = fillRef.current ?? 0
    const anchor = anchorRef.current
    if (group.current && anchor) {
      // плоскости пара стоят над поверхностью кофе и едут вместе с ней
      group.current.position.set(anchor.x, anchor.y + 0.44, anchor.z)
    }
    materials.current.forEach((m, i) => {
      if (!m) return
      if (!paused) m.uniforms.uTime.value += delta * layers[i].speed
      m.uniforms.uPointer.value.set(p.x, p.y)
      m.uniforms.uPush.value = THREE.MathUtils.damp(m.uniforms.uPush.value, paused ? 0 : 1, 3, delta)
      m.uniforms.uIntensity.value = layers[i].opacity * intensity
      m.uniforms.uGate.value = THREE.MathUtils.smoothstep(fill, 0.08, 0.45)
    })
  })

  return (
    <group ref={group} position={[0, 1.05, 0]}>
      {layers.map((l, i) => (
        <mesh key={i} position={[0, 0, l.z]} scale={[l.scale, l.scale, 1]}>
          <planeGeometry args={[0.72, 0.95, 1, 1]} />
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
              uGate: { value: 0 },
              uWarm: { value: warm },
              uCool: { value: cool },
            }}
          />
        </mesh>
      ))}
    </group>
  )
}
