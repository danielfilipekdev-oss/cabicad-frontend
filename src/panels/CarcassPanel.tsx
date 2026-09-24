import { useState } from 'react'
import FinishFields from './FinishFields.tsx'
import InheritableFinish from './InheritableFinish.tsx'
import { finishLabel, finishOf, type BoardFinish, type PanelDefaults } from '../boards/finish.ts'
import CarcassPreview from './CarcassPreview.tsx'
import { formatNumber } from '../ui/format.ts'
import { ORIENTATION_LABELS, type Board } from '../boards/board.ts'
import type { AnchorConstraint } from '../layout/constraints.ts'
import {
  CARCASS_LABELS,
  CARCASS_ORIENTATION,
  CARCASS_ROLES,
  carcassNeighbors,
  covers,
  findRoleBoard,
  missingCarcassAnchors,
  overriddenCarcassFaces,
  relationLabels,
  setCovers,
  type CarcassRelations,
  type CarcassRole,
} from '../carcass/carcass.ts'

interface Props {
  boards: Board[]
  constraints: AnchorConstraint[]
  relations: CarcassRelations
  /** Board (model + thickness) + edge banding of the new carcass boards (the default of every role). */
  defaults: PanelDefaults
  onDefaultsChange: (defaults: PanelDefaults) => void
  /** Finish from the furniture parameters – used when the carcass has no default finish of its own. */
  furnitureFinish: BoardFinish
  /** Board + edge banding of a role overriding the defaults when that board is added. */
  overrides: Partial<Record<CarcassRole, BoardFinish>>
  onOverrideChange: (role: CarcassRole, finish: BoardFinish | null) => void
  /** Sets the configured finish (override of the role, else the default) on the carcass boards already added. */
  onApplyFinish: () => void
  onAdd: (role: CarcassRole) => void
  onAddAll: () => void
  onRelationsChange: (relations: CarcassRelations) => void
  /** Regenerates the carcass joints (e.g. after some were removed by hand). */
  onRestoreJoints: () => void
  onRemove: (id: string) => void
  /** Opens the board in the "Płyty" list (all its parameters, joints…). */
  onDetails: (id: string) => void
  /**
   * The mouse is over / focus on an "add" button: the roles it would add (previewed in the scene as a
   * green wireframe), null = none.
   */
  onPreview?: (roles: CarcassRole[] | null) => void
}

/**
 * One relation row as the panel shows it: towards one neighbour, or towards both sides at once
 * (dach / podłoga / plecy – a beginner sets "między bokami" once, not for each side).
 */
interface RelationRow {
  key: string
  label: string
  neighbors: CarcassRole[]
}

function relationRows(role: CarcassRole): RelationRow[] {
  const ns = carcassNeighbors(role)
  const sides: CarcassRole[] = ns.filter((n) => n === 'left' || n === 'right')
  const rows: RelationRow[] = []
  if (sides.length === 2 && role !== 'left' && role !== 'right') rows.push({ key: 'sides', label: 'Boki', neighbors: sides })
  for (const n of ns) if (!(rows[0]?.key === 'sides' && sides.includes(n))) rows.push({ key: n, label: CARCASS_LABELS[n], neighbors: [n] })
  return rows
}

/** Labels of a row: [role covers the neighbour(s), neighbour(s) cover the role]. */
function rowLabels(role: CarcassRole, row: RelationRow): [string, string] {
  if (row.key !== 'sides') return relationLabels(role, row.neighbors[0])
  const [covering, between] = relationLabels(role, 'left')
  return [covering.replace(' lewy bok', ' boki').replace(' lewym bokiem', ' bokami'), between]
}

/**
 * "Płyty korpusu" – the top part of the "Dodaj płytę" panel – the quick way for beginners: dach, podłoga, lewy / prawy bok and plecy
 * added with one click, each at most once. Where a board ends up is set by its relation to the
 * neighbours (nałożony na boki / między bokami, pod dachem / przykrywa dach …) – the relations can be
 * chosen before adding and changed any time later; the boards are then placed with ordinary joints
 * (see `carcass/carcass.ts`), so they follow the furniture size and can be tuned in "Płyty".
 * Hovering a tile previews the boards it would add (`onPreview`).
 */
