import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ceramicNormal, ceramicRoughness, cupDecal } from '../lib/procedural'

/**
 * Чашка построена телом вращения (LatheGeometry) по профилю, а не импортом модели:
 * форму можно править числами прямо в коде — то преимущество настоящей 3D-сцены
 * над скролл-видео, где «подвинуть одну деталь» невозможно.
 */
const PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.235, 0.0], // узкое дно — чашка стоит на «ножке», а не на ведёрном днище
  [0.262, 0.014],
  [0.3, 0.055],
  [0.372, 0.16],
  [0.425, 0.3],
  [0.452, 0.42],
  [0.462, 0.475],
  [0.464, 0.5], // кромка тонкая: толстая читается как дешёвая посуда
  [0.4555, 0.507],
  [0.4475, 0.5],
  [0.442, 0.46],
  [0.412, 0.3],
  [0.345, 0.13],
  [0.28, 0.05],
  [0.0, 0.038], // дно изнутри
]

/** участок внешней стенки, на который ложится печать */
const DECAL_PROFILE = PROFILE.slice(3, 9)

const RIM_RADIUS = 0.464
const RIM_HEIGHT = 0.5

interface Props {
  pointer: React.RefObject<THREE.Vector2>
  paused: boolean
  /** прогресс первого экрана, 0..1 по всем трём блокам */
  scroll: React.RefObject<number>
  /** наружу: насколько чашка наклонена (для пара) */
  tiltRef: React.RefObject<number>
  /** наружу: сила потока */
  flowRef: React.RefObject<number>
  /** наружу: мировая точка схода струи с кромки */
  originRef: React.RefObject<THREE.Vector3>
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)

