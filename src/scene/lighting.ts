import { Vector3 } from 'three'

/**
 * Light settings of the scene (the "Światło" widget, top right of the viewport):
 *  - the key light (sun) casting shadows – its direction as azimuth + elevation, relative to the
 *    furniture: azimuth 0° = from the front (+Z), 90° = from the right (+X), 180° = from the back,
 *    270° = from the left; elevation 90° = straight from above, towards 0° = low, from the side,
 *  - its intensity and the intensity of the ambient (fill) light.
 */
export interface LightSettings {
  /** [°] 0 – 360, 0 = front, 90 = right. */
  azimuth: number
  /** [°] MIN_ELEVATION – 90, 90 = from above. */
  elevation: number
  /** Key (sun) light intensity. */
  intensity: number
  /** Ambient light intensity (lights the shadowed parts). */
  ambient: number
}

export const MIN_ELEVATION = 5
export const INTENSITY_LIMITS = { min: 0, max: 3 }
export const AMBIENT_LIMITS = { min: 0, max: 3 }

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

/** Settings of a light coming from the direction `dir` (towards the light). */
export function settingsFromDirection(dir: Vector3, intensity: number, ambient: number): LightSettings {
  const d = dir.clone().normalize()
  const azimuth = (deg(Math.atan2(d.x, d.z)) + 360) % 360
  const elevation = deg(Math.asin(Math.max(-1, Math.min(1, d.y))))
  return { azimuth: round1(azimuth), elevation: round1(elevation), intensity, ambient }
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** Default: from the front-right, from above (the former fixed light: direction 5 : 8 : 5). */
export const DEFAULT_LIGHT: LightSettings = settingsFromDirection(new Vector3(5, 8, 5), 1.3, 1.3)

/** Unit vector pointing from the furniture TOWARDS the light. */
export function lightDirection(s: LightSettings): Vector3 {
  const el = rad(Math.max(MIN_ELEVATION, Math.min(90, s.elevation)))
  const az = rad(s.azimuth)
  return new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
}

/**
 * The widget disk is a view from above: the centre = light straight from above (90°), the rim = light at
 * MIN_ELEVATION; the front of the furniture is at the BOTTOM of the disk, its right side on the right.
 * Point on the disk (x right, y down, in units of the radius) ↔ azimuth / elevation.
 */
export function diskPoint(s: Pick<LightSettings, 'azimuth' | 'elevation'>): { x: number; y: number } {
  const rho = (90 - Math.max(MIN_ELEVATION, Math.min(90, s.elevation))) / (90 - MIN_ELEVATION)
  const az = rad(s.azimuth)
  return { x: rho * Math.sin(az), y: rho * Math.cos(az) }
}

export function fromDiskPoint(x: number, y: number): { azimuth: number; elevation: number } {
  const rho = Math.min(1, Math.hypot(x, y))
  const azimuth = rho < 1e-6 ? 0 : (deg(Math.atan2(x, y)) + 360) % 360
  const elevation = 90 - rho * (90 - MIN_ELEVATION)
  return { azimuth: round1(azimuth), elevation: round1(elevation) }
}

/** "przód-prawo" … – where the light comes from, for the widget label. */
export function azimuthLabel(azimuth: number): string {
  const names = ['przodu', 'przodu z prawej', 'prawej', 'tyłu z prawej', 'tyłu', 'tyłu z lewej', 'lewej', 'przodu z lewej']
  return names[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8]
}

const STORAGE_KEY = 'cabicad.light'

/** Settings remembered in this browser (or the default). */
export function loadLightSettings(): LightSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LIGHT
    const v = JSON.parse(raw) as Partial<LightSettings>
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
    return {
      azimuth: num(v.azimuth, DEFAULT_LIGHT.azimuth),
      elevation: Math.max(MIN_ELEVATION, Math.min(90, num(v.elevation, DEFAULT_LIGHT.elevation))),
      intensity: Math.max(INTENSITY_LIMITS.min, Math.min(INTENSITY_LIMITS.max, num(v.intensity, DEFAULT_LIGHT.intensity))),
      ambient: Math.max(AMBIENT_LIMITS.min, Math.min(AMBIENT_LIMITS.max, num(v.ambient, DEFAULT_LIGHT.ambient))),
    }
  } catch {
    return DEFAULT_LIGHT
  }
}

export function saveLightSettings(s: LightSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // storage blocked (private mode…) – the settings just aren't remembered
  }
}

const RAY_KEY = 'cabicad.light.rays'

/** "Pokaż promienie" in the "Światło" panel – remembered in this browser (default off). */
export function loadSunRays(): boolean {
  try {
    return localStorage.getItem(RAY_KEY) === '1'
  } catch {
    return false
  }
}

export function saveSunRays(on: boolean): void {
  try {
    localStorage.setItem(RAY_KEY, on ? '1' : '0')
  } catch {
    // storage blocked – just not remembered
  }
}
