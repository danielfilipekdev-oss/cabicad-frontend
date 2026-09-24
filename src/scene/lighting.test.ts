import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { DEFAULT_LIGHT, MIN_ELEVATION, azimuthLabel, diskPoint, fromDiskPoint, lightDirection, settingsFromDirection } from './lighting.ts'

describe('light settings (Światło)', () => {
  it('the default equals the former fixed light direction 5 : 8 : 5', () => {
    expect(DEFAULT_LIGHT.azimuth).toBeCloseTo(45)
    const d = lightDirection(DEFAULT_LIGHT)
    const old = new Vector3(5, 8, 5).normalize()
    expect(d.distanceTo(old)).toBeLessThan(0.002)
  })

  it('azimuth 0 = front (+Z), 90 = right (+X), elevation 90 = from above', () => {
    const base = { intensity: 1, ambient: 1 }
    expect(lightDirection({ ...base, azimuth: 0, elevation: MIN_ELEVATION }).z).toBeGreaterThan(0.99)
    expect(lightDirection({ ...base, azimuth: 90, elevation: MIN_ELEVATION }).x).toBeGreaterThan(0.99)
    expect(lightDirection({ ...base, azimuth: 123, elevation: 90 }).y).toBeCloseTo(1)
    const s = settingsFromDirection(new Vector3(-1, 1, 0), 1, 1)
    expect([s.azimuth, s.elevation]).toEqual([270, 45])
  })

  it('disk (view from above, front at the bottom) ↔ azimuth / elevation', () => {
    expect(fromDiskPoint(0, 0).elevation).toBe(90)
    expect(fromDiskPoint(0, 1)).toEqual({ azimuth: 0, elevation: MIN_ELEVATION }) // bottom = front
    expect(fromDiskPoint(1, 0).azimuth).toBe(90) // right
    expect(fromDiskPoint(0, -2)).toEqual({ azimuth: 180, elevation: MIN_ELEVATION }) // outside → the rim
    const p = diskPoint(DEFAULT_LIGHT)
    const back = fromDiskPoint(p.x, p.y)
    expect(back.azimuth).toBeCloseTo(DEFAULT_LIGHT.azimuth, 0)
    expect(back.elevation).toBeCloseTo(DEFAULT_LIGHT.elevation, 0)
    expect(azimuthLabel(45)).toBe('przodu z prawej')
    expect(azimuthLabel(350)).toBe('przodu')
  })
})
