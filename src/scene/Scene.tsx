import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, MeshReflectorMaterial, PerformanceMonitor } from '@react-three/drei'
import { Bloom, DepthOfField, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Cup } from './Cup'
import { Pour } from './Pour'
import { Steam } from './Steam'
import { stoneMaps } from '../lib/procedural'

/** точка фокуса: чашка стоит здесь и остаётся резкой на любой дистанции */
const FOCUS_TARGET = new THREE.Vector3(0, 0.42, 0)

export interface SceneSettings {
  steam: number
  bloom: number
  grain: number
  focus: number
}

interface Props {
  paused: boolean
  settings: SceneSettings
  scrollRef: React.RefObject<number>
}

/** Стойка: тёмный полированный известняк. Отражение — половина «дороговизны» кадра. */
function Counter() {
  const { color, roughness } = useMemo(() => {
    const m = stoneMaps(512)
    m.color.repeat.set(4, 4)
    m.roughness.repeat.set(4, 4)
    return m
  }, [])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[26, 26]} />
      <MeshReflectorMaterial
        map={color}
        roughnessMap={roughness}
        resolution={512}
        mixBlur={0.85}
        mixStrength={2.8}
        blur={[190, 48]}
        mirror={0.55}
        depthScale={0.9}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.2}
        metalness={0.12}
        roughness={0.75}
        color="#3b332b"
      />
    </mesh>
  )
}

/** Стена свода за стойкой: далеко, в тумане — даёт сцене помещение, а не пустоту */
export function BackWall() {
  const { color, roughness } = useMemo(() => {
    const m = stoneMaps(512)
    m.color.repeat.set(6, 2)
    m.roughness.repeat.set(6, 2)
    return m
  }, [])
  return (
    <mesh position={[0, 2.1, -4.2]} receiveShadow>
      <planeGeometry args={[22, 9]} />
      <meshStandardMaterial map={color} roughnessMap={roughness} color="#0d0a08" roughness={0.98} metalness={0} />
    </mesh>
  )
}

/**
 * Носик, из которого льют. Кто-то же должен наливать кофе — а рук в кадре
 * не будет: анимированная рука в реальном времени нам не по силам, и честнее
 * поставить технику. Полированная сталь заодно ловит панораму и доказывает,
 * что окружение в сцене настоящее.
 */
function Spout({
  originRef,
  flowRef,
}: {
  originRef: React.RefObject<THREE.Vector3>
  flowRef: React.RefObject<number>
}) {
  const group = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const o = originRef.current
    const f = flowRef.current ?? 0
    if (!group.current || !o) return
    // въезжает сверху к началу налива и уходит обратно, когда струя иссякла
    const lift = (1 - THREE.MathUtils.clamp(f * 2.2, 0, 1)) * 0.9
    group.current.position.set(o.x, o.y + lift + 0.015, o.z)
    group.current.visible = f > 0.004 || lift < 0.88
    const m = group.current.children[0] as THREE.Mesh
    const mat = m?.material as THREE.MeshPhysicalMaterial | undefined
    if (mat) mat.opacity = THREE.MathUtils.damp(mat.opacity, f > 0.004 ? 1 : 0, 4, delta)
  })

  return (
    <group ref={group} visible={false}>
      {/* конус носика: узкий срез внизу, из него и идёт струя */}
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.026, 0.012, 0.1, 28, 1, true]} />
        <meshPhysicalMaterial
          color="#8d8f92"
          roughness={0.16}
          metalness={1}
          envMapIntensity={7}
          side={THREE.DoubleSide}
          transparent
          opacity={0}
        />
      </mesh>
      {/* корпус холдера уходит вверх за кадр — машина остаётся за краем */}
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.062, 0.045, 0.34, 28]} />
        <meshPhysicalMaterial color="#7c7e81" roughness={0.22} metalness={1} envMapIntensity={6} />
      </mesh>
    </group>
  )
}

/** Камера с инерцией: реакция на курсор с весом, а не прямое следование */
function Rig({ pointer, scrollRef }: { pointer: React.RefObject<THREE.Vector2>; scrollRef: React.RefObject<number> }) {
  useFrame((state, delta) => {
    const p = pointer.current ?? new THREE.Vector2()
    const s = scrollRef.current ?? 0
    const aspect = state.viewport.aspect
    const narrow = aspect < 1.1

    // Здесь движется камера, а не предмет: чашка стоит на камне и просто живёт.
    // Прокрутка — это проход оператора: общий план → сближение → налив → взгляд внутрь.
    const approach = THREE.MathUtils.clamp((s - 0.16) / 0.26, 0, 1)
    const pour = THREE.MathUtils.clamp((s - 0.44) / 0.3, 0, 1)
    const top = THREE.MathUtils.clamp((s - 0.74) / 0.26, 0, 1)

    // Дистанция: издалека — к предмету. В наливе чуть отступаем, чтобы струя
    // и носик влезли в кадр целиком, потом уходим на макро сверху.
    const far = narrow ? 6.2 : 5.4
    const near = narrow ? 2.9 : 2.45
    const dist = THREE.MathUtils.lerp(far, near, approach) + pour * 0.95 - top * 0.62

    // Высота: на общем плане камера почти на уровне стойки — так виден зал.
    // К финалу поднимается над кромкой и смотрит вниз, в кофе.
    const camY = THREE.MathUtils.lerp(0.62, 0.95, approach) + top * 0.66

    // Точка взгляда: сперва чашка, к финалу — поверхность кофе.
    const lookY = THREE.MathUtils.lerp(0.42, 0.5, approach) - top * 0.12

    // На широком экране предмет уводится в левую треть — правая половина под текст.
    // Двигаем точку взгляда, а не объект: иначе поедут тени и отражение на камне.
    const sideShift = narrow ? 0 : THREE.MathUtils.lerp(0.3, 0.44, approach) * (1 - top * 0.85)

    const targetX = sideShift + p.x * 0.18
    const targetY = camY + p.y * 0.1
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, targetX, 1.8, delta)
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, targetY, 1.8, delta)
    state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, Math.max(0.9, dist), 1.8, delta)
    state.camera.lookAt(sideShift * 1.5 * (1 - top), lookY, 0)
  })
  return null
}

