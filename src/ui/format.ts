/**
 * Number formatting / parsing for the UI (Polish convention – decimal comma).
 * The app works in millimetres and accepts fractional values (e.g. 18,5 mm or 0,8 mm edge bands).
 */

/** Precision [mm] of board / furniture dimensions and positions. */
export const DIMENSION_STEP = 0.1

/** Formats a number with a decimal comma and at most `maxDecimals` decimals (no trailing zeros): 18,5 · 0,8 · 600 */
export function formatNumber(v: number, maxDecimals = 2): string {
  if (!Number.isFinite(v)) return ''
  return String(Number(v.toFixed(maxDecimals)) || 0).replace('.', ',')
}

/** Parses user text accepting both a comma and a dot as the decimal separator; `null` if it is not a number. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
