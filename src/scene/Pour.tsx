import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Налив. Настоящую жидкость не симулируем — это заявленный потолок проекта.
 * Реализм собирается из трёх наблюдений за настоящей струёй:
 *  1. струя падает вертикально независимо от наклона чашки (гравитация, а не «из носика вбок»);
 *  2. книзу она тоньше — поток ускоряется, значит сечение сужается;
 *  3. она не идеально прямая: живёт мелкой дрожью и рвётся на капли у конца.
 */

interface Props {
  /** мировая точка схода с кромки — считается от матрицы наклонённой чашки */
  originRef: React.RefObject<THREE.Vector3>
  /** 0 — не льём, 1 — полный поток */
  flowRef: React.RefObject<number>
  paused: boolean
}

const FALL = 1.32 // высота падения от кромки до камня

export function Pour({ originRef, flowRef, paused }: Props) {
  const stream = useRef<THREE.Mesh>(null)
  const streamMat = useRef<THREE.MeshPhysicalMaterial>(null)
  const drops = useRef<THREE.InstancedMesh>(null)
  const puddle = useRef<THREE.Group>(null)
  const puddleMat = useRef<THREE.MeshPhysicalMaterial>(null)
  const time = useRef(0)

  // сужение задано геометрией: сверху 26 мм, у камня 11 мм
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.062, 0.03, FALL, 18, 44, true)
    g.translate(0, -FALL / 2, 0)
    return g
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((_, delta) => {
    if (!paused) time.current += delta
    const t = time.current
    const flow = flowRef.current ?? 0
    const origin = originRef.current

    if (stream.current && streamMat.current && origin) {
      stream.current.position.copy(origin)
      stream.current.visible = flow > 0.02
      // поток набирает силу не мгновенно: сначала тонкая нить, потом полное сечение
      const thickness = THREE.MathUtils.smoothstep(flow, 0, 0.55)
      // длина считается от фактической высоты кромки над камнем: иначе струя
      // либо обрывается в воздухе, либо уходит под стойку
      const reach = THREE.MathUtils.clamp((origin.y - 0.004) / FALL, 0.05, 2)
      stream.current.scale.set(0.45 + thickness * 0.75, reach * Math.min(1, flow * 1.9), 0.45 + thickness * 0.75)
      // мелкая дрожь струи — живая нить вместо трубы
      stream.current.rotation.z = Math.sin(t * 7.3) * 0.012 * flow
      stream.current.rotation.x = Math.sin(t * 5.1 + 1.3) * 0.01 * flow
      streamMat.current.opacity = Math.min(1, flow * 2.2)
    }

    // капли: срываются с конца струи и падают, каждая со своей фазой
    if (drops.current && origin) {
      drops.current.visible = flow > 0.25
      for (let i = 0; i < 7; i++) {
        const phase = (t * (0.75 + i * 0.09) + i * 0.37) % 1
        const y = origin.y - 0.3 - phase * Math.max(0.2, origin.y - 0.3)
        const shrink = 1 - phase * 0.45
        dummy.position.set(
          origin.x + Math.sin(i * 2.1 + t * 3.4) * 0.012,
          y,
          origin.z + Math.cos(i * 1.7 + t * 2.9) * 0.012,
        )
        dummy.scale.setScalar((0.4 + (i % 3) * 0.22) * shrink * Math.min(1, flow * 1.6))
        dummy.updateMatrix()
        drops.current.setMatrixAt(i, dummy.matrix)
      }
      drops.current.instanceMatrix.needsUpdate = true
    }

    // лужа растёт, пока льём, и слегка колышется от падающей струи
    if (puddle.current && puddleMat.current) {
      const target = flow > 0.05 ? 0.26 + flow * 0.34 : 0
      const s = THREE.MathUtils.damp(puddle.current.scale.x, target, 1.4, delta)
      puddle.current.scale.setScalar(Math.max(0.0001, s))
      puddle.current.visible = s > 0.01
      if (origin) puddle.current.position.set(origin.x, 0.004, origin.z)
      puddleMat.current.opacity = THREE.MathUtils.clamp(s * 2.4, 0, 1)
    }
  })

  return (
    <group>
      <mesh ref={stream} geometry={geo} visible={false}>
        <meshPhysicalMaterial
          ref={streamMat}
          color="#4a2410"
          roughness={0.04}
          metalness={0.05}
          transmission={0.55}
          thickness={0.18}
          ior={1.35}
          emissive="#1c0c04"
          emissiveIntensity={0.6}
          envMapIntensity={4.2}
          transparent
          opacity={0}
        />
      </mesh>

      <instancedMesh ref={drops} args={[undefined, undefined, 7]} visible={false}>
        <sphereGeometry args={[0.016, 10, 8]} />
        <meshPhysicalMaterial color="#20120a" roughness={0.1} metalness={0.1} envMapIntensity={2.4} />
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
        {/* мениск: у настоящей лужи край всегда светлее — там собирается блик */}
        <mesh position={[0, 0, 0.0006]}>
          <ringGeometry args={[0.92, 1.02, 72]} />
          <meshPhysicalMaterial color="#5a2e14" roughness={0.08} metalness={0.2} envMapIntensity={3} transparent opacity={0.65} />
        </mesh>
      </group>
    </group>
  )
}
