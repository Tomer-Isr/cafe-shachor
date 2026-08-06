import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ceramicNormal, ceramicRoughness } from '../lib/procedural'

/**
 * Чашка построена телом вращения (LatheGeometry) по профилю, а не импортом модели:
 * форму можно править числами прямо в коде — ровно то преимущество настоящей 3D-сцены
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

interface Props {
  /** позиция курсора в пространстве сцены, для «вскрывающего» света */
  pointer: React.RefObject<THREE.Vector2>
  paused: boolean
  scroll: React.RefObject<number>
}

export function Cup({ pointer, paused, scroll }: Props) {
  const group = useRef<THREE.Group>(null)
  const revealLight = useRef<THREE.PointLight>(null)

  const geometry = useMemo(() => {
    const points = PROFILE.map(([x, y]) => new THREE.Vector2(x, y))
    const g = new THREE.LatheGeometry(points, 160)

    // Идеальное тело вращения читается как CG. Ручная керамика не бывает круглой:
    // уводим радиус на доли процента по углу и высоте — силуэт перестаёт быть циркульным.
    const pos = g.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const r = Math.hypot(v.x, v.z)
      if (r < 0.001) continue
      const angle = Math.atan2(v.z, v.x)
      const wobble =
        Math.sin(angle * 3 + 0.7) * 0.0055 +
        Math.sin(angle * 5 - 1.9) * 0.0032 +
        Math.sin(angle * 2 + v.y * 6.0) * 0.0041
      const k = (r + wobble) / r
      pos.setXYZ(i, v.x * k, v.y, v.z * k)
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
  }, [])

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

  useFrame((state, delta) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    const p = pointer.current ?? new THREE.Vector2()
    const s = scroll.current ?? 0

    if (!paused) {
      // чашка живёт: очень медленный поворот + микро-дыхание, чтобы объект не читался мёртвым
      group.current.rotation.y += delta * 0.08
      group.current.position.y = -0.02 + Math.sin(t * 0.6) * 0.004
    }
    // наклон к курсору — объект «замечает» человека (вес и инерция, не резкий отклик)
    const targetTiltX = THREE.MathUtils.clamp(-p.y * 0.12, -0.14, 0.14)
    const targetTiltZ = THREE.MathUtils.clamp(-p.x * 0.1, -0.12, 0.12)
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, targetTiltX, 2.2, delta)
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, targetTiltZ, 2.2, delta)

    // на прокрутке чашка уходит вглубь и вниз — передаёт сцену следующему экрану
    group.current.position.z = THREE.MathUtils.damp(group.current.position.z, -s * 1.4, 3, delta)
    group.current.scale.setScalar(THREE.MathUtils.damp(group.current.scale.x, 1 - s * 0.25, 3, delta))

    // «вскрывающий» свет: ходит за курсором и вытаскивает рельеф глазури из темноты
    if (revealLight.current) {
      revealLight.current.position.x = THREE.MathUtils.damp(revealLight.current.position.x, p.x * 1.6, 3, delta)
      revealLight.current.position.y = THREE.MathUtils.damp(revealLight.current.position.y, 0.5 + p.y * 0.9, 3, delta)
    }
  })

  return (
    <group ref={group} position={[0, -0.02, 0]}>
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
          envMapIntensity={0.6}
        />
      </mesh>

      {/* кофе — чёрное зеркало: отражает окно и свод, поэтому почти без шероховатости.
          Уровень чуть ниже кромки: заполненная вровень чашка выглядит нарисованной. */}
      <mesh position={[0, 0.452, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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

      {/* кремá: тонкое кольцо по краю — граница между чёрным зеркалом и стенкой */}
      <mesh position={[0, 0.4535, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.412, 0.4415, 128]} />
        <meshPhysicalMaterial color="#4a2a17" roughness={0.62} metalness={0} envMapIntensity={1.1} />
      </mesh>
    </group>
  )
}
