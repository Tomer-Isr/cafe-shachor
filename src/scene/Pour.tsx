import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Налив. Солвер жидкости не пишем — вместо него собраны признаки, по которым
 * человек узнаёт настоящую струю (см. docs/3d-liquid-particles-playbook.md §0):
 *
 *  1. струя падает вертикально независимо от наклона сосуда;
 *  2. книзу она тоньше — поток ускоряется, сечение сужается;
 *  3. ближе к концу сплошная нить рвётся на капли (неустойчивость Плато–Рэлея);
 *  4. в точке удара разлетаются брызги по конусу и падают обратно;
 *  5. по луже расходятся круги, а край её держит светлый мениск.
 *
 * Всё это — инстансы и шейдеры, ни одной физической итерации.
 */

interface Props {
  /** мировая точка схода с кромки */
  originRef: React.RefObject<THREE.Vector3>
  /** 0 — не льём, 1 — полный поток */
  flowRef: React.RefObject<number>
  paused: boolean
  /** брызги дорогие на слабых устройствах — на мобиле их меньше */
  splashCount?: number
}

const FALL = 1.32
const DROPS = 16

/** Струя гаснет книзу: там сплошная нить уже распалась на капли */
const streamFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vNormalV;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;

  void main() {
    // vUv.y: 1 у кромки, 0 у камня (геометрия сдвинута вниз)
    float h = vUv.y;

    // распад: чем ниже, тем рванее край — режем альфу продольной волной
    float ripple = sin(vUv.x * 18.0 + uTime * 9.0) * 0.5 + 0.5;
    float breakup = smoothstep(0.0, 0.55, h) + ripple * 0.28 * (1.0 - h);
    float a = clamp(breakup, 0.0, 1.0) * uOpacity;

    // блик по краю: жидкость видно не цветом, а тем, как она ловит свет
    float rim = pow(1.0 - abs(dot(normalize(vNormalV), vec3(0.0, 0.0, 1.0))), 1.6);
    vec3 color = uColor + rim * vec3(0.55, 0.38, 0.24);

    if (a < 0.02) discard;
    gl_FragColor = vec4(color, a);
  }
