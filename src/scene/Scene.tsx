import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, MeshReflectorMaterial, PerformanceMonitor } from '@react-three/drei'
import { Bloom, DepthOfField, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Cup } from './Cup'
import { Pour } from './Pour'
import { Steam } from './Steam'
import { stoneMaps } from '../lib/procedural'

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
function BackWall() {
  const { color, roughness } = useMemo(() => {
    const m = stoneMaps(512)
    m.color.repeat.set(6, 2)
    m.roughness.repeat.set(6, 2)
    return m
  }, [])
  return (
    <mesh position={[0, 2.1, -4.2]} receiveShadow>
      <planeGeometry args={[22, 9]} />
      <meshStandardMaterial map={color} roughnessMap={roughness} color="#171310" roughness={0.98} metalness={0} />
    </mesh>
  )
}

/** Камера с инерцией: реакция на курсор с весом, а не прямое следование */
function Rig({ pointer, scrollRef }: { pointer: React.RefObject<THREE.Vector2>; scrollRef: React.RefObject<number> }) {
  useFrame((state, delta) => {
    const p = pointer.current ?? new THREE.Vector2()
    const s = scrollRef.current ?? 0
    const aspect = state.viewport.aspect

    // вертикальный экран → камера дальше, иначе чашка выходит за края кадра
    const base = aspect < 0.75 ? 4.6 : aspect < 1.1 ? 3.9 : 3.1
    const height = aspect < 1.1 ? 1.32 : 1.16

    const bPhase = THREE.MathUtils.clamp((s - 0.36) / 0.32, 0, 1)
    const cPhase = THREE.MathUtils.clamp((s - 0.68) / 0.32, 0, 1)

    // B: подходим ближе — печать на боку должна читаться, а не угадываться
    // C: опускаемся и отступаем — в кадр входят струя и камень под ней
    const dist = base + (aspect < 1.1 ? 0 : 0.55) - bPhase * 0.55 + cPhase * 0.95
    const camY = height - bPhase * 0.24 + cPhase * 0.52
    const lookY = (aspect < 1.1 ? 0.5 : 0.36) - bPhase * 0.06 + cPhase * 0.2

    // на широком экране предмет уводится в левую треть: правая половина — текст.
    // Двигаем точку взгляда, а не объект, иначе поедут тени и отражение на камне.
    const sideShift = aspect < 1.1 ? 0 : 0.58

    const targetX = sideShift + p.x * 0.22 + cPhase * 0.16
    const targetY = camY + p.y * 0.14
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, targetX, 1.6, delta)
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, targetY, 1.6, delta)
    state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, dist, 1.6, delta)
    state.camera.lookAt(sideShift * 1.55, lookY, 0)
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
  const tilt = useRef(0)
  const flow = useRef(0)
  const pourOrigin = useRef(new THREE.Vector3())
  const steamAnchor = useRef(new THREE.Vector3(0, 0.45, 0))
  const [dpr, setDpr] = useState(1.5)

  return (
    <Canvas
      dpr={dpr}
      frameloop={paused ? 'demand' : 'always'}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, toneMapping: THREE.AgXToneMapping, toneMappingExposure: 1.25 }}
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

      <color attach="background" args={['#0a0908']} />
      <fog attach="fog" args={['#0a0908', 3.8, 10]} />

      <Suspense fallback={null}>
        {/* HDRI (CC0, Poly Haven) отвечает за отражения в кофе; лайтформеры дорисовывают сцену */}
        <Environment resolution={256} environmentIntensity={0.55}>
          {/* «одно высокое окно на восток» из легенды — главный источник и главный блик */}
          <Lightformer form="rect" intensity={5.5} color="#ffd9ae" scale={[1.1, 3.4, 1]} position={[-3.2, 2.2, 1.2]} target={[0, 0.4, 0]} />
          {/* холодный контровой сверху-сзади: отделяет чашку от фона */}
          <Lightformer form="rect" intensity={2.1} color="#c2c8cc" scale={[3.4, 1.1, 1]} position={[2.2, 2.9, -3.1]} target={[0, 0.45, 0]} />
          {/* узкая полоса над чашкой — её отражение и есть «блик окна» на кофе */}
          <Lightformer form="rect" intensity={3.2} color="#fff1dd" scale={[0.28, 2.6, 1]} rotation-x={Math.PI / 2} position={[-0.35, 2.1, 0.6]} target={[0, 0.45, 0]} />
          {/* тёплый отражатель снизу — подсвечивает низ ручки, чтобы не проваливалась в чёрное */}
          <Lightformer form="circle" intensity={0.3} color="#a3846a" scale={[2, 2, 1]} position={[2.2, -0.4, 1.6]} target={[0, 0.2, 0]} />
        </Environment>

        <directionalLight
          position={[-1.9, 3.6, 1.1]}
          intensity={1.5}
          color="#ffe0bd"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0008}
        />
        <ambientLight intensity={0.06} />

        <BackWall />
        <Counter />
        {/* контакт с камнем: отражение его не даёт, а без контакта предмет читается парящим */}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.62} scale={4.5} blur={2.6} far={1.2} resolution={512} color="#000000" />
        <Cup
          pointer={pointer}
          paused={paused}
          scroll={scrollRef}
          tiltRef={tilt}
          flowRef={flow}
          originRef={pourOrigin}
          steamAnchorRef={steamAnchor}
        />
        <Pour originRef={pourOrigin} flowRef={flow} paused={paused} splashCount={isNarrow ? 60 : 150} />
        <Steam pointerWorld={pointerWorld} paused={paused} intensity={settings.steam} tiltRef={tilt} anchorRef={steamAnchor} />

        <Rig pointer={pointer} scrollRef={scrollRef} />
        <PointerBridge pointer={pointer} pointerWorld={pointerWorld} />

        <EffectComposer enableNormalPass={false}>
          {/* фокус держим на чашке: передний план и она в резкости, фон уходит */}
          <DepthOfField focusDistance={settings.focus} focalLength={0.05} bokehScale={2.4} height={480} />
          <Bloom intensity={settings.bloom} luminanceThreshold={0.72} luminanceSmoothing={0.3} mipmapBlur />
          <Noise opacity={settings.grain} premultiply />
          <Vignette eskil={false} offset={0.24} darkness={0.85} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  )
}