/** Перевод указателя в мировые координаты плоскости пара — чтобы пар расступался там, где палец */
function PointerBridge({
  pointer,
  pointerWorld,
}: {
  pointer: React.RefObject<THREE.Vector2>
  pointerWorld: React.RefObject<THREE.Vector2>
}) {
  const { camera } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const p = pointer.current
    const out = pointerWorld.current
    if (!p || !out) return
    raycaster.setFromCamera(p as unknown as THREE.Vector2, camera)
    if (raycaster.ray.intersectPlane(plane, hit)) out.set(hit.x, hit.y)
  })
  return null
}

export function Scene({ paused, settings, scrollRef }: Props) {
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 900
  const pointer = useRef(new THREE.Vector2(0, 0))
  const pointerWorld = useRef(new THREE.Vector2(999, 999))
  const fill = useRef(0)
  const flow = useRef(0)
  const landing = useRef(0.004)
  const pourOrigin = useRef(new THREE.Vector3())
  const steamAnchor = useRef(new THREE.Vector3(0, 0.45, 0))
  const [dpr, setDpr] = useState(1.5)

  return (
    <Canvas
      dpr={dpr}
      frameloop={paused ? 'demand' : 'always'}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, toneMapping: THREE.AgXToneMapping, toneMappingExposure: 0.85 }}
      camera={{ fov: 30, position: [0, 1.16, 3.1], near: 0.1, far: 40 }}
      onPointerMove={(e) => {
        const r = (e.target as HTMLElement).getBoundingClientRect()
        pointer.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
      }}
      onPointerLeave={() => pointer.current.set(0, 0)}
    >
      {/* адаптивное качество: просел FPS — падает разрешение рендера, а не плавность */}
      <PerformanceMonitor
        onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))}
        onDecline={() => setDpr(1)}
      />

      <fog attach="fog" args={['#0a0908', 6.5, 17]} />

      <Suspense fallback={null}>
        {/*
         * Настоящая панорама реального помещения (Poly Haven, CC0): каменный погреб со
         * сводом и одной оконной щелью — та самая «одно высокое окно» из легенды.
         * Раньше здесь стояли четыре Lightformer'а, и кофе-зеркало честно отражало
         * четыре светящихся прямоугольника на чёрном. Отражать надо помещение.
         */}
        <Environment
          files={`${import.meta.env.BASE_URL}hdri/vault_1k.hdr`}
          background
          backgroundIntensity={0.42}
          backgroundBlurriness={0.42}
          environmentIntensity={0.28}
          // разворот панорамы: оконная щель уводится влево-вперёд, чтобы её отражение
          // легло на кофе и очертило кромку — то есть работала как свет в кадре
          environmentRotation={[0, -2.75, 0]}
        />

        {/* Панорама светит, но теней не даёт — направленный источник оставлен только
            ради тени и блика по кромке. Была 1.5: она пересвечивала бок в белое. */}
        <directionalLight
          position={[-1.15, 3.1, -2.5]}
          intensity={1.15}
          color="#ffe0bd"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0008}
        />

        {/* Заполняющий: контровой свет оставляет перед предмета силуэтом, и фактура
            глазури пропадает. Слабый холодный подсвет спереди её возвращает. */}
        <directionalLight position={[1.6, 1.4, 3.2]} intensity={0.22} color="#b9c4cc" />

        <Counter />
        {/* контакт с камнем: отражение его не даёт, а без контакта предмет читается парящим */}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.62} scale={4.5} blur={2.6} far={1.2} resolution={512} color="#000000" />
        <Cup
          pointer={pointer}
          paused={paused}
          scroll={scrollRef}
          fillRef={fill}
          flowRef={flow}
          originRef={pourOrigin}
          landingRef={landing}
          steamAnchorRef={steamAnchor}
        />
        <Spout originRef={pourOrigin} flowRef={flow} />
        <Pour
          originRef={pourOrigin}
          flowRef={flow}
          paused={paused}
          splashCount={isNarrow ? 60 : 150}
          landingRef={landing}
        />
        <Steam pointerWorld={pointerWorld} paused={paused} intensity={settings.steam} fillRef={fill} anchorRef={steamAnchor} />

        <Rig pointer={pointer} scrollRef={scrollRef} />
        <PointerBridge pointer={pointer} pointerWorld={pointerWorld} />

        <EffectComposer enableNormalPass={false}>
          {/* фокус держим на чашке: передний план и она в резкости, фон уходит */}
          <DepthOfField target={FOCUS_TARGET} focalLength={0.038} bokehScale={3.2} height={480} />
          <Bloom intensity={settings.bloom} luminanceThreshold={0.72} luminanceSmoothing={0.3} mipmapBlur />
          <Noise opacity={settings.grain} premultiply />
          <Vignette eskil={false} offset={0.24} darkness={0.85} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  )
}
