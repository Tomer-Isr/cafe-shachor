import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ceramicNormal, ceramicSurface, cupDecal } from '../lib/procedural'

/**
 * Чашка построена телом вращения (LatheGeometry) по профилю, а не импортом модели:
 * форму можно править числами прямо в коде — то преимущество настоящей 3D-сцены
 * над скролл-видео, где «подвинуть одну деталь» невозможно.
 */
const PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.285, 0.0], // ножка: узкое кольцо, на нём чашка и стоит
  [0.3, 0.016],
  [0.318, 0.055], // здесь же обрывается глазурь — ниже голая глина
  [0.345, 0.145],
  [0.376, 0.28],
  [0.404, 0.42],
  [0.428, 0.55],
  [0.442, 0.64],
  [0.447, 0.678], // кромка тонкая: толстая читается как дешёвая посуда
  [0.438, 0.681],
  [0.432, 0.65],
  [0.412, 0.5],
  [0.378, 0.3],
  [0.33, 0.13],
  [0.295, 0.06],
  [0.0, 0.05], // дно изнутри
]

/** участок внешней стенки, на который ложится печать */
const DECAL_PROFILE = PROFILE.slice(3, 9)

const RIM_HEIGHT = 0.678

interface Props {
  pointer: React.RefObject<THREE.Vector2>
  paused: boolean
  /** прогресс прокрутки страницы, 0..1 — им живёт вся хореография */
  scroll: React.RefObject<number>
  /** наружу: насколько чашка полна, 0..1 (пар идёт от горячего кофе, а не от пустой посуды) */
  fillRef: React.RefObject<number>
  /** наружу: сила потока */
  flowRef: React.RefObject<number>
  /** наружу: мировая точка, откуда льют — носик над чашкой */
  originRef: React.RefObject<THREE.Vector3>
  /** наружу: мировая Y поверхности кофе — в неё бьёт струя */
  landingRef: React.RefObject<number>
  /** наружу: мировая точка поверхности кофе — от неё поднимается пар */
  steamAnchorRef: React.RefObject<THREE.Vector3>
}

/** Внутренний радиус чашки на заданной высоте — по нему растёт круг кофе */
function innerRadiusAt(y: number) {
  const inner: [number, number][] = [
    [0.05, 0.0],
    [0.06, 0.295],
    [0.13, 0.33],
    [0.3, 0.378],
    [0.5, 0.412],
    [0.65, 0.432],
    [0.681, 0.438],
  ]
  for (let i = 1; i < inner.length; i++) {
    if (y <= inner[i][0]) {
      const [y0, r0] = inner[i - 1]
      const [y1, r1] = inner[i]
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)
    }
  }
  return 0.438
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)

