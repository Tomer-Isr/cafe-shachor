import { createContext, useContext } from 'react'
import motion from './motion.json'

/**
 * Скорость текста выводится из движения камеры, а не живёт рядом с ним.
 *
 * До этого строки выходили за 0.85 с с шагом 0.085 с всегда — и на общем плане,
 * где камера почти стоит, и на наливе, где кадр несётся. Два независимых эффекта
 * вместо одной хореографии; это и был диагноз «движение есть, хореографии нет».
 *
 * Числа берутся из самой плёнки: `render/export_motion.py` считает, насколько
 * меняется кадр от соседа к соседу, и кладёт сюда массив 0..1. Из маршрута
 * камеры их взять нельзя — он перепараметризован по длине пути, и по прокрутке
 * камера движется равномерно по построению.
 */

/** Прогресс плёнки 0..1. Ref, а не state: значение меняется на каждый кадр прокрутки. */
export const FilmProgress = createContext<{ readonly current: number } | null>(null)

const SPEED = motion as number[]

/** Насколько быстро меняется кадр в этой точке ленты: 0 — стоит, 1 — предельно быстро. */
export function speedAt(progress: number): number {
  if (!SPEED.length) return 0
  const x = Math.min(1, Math.max(0, progress)) * (SPEED.length - 1)
  const i = Math.floor(x)
  const next = Math.min(i + 1, SPEED.length - 1)
  return SPEED[i] + (SPEED[next] - SPEED[i]) * (x - i)
}

/**
 * dur = 900 − v·450, stagger = dur/9 (DESIGN-SYSTEM §5.2).
 * Возвращаем секунды — в них считает GSAP.
 */
export function timingFor(speed: number): { duration: number; stagger: number } {
  const ms = 900 - Math.min(1, Math.max(0, speed)) * 450
  return { duration: ms / 1000, stagger: ms / 9 / 1000 }
}

/**
 * Окно раскладки — длина отрезка прокрутки (в высотах экрана), за который
 * выходят все строки блока.
 *
 * Это та же формула §5.2, переписанная из времени в расстояние: при обычной
 * прокрутке 0.45 vh даёт зазор между строками ровно 100 мс (токен неподвижной
 * камеры), а 0.23 vh — 51 мс (токен броска). Там, где камера летит, окно вдвое
 * короче, и строки ложатся быстрее — сами, без второго набора чисел.
 *
 * От числа строк окно не зависит намеренно: у длинного абзаца зазор сжимается,
 * и низ блока не заставляет себя ждать.
 */
export function windowFor(speed: number): number {
  return 0.45 - 0.22 * Math.min(1, Math.max(0, speed))
}

/** Тайминг в текущей точке плёнки. Вне провайдера — как при неподвижной камере. */
export function useFilmTiming(): () => { duration: number; stagger: number } {
  const progress = useContext(FilmProgress)
  return () => timingFor(progress ? speedAt(progress.current) : 0)
}