`

const streamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  void main() {
    vUv = uv;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export function Pour({ originRef, flowRef, paused, splashCount = 140 }: Props) {
  const stream = useRef<THREE.Mesh>(null)
  const streamMat = useRef<THREE.ShaderMaterial>(null)
  const drops = useRef<THREE.InstancedMesh>(null)
  const splash = useRef<THREE.InstancedMesh>(null)
  const puddle = useRef<THREE.Group>(null)
  const puddleMat = useRef<THREE.MeshPhysicalMaterial>(null)
  const ripples = useRef<THREE.Mesh>(null)
  const rippleMat = useRef<THREE.ShaderMaterial>(null)
  const time = useRef(0)

  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.05, 0.021, FALL, 16, 44, true)
    g.translate(0, -FALL / 2, 0)
    return g
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  // Брызги: у каждой частицы своя стартовая скорость по конусу и своя фаза.
  // Считаем на CPU — для 140 штук это дешевле, чем заводить FBO-симуляцию.
  const sparks = useMemo(
    () =>
      Array.from({ length: splashCount }, (_, i) => {
        const angle = (i / splashCount) * Math.PI * 2 + (i % 7) * 0.31
        const speed = 0.55 + ((i * 37) % 100) / 260
        return {
          dirX: Math.cos(angle) * speed,
          dirZ: Math.sin(angle) * speed,
          up: 0.75 + ((i * 53) % 100) / 190,
          life: 0.42 + ((i * 29) % 100) / 320,
          phase: ((i * 61) % 100) / 100,
          size: 0.1 + ((i * 17) % 100) / 420,
        }
      }),
    [splashCount],
  )

  useFrame((_, delta) => {
    if (!paused) time.current += delta
    const t = time.current
    const flow = flowRef.current ?? 0
    const origin = originRef.current
    if (!origin) return

    const height = Math.max(0.05, origin.y - 0.004)

    // ── струя ────────────────────────────────────────────────────────────
    if (stream.current && streamMat.current) {
      stream.current.visible = flow > 0.02
      const thickness = THREE.MathUtils.smoothstep(flow, 0, 0.55)
      stream.current.position.copy(origin)
      stream.current.scale.set(
        0.4 + thickness * 0.8,
        (height / FALL) * Math.min(1, flow * 1.9),
        0.4 + thickness * 0.8,
      )
      // дрожь: живая нить вместо трубы
      stream.current.rotation.z = Math.sin(t * 7.3) * 0.014 * flow
      stream.current.rotation.x = Math.sin(t * 5.1 + 1.3) * 0.011 * flow
      streamMat.current.uniforms.uTime.value = t
      streamMat.current.uniforms.uOpacity.value = Math.min(1, flow * 2.2)
    }

    // ── капли: продолжение струи там, где нить уже распалась ──────────────
    if (drops.current) {
      drops.current.visible = flow > 0.2
      for (let i = 0; i < DROPS; i++) {
        const speed = 0.9 + (i % 5) * 0.14
        const phase = (t * speed + i * 0.41) % 1
        // капли живут в нижней половине падения — вверху ещё сплошная струя
        const y = origin.y - height * (0.45 + phase * 0.55)
        dummy.position.set(
          origin.x + Math.sin(i * 2.1 + t * 3.4) * 0.014,
          y,
          origin.z + Math.cos(i * 1.7 + t * 2.9) * 0.014,
        )
        const grow = 0.5 + phase * 0.6
        dummy.scale.setScalar(grow * Math.min(1, flow * 1.6))
        dummy.updateMatrix()
        drops.current.setMatrixAt(i, dummy.matrix)
      }
      drops.current.instanceMatrix.needsUpdate = true
    }

    // ── брызги удара: конус вверх-вбок, гравитация, затухание ─────────────
    if (splash.current) {
      splash.current.visible = flow > 0.3
      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i]
        const age = ((t / s.life + s.phase) % 1) * s.life
        const x = origin.x + s.dirX * age
        const z = origin.z + s.dirZ * age
        // парабола: подлетели и упали обратно на камень
        const y = 0.006 + s.up * age - 4.9 * age * age * 0.5
        const alive = y > 0.004
        const fade = 1 - age / s.life
        dummy.position.set(x, Math.max(0.004, y), z)
        dummy.scale.setScalar(alive ? s.size * fade * Math.min(1, flow * 1.4) : 0.0001)
        dummy.updateMatrix()
        splash.current.setMatrixAt(i, dummy.matrix)
      }
      splash.current.instanceMatrix.needsUpdate = true
    }

    // ── лужа: растёт по объёму вылитого ──────────────────────────────────
    if (puddle.current && puddleMat.current) {
      const target = flow > 0.05 ? 0.2 + flow * 0.26 : 0
      const s = THREE.MathUtils.damp(puddle.current.scale.x, target, 1.4, delta)
      puddle.current.scale.setScalar(Math.max(0.0001, s))
      puddle.current.visible = s > 0.01
      puddle.current.position.set(origin.x, 0.004, origin.z)
      puddleMat.current.opacity = THREE.MathUtils.clamp(s * 2.4, 0, 1)
    }

    // ── круги по луже от падающей струи ──────────────────────────────────
    if (ripples.current && rippleMat.current) {
      ripples.current.visible = flow > 0.15
      ripples.current.position.set(origin.x, 0.0075, origin.z)
      const s = 0.2 + flow * 0.26
      ripples.current.scale.setScalar(s)
      rippleMat.current.uniforms.uTime.value = t
      rippleMat.current.uniforms.uStrength.value = flow
    }
  })

  return (
    <group>
      <mesh ref={stream} geometry={geo} visible={false}>
        <shaderMaterial
          ref={streamMat}
          vertexShader={streamVertex}
          fragmentShader={streamFragment}
          transparent
          depthWrite={false}
          uniforms={{
            uColor: { value: new THREE.Color('#3d1d0c') },
            uOpacity: { value: 0 },
            uTime: { value: 0 },
          }}
        />
      </mesh>

      <instancedMesh ref={drops} args={[undefined, undefined, DROPS]} visible={false}>
        <sphereGeometry args={[0.019, 10, 8]} />
        <meshPhysicalMaterial color="#2a1409" roughness={0.06} metalness={0.1} envMapIntensity={3.4} />
      </instancedMesh>

      <instancedMesh ref={splash} args={[undefined, undefined, splashCount]} visible={false}>
        <sphereGeometry args={[0.017, 8, 6]} />
        <meshPhysicalMaterial color="#5b3116" roughness={0.04} metalness={0.2} envMapIntensity={4.6} />
      </instancedMesh>

      <group ref={puddle} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} visible={false}>
        <mesh>
          <circleGeometry args={[1, 72]} />
          <meshPhysicalMaterial
            ref={puddleMat}
            color="#241207"
            roughness={0.03}
            metalness={0.55}
            envMapIntensity={4.5}
            transparent
            opacity={0}
          />
        </mesh>
        {/* мениск: у настоящей лужи край светлее — там собирается блик */}
        <mesh position={[0, 0, 0.0006]}>
          <ringGeometry args={[0.95, 1.01, 72]} />
          <meshPhysicalMaterial color="#3b1e0e" roughness={0.1} metalness={0.25} envMapIntensity={2.2} transparent opacity={0.4} />
        </mesh>
      </group>

      {/* волны расходятся кругами от точки падения и гаснут к краю */}
      <mesh ref={ripples} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[1, 64]} />
        <shaderMaterial
          ref={rippleMat}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{ uTime: { value: 0 }, uStrength: { value: 0 } }}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            precision highp float;
            varying vec2 vUv;
            uniform float uTime;
            uniform float uStrength;
            void main() {
              float r = length(vUv - 0.5) * 2.0;
              // три волны, бегущие наружу с разной фазой
              float w = sin(r * 26.0 - uTime * 6.0) * 0.5 + 0.5;
              w *= sin(r * 13.0 - uTime * 3.4) * 0.5 + 0.5;
              float mask = smoothstep(1.0, 0.15, r) * smoothstep(0.02, 0.16, r);
              float a = w * mask * uStrength * 0.14;
              if (a < 0.004) discard;
              gl_FragColor = vec4(vec3(0.5, 0.33, 0.2) * a, a);
            }
          `}
        />
      </mesh>
    </group>
  )
}