export function Cup({ pointer, paused, scroll, fillRef, flowRef, originRef, landingRef, steamAnchorRef }: Props) {
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

  // Одна карта на весь корпус и БЕЗ повтора по высоте: повтор размножил бы
  // границу глазури поясами, а она в предмете ровно одна.
  const surface = useMemo(() => ceramicSurface(1024), [])
  const normalMap = useMemo(() => {
    const t = ceramicNormal(512)
    t.repeat.set(3, 2)
    return t
  }, [])
  const decalMap = useMemo(() => cupDecal(), [])

  useFrame((_state, delta) => {
    if (!group.current) return
    const p = pointer.current ?? new THREE.Vector2()
    const s = scroll.current ?? 0

    // ── хореография прокрутки ────────────────────────────────────────────
    // 0.00–0.20  общий план: пустая чашка стоит и медленно поворачивается
    // 0.20–0.44  наезд: камера подходит, читается глазурь и ножка
    // 0.44–0.74  налив: сверху идёт струя, уровень растёт, нарастает крема
    // 0.74–1.00  взгляд внутрь: камера уходит вверх, кофе отражает свод
    const pourPhase = THREE.MathUtils.clamp((s - 0.44) / 0.3, 0, 1)
    const fill = easeInOut(pourPhase)
    // поток нарастает и стихает: в начале струя ещё не набрала, в конце уже иссякла
    const flow = Math.min(
      THREE.MathUtils.clamp(pourPhase / 0.12, 0, 1),
      THREE.MathUtils.clamp((1 - pourPhase) / 0.16, 0, 1),
    )

    if (fillRef.current !== undefined) fillRef.current = fill
    if (flowRef.current !== undefined) flowRef.current = flow

    // Чашка вращается всё время — это её «жизнь». В наливе вращение почти
    // останавливается: под струёй посуду не крутят.
    if (!paused) spin.current += delta * (0.11 - pourPhase * 0.095)
    if (spinner.current) spinner.current.rotation.y = spin.current

    // Предмет стоит на камне и никуда не летит: ни подъёма, ни наклона.
    // Курсор даёт только микро-доворот — вес вещи, а не левитацию.
    const targetTiltX = THREE.MathUtils.clamp(-p.y * 0.05, -0.06, 0.06)
    const targetTiltZ = THREE.MathUtils.clamp(-p.x * 0.045, -0.055, 0.055)
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, targetTiltX, 2.2, delta)
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, targetTiltZ, 2.4, delta)

    // ── жидкость: уровень растёт по мере налива ───────────────────────────
    const BOTTOM = 0.075
    const TOP = RIM_HEIGHT - 0.052
    const level = THREE.MathUtils.lerp(BOTTOM, TOP, fill)
    const worldLevel = level + group.current.position.y

    if (liquid.current && crema.current) {
      // радиус круга кофе берётся из профиля: у дна чашка уже, чем у кромки
      const radius = innerRadiusAt(level) - 0.004
      for (const m of [liquid.current, crema.current]) {
        m.position.set(0, level + (m === crema.current ? 0.0015 : 0), 0)
        m.scale.setScalar(Math.max(0.02, radius / 0.428))
        m.rotation.set(-Math.PI / 2, 0, 0) // мир, а не чашка: уровень всегда горизонтален
        m.visible = fill > 0.015
      }
      // крема появляется не сразу: сперва тёмный кофе, пенка набегает к концу
      const cremaMat = crema.current.material as THREE.MeshPhysicalMaterial
      cremaMat.opacity = THREE.MathUtils.clamp((fill - 0.35) / 0.5, 0, 1) * 0.62
      cremaMat.transparent = true

      if (steamAnchorRef.current) steamAnchorRef.current.set(0, worldLevel - 0.02, 0)
      if (landingRef.current !== undefined) landingRef.current = worldLevel
    }

    // ── точка, откуда льют: носик висит над чашкой и с ней не вращается ────
    if (originRef.current) {
      originRef.current.set(group.current.position.x, group.current.position.y + 0.98, group.current.position.z)
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
        {/* мягкий подсвет за курсором; был 3.4 и выжигал бок в белое пятно */}
        <pointLight ref={revealLight} position={[0.6, 0.6, 1.1]} intensity={0.05} distance={1.6} color="#ffd9b0" />

        {/* корпус: тёмная крапчатая глазурь, обрывающаяся над голой глиной ножки.
            Цвет и блеск задаёт карта — оттого низ матовый, а стенка отражает окно. */}
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            map={surface.color}
            roughnessMap={surface.roughness}
            normalMap={normalMap}
            normalScale={new THREE.Vector2(0.28, 0.28)}
            roughness={1}
            metalness={0}
            clearcoat={0.35}
            clearcoatRoughness={0.42}
            envMapIntensity={1}
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
        <mesh position={[0.418, 0.42, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} scale={[1, 1, 0.76]} castShadow>
          <torusGeometry args={[0.132, 0.03, 20, 72, Math.PI * 1.2]} />
          <meshPhysicalMaterial
            color="#2a241f"
            normalMap={normalMap}
            normalScale={new THREE.Vector2(0.26, 0.26)}
            roughness={0.34}
            metalness={0}
            clearcoat={0.35}
            clearcoatRoughness={0.42}
            envMapIntensity={1}
          />
        </mesh>
        </group>
      </group>

      {/* жидкость вне группы чашки: уровень держится по горизонту, как в реальности */}
      <group position={[0, -0.02, 0]}>
        <mesh ref={liquid} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.63, 0]}>
          <circleGeometry args={[0.428, 128]} />
          <meshPhysicalMaterial
            color="#050302"
            roughness={0.018}
            metalness={0.62}
            // 3.2 было костылём: с четырьмя лайтформерами отражать было нечего,
            // и блик приходилось выкручивать. С настоящей панорамой хватает единицы.
            envMapIntensity={5.2}
            clearcoat={1}
            clearcoatRoughness={0.03}
          />
        </mesh>
        <mesh ref={crema} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6315, 0]}>
          <ringGeometry args={[0.4, 0.4285, 128]} />
          <meshPhysicalMaterial color="#3f2411" roughness={0.78} metalness={0} envMapIntensity={0.55} transparent opacity={0} />
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
