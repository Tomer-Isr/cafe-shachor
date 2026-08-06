import * as THREE from 'three'

/**
 * Процедурные карты вместо скачанных текстур: ассеты нулевого веса.
 * Плейбук предупреждает, что «всё процедурно» — путь к среднему результату,
 * поэтому шум здесь не общий, а под конкретный материал: у керамики это
 * неровность полива и микро-сколы, у камня — крупная пятнистость.
 */

function valueNoise(w: number, h: number, cells: number, seed = 1): Float32Array {
  const rnd = mulberry32(seed)
  const gw = cells + 1
  const grid = new Float32Array(gw * gw)
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()

  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells
      const fy = (y / h) * cells
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const a = grid[y0 * gw + x0]
      const b = grid[y0 * gw + (x0 + 1)]
      const c = grid[(y0 + 1) * gw + x0]
      const d = grid[(y0 + 1) * gw + (x0 + 1)]
      out[y * w + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
    }
  }
  return out
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fbm(w: number, h: number, octaves: number, baseCells: number, seed: number): Float32Array {
  const out = new Float32Array(w * h)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(w, h, baseCells * 2 ** o, seed + o * 17)
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function toTexture(w: number, h: number, write: (d: Uint8ClampedArray, i: number, x: number, y: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) write(img.data, (y * w + x) * 4, x, y)
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/** Карта шероховатости керамики: полив лежит неровно, кромка чуть матовее */
export function ceramicRoughness(size = 512): THREE.Texture {
  const n = fbm(size, size, 4, 4, 7)
  const fine = fbm(size, size, 2, 40, 21)
  return toTexture(size, size, (d, i, x, y) => {
    const idx = y * size + x
    // базовая шероховатость 0.32, пятна полива ±0.16, микрозернистость ±0.05
    let r = 0.32 + (n[idx] - 0.5) * 0.32 + (fine[idx] - 0.5) * 0.1
    r = Math.min(1, Math.max(0.08, r))
    const v = r * 255
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  })
}

/** Нормали керамики из того же поля — мелкая волна глазури, не «шум ради шума» */
export function ceramicNormal(size = 512, strength = 1.6): THREE.Texture {
  const n = fbm(size, size, 3, 24, 7)
  const at = (x: number, y: number) => n[((y + size) % size) * size + ((x + size) % size)]
  return toTexture(size, size, (d, i, x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength
    const len = Math.hypot(-dx, -dy, 1)
    d[i] = ((-dx / len) * 0.5 + 0.5) * 255
    d[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
    d[i + 2] = (1 / len) * 255
    d[i + 3] = 255
  })
}

/**
 * Надпись по боку чашки. Кладётся на отдельную оболочку-копию внешней стенки,
 * поэтому UV предсказуемы: u — окружность, v — высота стенки.
 * Печать по керамике всегда чуть съедена обжигом — альфу выедаем шумом.
 */
export function cupDecal(width = 2048, height = 512): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, width, height)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#2a1c12'

  // главная строка — то, чем место живёт
  ctx.font = `600 ${Math.round(height * 0.115)}px "Frank Ruhl Libre", Georgia, serif`
  ctx.letterSpacing = `${Math.round(height * 0.022)}px`
  ctx.fillText('SHACHOR · ROASTED ON TUESDAYS', width * 0.5, height * 0.3)

  // вторая строка — правила меню, те же, что на витрине
  ctx.font = `400 ${Math.round(height * 0.058)}px "Heebo", system-ui, sans-serif`
  ctx.letterSpacing = `${Math.round(height * 0.03)}px`
  ctx.fillStyle = '#3a2718'
  ctx.fillText('NO SYRUPS · NO SIZES · BRING YOUR OWN CUP', width * 0.5, height * 0.45)

  // пасхалка: подпись мастерской мелким кеглем, как клеймо на донце
  ctx.font = `400 ${Math.round(height * 0.042)}px "Heebo", system-ui, sans-serif`
  ctx.letterSpacing = `${Math.round(height * 0.02)}px`
  ctx.fillStyle = '#4a3524'
  ctx.fillText('made by iukhvidov.dev', width * 0.5, height * 0.6)

  // выедаем печать: обжиг съедает краску пятнами, ровная печать читается наклейкой
  const wear = fbm(width, height, 4, 26, 33)
  const img = ctx.getImageData(0, 0, width, height)
  for (let i = 0, px = 0; i < img.data.length; i += 4, px++) {
    if (img.data[i + 3] === 0) continue
    const w = wear[px]
    const eaten = w < 0.36 ? 0 : Math.min(1, (w - 0.36) / 0.22)
    img.data[i + 3] = Math.round(img.data[i + 3] * (0.55 + 0.45 * eaten))
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 8
  return tex
}

/** Иерусалимский камень стойки: крупная пятнистость + прожилки */
export function stoneMaps(size = 512): { color: THREE.Texture; roughness: THREE.Texture } {
  const blotch = fbm(size, size, 4, 3, 3)
  const grain = fbm(size, size, 3, 26, 11)
  const color = toTexture(size, size, (d, i, x, y) => {
    const idx = y * size + x
    const v = blotch[idx] * 0.75 + grain[idx] * 0.25
    // тёплый известняк: от #4a423a до #6d6156, приглушённый — сцена тёмная
    d[i] = 74 + v * 40
    d[i + 1] = 66 + v * 33
    d[i + 2] = 58 + v * 26
    d[i + 3] = 255
  })
  const roughness = toTexture(size, size, (d, i, x, y) => {
    const idx = y * size + x
    const v = 0.55 + (grain[idx] - 0.5) * 0.3 + (blotch[idx] - 0.5) * 0.2
    const c = Math.min(1, Math.max(0.25, v)) * 255
    d[i] = d[i + 1] = d[i + 2] = c
    d[i + 3] = 255
  })
  // цвет камня — единственная карта здесь, которая действительно цвет
  color.colorSpace = THREE.SRGBColorSpace
  return { color, roughness }
}