export default function CarcassPanel({
  boards,
  constraints,
  relations,
  defaults,
  onDefaultsChange,
  furnitureFinish,
  overrides,
  onOverrideChange,
  onApplyFinish,
  onAdd,
  onAddAll,
  onRelationsChange,
  onRestoreJoints,
  onRemove,
  onDetails,
  onPreview,
}: Props) {
  const present = new Set(CARCASS_ROLES.filter((r) => findRoleBoard(boards, r)))
  const [open, setOpen] = useState<CarcassRole | null>(() => CARCASS_ROLES.find((r) => !present.has(r)) ?? null)
  // finish of new boards without an override: the carcass default, else the furniture one
  const defaultFinish = defaults.finish ?? furnitureFinish
  const missingJoints = missingCarcassAnchors(constraints, boards, relations)
  const overridden = overriddenCarcassFaces(constraints, boards, relations)

  const setRow = (role: CarcassRole, row: RelationRow, roleCovers: boolean) => {
    let next = relations
    for (const n of row.neighbors) next = roleCovers ? setCovers(next, role, n) : setCovers(next, n, role)
    onRelationsChange(next)
  }

  /**
   * Mouse over / focus in a tile → the boards it would add are previewed in the scene (green wireframe):
   * the top tile (whole carcass) – all boards not added yet, a role tile – that board if not added yet.
   */
  const previewHandlers = (roles: CarcassRole[]) => ({
    onMouseEnter: () => onPreview?.(roles.length ? roles : null),
    onMouseLeave: () => onPreview?.(null),
    onFocus: () => onPreview?.(roles.length ? roles : null),
    onBlur: () => onPreview?.(null),
  })

  return (
    <div className="carcass-panel" aria-label="Płyty korpusu" data-section="carcass">
      <section className="side-panel-section carcass-add-all-tile" data-carcass-tile="all" {...previewHandlers(CARCASS_ROLES.filter((r) => !present.has(r)))}>
        <h3 className="side-panel-subtitle">Płyty korpusu</h3>
        <p className="field-hint">
          Gotowe płyty szafki – każdą można dodać tylko raz. Wybierz, jak ma się łączyć z sąsiednimi płytami;
          płyty same dopasują się do wymiarów mebla.
        </p>
        <CarcassPreview relations={relations} present={present} highlighted={open} />
        <div className="side-panel-form carcass-common">
          <fieldset className="field finish-group" data-finish-group="carcass-default">
            <legend>
              Płyta i obrzeże nowych płyt korpusu <small>(domyślne – każdą płytę można nadpisać niżej)</small>
            </legend>
            <InheritableFinish
              idPrefix="carcass-default"
              orientation={null}
              label="Własne dla płyt korpusu"
              value={defaults.finish}
              inherited={furnitureFinish}
              inheritedFrom="z parametrów mebla"
              onChange={(finish) => onDefaultsChange({ ...defaults, finish })}
            />
            {present.size > 0 && (
              <button
                type="button"
                className="small-button"
                data-action="carcass-apply-finish"
                title="Ustawia płytę (model, grubość, usłojenie) i obrzeże z konfiguracji (nadpisanie płyty albo domyślne) na już dodanych płytach korpusu"
                onClick={onApplyFinish}
              >
                Zastosuj do dodanych płyt korpusu
              </button>
            )}
          </fieldset>
          <button
            type="button"
            className="primary-button"
            data-action="carcass-add-all"
            disabled={present.size === CARCASS_ROLES.length}
            onClick={onAddAll}
          >
            {present.size === 0 ? 'Dodaj cały korpus' : present.size === CARCASS_ROLES.length ? 'Korpus kompletny' : 'Dodaj brakujące płyty'}
          </button>
          {missingJoints > 0 && (
            <div className="carcass-warning">
              <span>Płyty korpusu nie mają części wiązań ({missingJoints}) – nie dopasują się do mebla.</span>
              <button type="button" className="small-button" onClick={onRestoreJoints}>
                Odtwórz wiązania
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="side-panel-section" aria-label="Lista płyt korpusu">
        <ul className="board-list">
          {CARCASS_ROLES.map((role) => {
            const board = findRoleBoard(boards, role)
            const expanded = open === role
            const ownOverrides = board ? overridden.filter((s) => s.board === board.id).length : 0
            return (
              <li
                key={role}
                className={`board-card carcass-card${expanded ? ' carcass-card--open' : ''}`}
                data-role={role}
                {...previewHandlers(board ? [] : [role])}
              >
                <div className="board-card-header" onClick={(e) => !(e.target as HTMLElement).closest('button') && setOpen(expanded ? null : role)}>
                  <div className="board-card-title">
                    <b>
                      <span className="carcass-toggle" aria-hidden="true">{expanded ? '▾' : '▸'}</span> {CARCASS_LABELS[role]}
                    </b>
                    <span className="board-card-summary">
                      {board ? (
                        <>
                          {formatNumber(board.width)}×{formatNumber(board.height)}×{formatNumber(board.thickness)} mm
                        </>
                      ) : (
                        <span className="carcass-missing">nie dodano · {ORIENTATION_LABELS[CARCASS_ORIENTATION[role]].toLowerCase()}</span>
                      )}
                    </span>
                  </div>
                  <div className="board-card-actions">
                    {board ? (
                      <>
                        <button type="button" className="small-button" onClick={() => onDetails(board.id)} title="Otwiera tę płytę w „Płyty” – wymiary, płyta, obrzeża, wycięcia i wiązania">
                          Szczegóły
                        </button>
                        <button type="button" className="small-button small-button--danger" onClick={() => onRemove(board.id)} aria-label={`Usuń ${CARCASS_LABELS[role]}`}>
                          Usuń
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="small-button carcass-add"
                        data-action={`carcass-add-${role}`}
                        onClick={() => onAdd(role)}
                      >
                        + Dodaj
                      </button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="carcass-relations">
                    {relationRows(role).map((row) => {
                      const [coverLabel, coveredLabel] = rowLabels(role, row)
                      const coversAll = row.neighbors.every((n) => covers(relations, role, n))
                      const coveredAll = row.neighbors.every((n) => covers(relations, n, role))
                      const neighborsPresent = row.neighbors.filter((n) => present.has(n)).length
                      const name = `carcass-${role}-${row.key}`
                      return (
                        <fieldset key={row.key} className="field carcass-relation" data-relation={row.key}>
                          <legend>
                            {row.label}{' '}
                            {neighborsPresent < row.neighbors.length && (
                              <small>{neighborsPresent === 0 ? '(jeszcze nie dodano)' : '(dodano jeden)'}</small>
                            )}
                          </legend>
                          <label className="radio">
                            <input type="radio" name={name} checked={coversAll} onChange={() => setRow(role, row, true)} />
                            {coverLabel}
                          </label>
                          <label className="radio">
                            <input type="radio" name={name} checked={coveredAll} onChange={() => setRow(role, row, false)} />
                            {coveredLabel}
                          </label>
                          {!coversAll && !coveredAll && <small className="field-hint">Lewy i prawy bok są ustawione różnie.</small>}
                        </fieldset>
                      )
                    })}
                    {ownOverrides > 0 && (
                      <p className="field-hint">
                        {ownOverrides === 1 ? 'Jedno wiązanie tej płyty zostało' : `${ownOverrides} wiązania tej płyty zostały`} zmienione ręcznie –
                        ręczne wiązania mają pierwszeństwo.
                      </p>
                    )}
                    <div className="carcass-finish" data-carcass-finish={role}>
                      {board ? (
                        <p className="field-hint">
                          {finishLabel(board)}. Zmienisz je w <b>Szczegóły</b> albo przyciskiem „Zastosuj do dodanych płyt korpusu”.
                        </p>
                      ) : (
                        <>
                          <label className="radio">
                            <input
                              type="checkbox"
                              data-field={`carcass-override-${role}`}
                              checked={!!overrides[role]}
                              onChange={(e) =>
                                onOverrideChange(role, e.target.checked ? finishOf(defaultFinish) : null)
                              }
                            />
                            Własna płyta i obrzeże
                            {!overrides[role] && <small>(domyślne: {finishLabel(defaultFinish)})</small>}
                          </label>
                          {overrides[role] && (
                            <FinishFields
                              idPrefix={`carcass-${role}`}
                              orientation={CARCASS_ORIENTATION[role]}
                              value={overrides[role]!}
                              onChange={(f) => onOverrideChange(role, f)}
                            />
                          )}
                        </>
                      )}
                    </div>
                    {!board && (
                      <button type="button" className="primary-button" onClick={() => onAdd(role)}>
                        Dodaj: {CARCASS_LABELS[role]}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
