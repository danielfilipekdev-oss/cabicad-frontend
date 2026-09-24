import { useMemo } from 'react'
import { boardBounds } from '../boards/board.ts'
import {
  CARCASS_LABELS,
  CARCASS_ROLES,
  addCarcassBoard,
  findRoleBoard,
  type CarcassRelations,
  type CarcassRole,
  type CarcassState,
} from '../carcass/carcass.ts'

/**
 * Schematic of the carcass (three small projections) for the chosen relations – built with the same
 * code as the real carcass (`addCarcassBoard` → joints → solver) on a small model furniture with thick
 * boards, so what the beginner sees is exactly what "nałożony / między" does.
 * Boards already added are filled, missing ones dashed; the role being edited is highlighted.
 */
const S = 100 // model furniture size (cube)
const T = 14 // exaggerated thickness – the corners are easy to read
const MODEL = { width: S, height: S, depth: S }

const ROLE_COLOR: Record<CarcassRole, string> = {
  top: '#e0a050',
  bottom: '#7fb069',
  left: '#5b8fd6',
  right: '#5b8fd6',
  back: '#b58ad6',
}

type View = {
  title: string
  /** Horizontal / vertical axis of the view and whether it is flipped. */
  h: 0 | 1 | 2
  v: 0 | 1 | 2
  flipH: boolean
  flipV: boolean
  /** Boards drawn (back to front) – a board lying in the view plane would hide the others. */
  roles: CarcassRole[]
  /** Labels of the two ends of the horizontal axis. */
  ends: [string, string]
}

const VIEWS: View[] = [
  { title: 'Z przodu', h: 0, v: 1, flipH: false, flipV: true, roles: ['top', 'bottom', 'left', 'right'], ends: ['lewo', 'prawo'] },
  { title: 'Z boku', h: 2, v: 1, flipH: false, flipV: true, roles: ['top', 'bottom', 'back'], ends: ['tył', 'przód'] },
  { title: 'Z góry', h: 0, v: 2, flipH: false, flipV: false, roles: ['left', 'right', 'back'], ends: ['lewo', 'prawo'] },
]

interface Props {
  relations: CarcassRelations
  /** Roles already added to the furniture. */
  present: Set<CarcassRole>
  /** Role currently edited in the panel. */
  highlighted: CarcassRole | null
}

export default function CarcassPreview({ relations, present, highlighted }: Props) {
  const model = useMemo(() => {
    let s: CarcassState = { boards: [], constraints: [] }
    for (const r of CARCASS_ROLES) s = addCarcassBoard(MODEL, s.boards, s.constraints, relations, r, { thickness: T })
    return s
  }, [relations])

  const pad = 6
  const size = S + pad * 2
  return (
    <div className="carcass-preview" aria-label="Schemat korpusu">
      {VIEWS.map((view) => (
        <figure key={view.title} className="carcass-preview-view">
          <svg viewBox={`0 0 ${size} ${size + 10}`} width="100%" role="img" aria-label={`Widok ${view.title.toLowerCase()}`}>
            <rect x={pad} y={pad} width={S} height={S} className="carcass-preview-frame" />
            {view.roles
              .map((role) => ({ role, board: findRoleBoard(model.boards, role)! }))
              .sort((a, b) => Number(a.role === highlighted) - Number(b.role === highlighted))
              .map(({ role, board }) => {
                const { min, max } = boardBounds(board)
                const x0 = view.flipH ? S - max[view.h] : min[view.h]
                const y0 = view.flipV ? S - max[view.v] : min[view.v]
                const on = present.has(role)
                return (
                  <rect
                    key={role}
                    x={pad + x0}
                    y={pad + y0}
                    width={max[view.h] - min[view.h]}
                    height={max[view.v] - min[view.v]}
                    fill={on ? ROLE_COLOR[role] : 'none'}
                    fillOpacity={on ? 0.85 : undefined}
                    stroke={role === highlighted ? '#111' : ROLE_COLOR[role]}
                    strokeWidth={role === highlighted ? 2 : 1}
                    strokeDasharray={on ? undefined : '3 2'}
                    data-role={role}
                  >
                    <title>
                      {CARCASS_LABELS[role]}
                      {on ? '' : ' (nie dodano)'}
                    </title>
                  </rect>
                )
              })}
            <text x={pad} y={size + 7} className="carcass-preview-end">{view.ends[0]}</text>
            <text x={size - pad} y={size + 7} className="carcass-preview-end" textAnchor="end">{view.ends[1]}</text>
          </svg>
          <figcaption>{view.title}</figcaption>
        </figure>
      ))}
    </div>
  )
}