export function Cup({ pointer, paused, scroll, tiltRef, flowRef, originRef }: Props) {
  // Две вложенные группы намеренно: Euler применяет повороты по порядку, и наклон
  // после доворота на 90° кренил бы чашку «от зрителя», а не вбок. Внешняя группа
  // отвечает за наклон и место в кадре, внутренняя — за поворот вокруг своей оси.
  const group = useRef<THREE.Group>(null)
  const spinner = useRef<THREE.Group>(null)
  const liquid = useRef<THREE.Mesh>(null)
  const crema = useRef<THREE.Mesh>(null)
  const revealLight = useRef<THREE.PointLight>(null)
  const spin = useRef(0)

  const geometry = useMemo(() => wobbleLathe(PROFILE, 160), [])
  // оболочка печати: копия внешней стенки, отодвинутая на толщину глазури
  const decalGeometry = useMemo(() => wobbleLathe(DECAL_PROFILE, 160, 1.004), [])

  const roughnessMap = useMemo(() => {
    const t = ceramicRoughness(512)
    t.repeat.set(3, 2)
    return t
  }, [])
  const normalMap = useMemo(() => {
    const t = ceramicNormal(512)
    t.repeat.set(3, 2)
    return t
  }, [])
  const decalMap = useMemo(() => cupDecal(), [])

  const localRim = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    const p = pointer.current ?? new THREE.Vector2()
    const s = scroll.current ?? 0

    // ── три блока прокрутки ──────────────────────────────────────────────
    // A (0.00–0.36): предмет живёт сам по себе, медленно поворачиваясь
    // B (0.36–0.68): доворачивается печатью к зрителю и подходит ближе
    // C (0.68–1.00): наклоняется и льёт
    const bPhase = THREE.MathUtils.clamp((s - 0.36) / 0.32, 0, 1)
    const cPhase = THREE.MathUtils.clamp((s - 0.68) / 0.32, 0, 1)
    const tilt = easeInOut(cPhase)
    const flow = THREE.MathUtils.clamp((tilt - 0.32) / 0.4, 0, 1)

    if (tiltRef.current !== undefined) tiltRef.current = tilt
    if (flowRef.current !== undefined) flowRef.current = flow

    // свободное вращение только в первом акте: дальше печать доворачивается к зрителю.
    // Центр надписи лежит на u=0.5, то есть смотрит в -X — значит доворот на -90°.
    if (!paused && bPhase < 0.001) spin.current += delta * 0.09
    const facing = -Math.PI / 2
    const targetSpin = bPhase > 0 ? THREE.MathUtils.lerp(spin.current, facing, bPhase) : spin.current
    if (spinner.current) {
      spinner.current.rotation.y = THREE.MathUtils.damp(spinner.current.rotation.y, targetSpin, 3, delta)
    }

    if (!paused) group.current.position.y = -0.02 + Math.sin(t * 0.6) * 0.004

    // наклон к курсору живёт только пока чашка стоит — в наливе он мешает
    const pointerWeight = 1 - tilt
    const targetTiltX = THREE.MathUtils.clamp(-p.y * 0.12, -0.14, 0.14) * pointerWeight
    const targetTiltZ = THREE.MathUtils.clamp(-p.x * 0.1, -0.12, 0.12) * pointerWeight
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, targetTiltX, 2.2, delta)
    // наклон налива: носик уходит влево, туда же смотрит камера
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, targetTiltZ + tilt * 0.8, 2.6, delta)

    // во втором блоке предмет подходит ближе, в третьем чуть приподнимается над камнем
    group.current.position.z = THREE.MathUtils.damp(group.current.position.z, bPhase * 0.42 - cPhase * 0.3, 3, delta)
    group.current.position.y = group.current.position.y + tilt * 0.62
    // уводим предмет вправо: струя должна падать в кадр, а не за его край
    group.current.position.x = THREE.MathUtils.damp(group.current.position.x, tilt * 0.34, 3, delta)
    group.current.scale.setScalar(THREE.MathUtils.damp(group.current.scale.x, 1 + bPhase * 0.1 - cPhase * 0.12, 3, delta))

    // ── жидкость: уровень всегда горизонтален, объём убывает ──────────────
    if (liquid.current && crema.current) {
      const drained = flow
      const level = RIM_HEIGHT - 0.048 - drained * 0.26
      const radius = 1 - tilt * 0.42 - drained * 0.22
      // при наклоне жидкость прижимается к носику, а не остаётся по центру
      const shift = -tilt * 0.11
      for (const m of [liquid.current, crema.current]) {
        m.position.set(shift, level + (m === crema.current ? 0.0015 : 0), 0)
        m.scale.setScalar(Math.max(0.02, radius))
        m.rotation.set(-Math.PI / 2, 0, 0) // мир, а не чашка: жидкость не наклоняется
        m.visible = radius > 0.06
      }
    }

    // ── точка схода струи: реальная кромка наклонённой чашки ──────────────
    if (originRef.current) {
      localRim.set(-RIM_RADIUS - 0.055, RIM_HEIGHT - 0.015, 0)
      group.current.localToWorld(localRim)
      originRef.current.copy(localRim)
    }

    if (revealLight.current) {
      revealLight.current.position.x = THREE.MathUtils.damp(revealLight.current.position.x, p.x * 1.6, 3, delta)
      revealLight.current.position.y = THREE.MathUtils.damp(revealLight.current.position.y, 0.5 + p.y * 0.9, 3, delta)
    }
  })

  return (
    <>
      <group ref={group} position={[0, -0.02, 0]}>
        <group ref={spinner}>
        <pointLight ref={revealLight} position={[0.6, 0.6, 1.1]} intensity={3.4} distance={4} color="#ffd9b0" />

        {/* корпус: не белый — тёплый серо-песочный. Белая керамика в тёмной сцене
            выбивается в пересвет и читается пластиком. */}
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            color="#a99e8d"
            roughnessMap={roughnessMap}
            normalMap={normalMap}
            normalScale={new THREE.Vector2(0.34, 0.34)}
            roughness={0.72}
            metalness={0}
            clearcoat={0.08}
            clearcoatRoughness={0.7}
            envMapIntensity={0.32}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* печать по боку: отдельная оболочка поверх стенки, чтобы UV были предсказуемы */}
        <mesh geometry={decalGeometry}>
          <meshPhysicalMaterial
            map={decalMap}
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            roughness={0.62}
            metalness={0}
            envMapIntensity={0.3}
          />
        </mesh>

        {/* ручка: не идеальное кольцо — слегка сплюснута, как у ручной керамики */}
        <mesh position={[0.435, 0.29, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} scale={[1, 1, 0.78]} castShadow>
          <torusGeometry args={[0.145, 0.032, 20, 72, Math.PI * 1.15]} />
          <meshPhysicalMaterial
            color="#a99e8d"
            roughnessMap={roughnessMap}
            normalMap={normalMap}
            normalScale={new THREE.Vector2(0.3, 0.3)}
            roughness={0.74}
            metalness={0}
            clearcoat={0.06}
            envMapIntensity={0.32}
          />
        </mesh>
        </group>
      </group>

      {/* жидкость вне группы чашки: уровень держится по горизонту, как в реальности */}
      <group position={[0, -0.02, 0]}>
        <mesh ref={liquid} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.452, 0]}>
          <circleGeometry args={[0.4405, 128]} />
          <meshPhysicalMaterial
            color="#080503"
            roughness={0.045}
            metalness={0.35}
            envMapIntensity={3.2}
            clearcoat={1}
            clearcoatRoughness={0.03}
          />
        </mesh>
        <mesh ref={crema} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4535, 0]}>
          <ringGeometry args={[0.412, 0.4415, 128]} />
          <meshPhysicalMaterial color="#4a2a17" roughness={0.62} metalness={0} envMapIntensity={1.1} />
        </mesh>
      </group>
    </>
  )
}

/**
 * Тело вращения с неидеальным силуэтом: ручная керамика не бывает круглой,
 * а идеальное тело вращения — первый признак CG.
 */
function wobbleLathe(profile: [number, number][], segments: number, scale = 1) {
  const points = profile.map(([x, y]) => new THREE.Vector2(x * scale, y))
  const g = new THREE.LatheGeometry(points, segments)
  const pos = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const r = Math.hypot(v.x, v.z)
    if (r < 0.001) continue
    const angle = Math.atan2(v.z, v.x)
    const wobble =
      Math.sin(angle * 3 + 0.7) * 0.0055 + Math.sin(angle * 5 - 1.9) * 0.0032 + Math.sin(angle * 2 + v.y * 6.0) * 0.0041
    const k = (r + wobble) / r
    pos.setXYZ(i, v.x * k, v.y, v.z * k)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  return g
}
