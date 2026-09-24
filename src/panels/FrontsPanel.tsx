import NumberField from '../ui/NumberField.tsx'
import InheritableFinish from './InheritableFinish.tsx'
import { DIMENSION_STEP, formatNumber } from '../ui/format.ts'
import type { Board } from '../boards/board.ts'
import type { BoardFinish } from '../boards/finish.ts'
import type { Furniture } from '../furniture/furniture.ts'
import { parentSection, sectionBoxes, sectionLabels, type Section } from '../sections/sections.ts'
import {
  FRONT_GAP_LIMITS,
  MOUNT_LABELS,
  OPENING_LABELS,
  addFrontProblem,
  coversConflict,
  frontCoverage,
  frontOverlaps,
  selectionCovers,
  selectionRange,
  type FrontSelection,
  type Front,
  type FrontMount,
  type FrontOpening,
} from '../fronts/fronts.ts'

/** Defaults of new fronts (finish null = inherited from the furniture parameters). */
export interface FrontDefaults {
  /** Luz w poziomie / w pionie [mm] – the whole gap, half of it on each side. */
  gapH: number
  gapV: number
  mount: FrontMount
  opening: FrontOpening
  finish: BoardFinish | null
}

interface Props {
  boards: Board[]
  furniture: Furniture
  sections: Section
  fronts: Front[]
  /**
   * Selected section (id null = none yet – the panel then shows the root) and the run of its
   * sub-sections for a new front (shared with the scene – Ctrl + click there).
   */
  selection: FrontSelection
  onSelectionChange: (sel: FrontSelection) => void
  defaults: FrontDefaults
  onDefaultsChange: (d: FrontDefaults) => void
  furnitureFinish: BoardFinish
  openFronts: Set<string>
  onToggleOpen: (frontId: string) => void
  onAllOpen: (open: boolean) => void
  onAdd: (covers: string[]) => void
  onChange: (frontId: string, patch: Partial<Pick<Front, 'mount' | 'gapH' | 'gapV' | 'opening'>>) => void
  onRemove: (frontId: string) => void
  onDetails: (boardId: string) => void
  onClose: () => void
  /** Front clicked in the list (its sections are highlighted in the scene) – null = none. */
  highlightedFront: string | null
  onHighlightFront: (frontId: string | null) => void
}

const MOUNTS = Object.keys(MOUNT_LABELS) as FrontMount[]
const OPENINGS = Object.keys(OPENING_LABELS) as FrontOpening[]
const OPENING_ICONS: Record<FrontOpening, string> = { ltr: '⇥', rtl: '⇤', double: '⇤⇥', down: '⤓', up: '⤒' }

/**
 * Helper panel "Fronty": doors / flaps covering the sections (see `fronts/fronts.ts`). The section tree
 * (shared selection with the scene), the new front of the selected section (all of it or a run of its
 * sub-sections, mounting, opening, mounting gap) and the list of the fronts with open / close.
 */
export default function FrontsPanel({
  boards,
  furniture,
  sections,
  fronts,
  selection,
  onSelectionChange,
  defaults,
  onDefaultsChange,
  furnitureFinish,
  openFronts,
  onToggleOpen,
  onAllOpen,
  onAdd,
  onChange,
  onRemove,
  onDetails,
  onClose,
  highlightedFront,
  onHighlightFront,
}: Props) {
  const labels = sectionLabels(sections)
  const boxes = sectionBoxes(sections, boards, furniture)
  const onSelect = (id: string | null) => onSelectionChange({ id, range: null })
  // range of sub-sections of the selected section (all = the whole section)
  const { section: current, from, to } = selectionRange(sections, selection)
  const n = current.children.length
  const setRange = (r: { section: string; from: number; to: number }) => onSelectionChange({ id: current.id, range: r })
  const covers = selectionCovers(sections, selection)
  const problem = addFrontProblem(sections, fronts, covers, boards)
  const nameOf = (id: string) => boards.find((b) => b.id === id)?.name ?? '?'
  const frontName = (f: Front) => nameOf(f.boards[0]).replace(/ [LP]$/, '')
  const coverLabel = (f: Front) => {
    const cov = frontCoverage(sections, f.covers)
    if (!cov) return '?'
    if (!cov.range) return labels.get(cov.section.id)
    return `${labels.get(cov.section.children[cov.range[0]].id)} – ${labels.get(cov.section.children[cov.range[1]].id)}`
  }
  const overlaps = frontOverlaps(fronts, boards)
  // sub-sections picked for the new front (a run – Ctrl + click in the scene or od / do below)
  const picked = new Set(covers.length > 1 ? covers : [])
  const frontsIn = (s: Section) => fronts.filter((f) => coversConflict(sections, f.covers, [s.id]))

  const renderTree = (s: Section) => {
    const own = fronts.filter((f) => f.covers.includes(s.id))
    return (
      <li key={s.id}>
        <button
          type="button"
          className={`section-node${s.id === current.id ? ' section-node--selected' : ''}${picked.has(s.id) ? ' section-node--picked' : ''}`}
          data-section={s.id}
          onClick={() => onSelect(s.id)}
        >
          <b>{labels.get(s.id)}</b>
          <small>{own.length > 0 ? `front: ${own.map(frontName).join(', ')}` : 'bez frontu'}</small>
        </button>
        {s.children.length > 0 && <ul className="section-tree">{s.children.map(renderTree)}</ul>}
      </li>
    )
  }

  const box = boxes.get(current.id)
  return (
    <aside className="side-panel fronts-panel" aria-label="Fronty">
      <section className="side-panel-section">
        <div className="side-panel-header">
          <h2>Fronty</h2>
          <button type="button" className="side-panel-close" aria-label="Zamknij" onClick={onClose}>×</button>
        </div>
        <p className="field-hint">
          Front zamyka sekcję (całą albo kilka sąsiednich podsekcji). Fronty nie mogą na siebie nachodzić – także w
          sekcjach nad- i podrzędnych. Wybierz sekcję z listy albo na scenie (<b>klik</b> – głębiej, <b>prawy klik</b> – wyżej).
        </p>
        <div className="front-defaults">
          <label className="field">
            <span>
              Luz w poziomie [mm] <small>(łącznie – po ½ z lewej i z prawej; ujemny powiększa front)</small>
            </span>
            <NumberField
              name="front-gapH"
              data-field="front-gapH"
              min={FRONT_GAP_LIMITS.min}
              max={FRONT_GAP_LIMITS.max}
              step={DIMENSION_STEP}
              scrubStep={0.5}
              value={defaults.gapH}
              onChange={(gapH) => onDefaultsChange({ ...defaults, gapH })}
            />
          </label>
          <label className="field">
            <span>
              Luz w pionie [mm] <small>(łącznie – po ½ u góry i na dole; ujemny powiększa front)</small>
            </span>
            <NumberField
              name="front-gapV"
              data-field="front-gapV"
              min={FRONT_GAP_LIMITS.min}
              max={FRONT_GAP_LIMITS.max}
              step={DIMENSION_STEP}
              scrubStep={0.5}
              value={defaults.gapV}
              onChange={(gapV) => onDefaultsChange({ ...defaults, gapV })}
            />
          </label>
          <p className="field-hint" data-hint="negative-gap">
            Ujemny luz rozszerza front nakładany ponad krawędź sekcji (np. −18 mm = cała półka 18 mm zamiast połowy).
            Front nigdy nie wychodzi poza mebel, a sąsiedni front za tą półką cofa się, zachowując swój luz. Front
            wpuszczany nie może wejść w płyty – ujemny luz działa dla niego jak 0.
          </p>
          <fieldset className="field finish-group" data-finish-group="fronts-default">
            <legend>Płyta i obrzeże frontów <small>(model płyty wyznacza teksturę i grubość)</small></legend>
            <InheritableFinish
              idPrefix="fronts-default"
              orientation="vertical"
              label="Własne dla frontów"
              value={defaults.finish}
              inherited={furnitureFinish}
              inheritedFrom="z parametrów mebla"
              onChange={(finish) => onDefaultsChange({ ...defaults, finish })}
            />
          </fieldset>
        </div>
      </section>

      <section className="side-panel-section" aria-label="Sekcje">
        <h2 className="board-list-title">Sekcje</h2>
        <ul className="section-tree section-tree--root">{renderTree(sections)}</ul>
      </section>

      <section className="side-panel-section section-details" aria-label="Nowy front" data-selected-section={current.id}>
        <h2 className="board-list-title">{labels.get(current.id)}</h2>
        <p className="board-card-summary">
          {box ? `${formatNumber(box.max[0] - box.min[0])} × ${formatNumber(box.max[1] - box.min[1])} mm (szer. × wys.)` : '–'}
        </p>
        {n > 0 && (
          <fieldset className="field front-range">
            <legend>Zakres frontu</legend>
            <div className="front-range-row">
              <label>
                od
                <select data-field="front-from" value={from} onChange={(e) => setRange({ section: current.id, from: Number(e.target.value), to })}>
                  {current.children.map((c, i) => (
                    <option key={c.id} value={i}>
                      {labels.get(c.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                do
                <select data-field="front-to" value={to} onChange={(e) => setRange({ section: current.id, from, to: Number(e.target.value) })}>
                  {current.children.map((c, i) => (
                    <option key={c.id} value={i}>
                      {labels.get(c.id)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <small className="field-hint">{covers[0] === current.id ? 'Cała sekcja.' : `Podsekcje ${from + 1}–${to + 1}.`}</small>
          </fieldset>
        )}
        <fieldset className="field">
          <legend>Montaż</legend>
          {MOUNTS.map((m) => (
            <label key={m} className="radio">
              <input type="radio" name="front-mount" data-field={`mount-${m}`} checked={defaults.mount === m} onChange={() => onDefaultsChange({ ...defaults, mount: m })} />
              {MOUNT_LABELS[m]}
            </label>
          ))}
        </fieldset>
        <fieldset className="field">
          <legend>Otwieranie</legend>
          {OPENINGS.map((o) => (
            <label key={o} className="radio">
              <input type="radio" name="front-opening" data-field={`opening-${o}`} checked={defaults.opening === o} onChange={() => onDefaultsChange({ ...defaults, opening: o })} />
              <span className="opening-icon" aria-hidden="true">{OPENING_ICONS[o]}</span>
              {OPENING_LABELS[o]}
            </label>
          ))}
        </fieldset>
        <button type="button" className="primary-button" data-action="add-front" disabled={problem !== null} title={problem ?? undefined} onClick={() => onAdd(covers)}>
          + Dodaj front
        </button>
        {problem && <p className="field-error">{problem}</p>}
        {current.id !== sections.id && (
          <button type="button" className="small-button section-up" onClick={() => onSelect(parentSection(sections, current.id)?.id ?? null)}>
            ↑ Sekcja wyżej
          </button>
        )}
      </section>

      <section className="side-panel-section" aria-label="Fronty mebla">
        <div className="fronts-list-head">
          <h2 className="board-list-title">Fronty ({fronts.length})</h2>
          {fronts.length > 0 && (
            <button type="button" className="small-button" data-action="fronts-open-all" onClick={() => onAllOpen(!fronts.every((f) => openFronts.has(f.id)))}>
              {fronts.every((f) => openFronts.has(f.id)) ? 'Zamknij wszystkie' : 'Otwórz wszystkie'}
            </button>
          )}
        </div>
        {fronts.length === 0 && <p className="board-list-empty">Brak frontów.</p>}
        <ul className="board-list">
          {fronts.map((f) => {
            const open = openFronts.has(f.id)
            const inCurrent = frontsIn(current).includes(f)
            const leaf = boards.find((b) => b.id === f.boards[0])
            return (
              <li
                key={f.id}
                className={`board-card front-card${inCurrent ? ' front-card--here' : ''}${highlightedFront === f.id ? ' front-card--selected' : ''}`}
                data-front={f.id}
                aria-selected={highlightedFront === f.id}
                title="Kliknij, aby podświetlić sekcje tego frontu na scenie"
                onClick={(e) => {
                  // the controls on the card keep working on their own
                  if ((e.target as HTMLElement).closest('button, input, select, label, a')) return
                  onHighlightFront(highlightedFront === f.id ? null : f.id)
                }}
              >
                <div className="board-card-header">
                  <div className="board-card-title">
                    <b>{frontName(f)}</b>
                    <span className="board-card-summary">
                      {coverLabel(f)} · {f.boards.length === 2 ? '2 skrzydła' : '1 skrzydło'}
                      {leaf && ` · ${formatNumber(leaf.width)}×${formatNumber(leaf.height)}×${formatNumber(leaf.thickness)} mm`}
                    </span>
                  </div>
                  <div className="board-card-actions">
                    <button type="button" className="small-button" aria-pressed={open} data-action="front-toggle" onClick={() => onToggleOpen(f.id)}>
                      {open ? 'Zamknij' : 'Otwórz'}
                    </button>
                    <button type="button" className="small-button small-button--danger" onClick={() => onRemove(f.id)} aria-label={`Usuń ${frontName(f)}`}>
                      Usuń
                    </button>
                  </div>
                </div>
                {overlaps.has(f.id) && (
                  <p className="carcass-warning" data-warning="front-overlap">
                    Nachodzi na: {overlaps.get(f.id)!.join(', ')} – oba fronty rozszerzono ujemnym luzem nad tę samą
                    płytę. Zwiększ luz jednego z nich.
                  </p>
                )}
                <div className="front-card-fields">
                  <select aria-label="Montaż" data-field="front-mount" value={f.mount} onChange={(e) => onChange(f.id, { mount: e.target.value as FrontMount })}>
                    {MOUNTS.map((m) => (
                      <option key={m} value={m}>
                        {MOUNT_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Otwieranie" data-field="front-opening" value={f.opening} onChange={(e) => onChange(f.id, { opening: e.target.value as FrontOpening })}>
                    {OPENINGS.map((o) => (
                      <option key={o} value={o}>
                        {OPENING_ICONS[o]} {OPENING_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  <label className="front-gap-row">
                    Luz w poziomie [mm]
                    <NumberField
                      name={`front-${f.id}-gapH`}
                      data-field="front-card-gapH"
                      min={FRONT_GAP_LIMITS.min}
                      max={FRONT_GAP_LIMITS.max}
                      step={DIMENSION_STEP}
                      scrubStep={0.5}
                      value={f.gapH}
                      onChange={(gapH) => onChange(f.id, { gapH })}
                    />
                  </label>
                  <label className="front-gap-row">
                    Luz w pionie [mm]
                    <NumberField
                      name={`front-${f.id}-gapV`}
                      data-field="front-card-gapV"
                      min={FRONT_GAP_LIMITS.min}
                      max={FRONT_GAP_LIMITS.max}
                      step={DIMENSION_STEP}
                      scrubStep={0.5}
                      value={f.gapV}
                      onChange={(gapV) => onChange(f.id, { gapV })}
                    />
                  </label>
                  <div className="front-leaves">
                    {f.boards.map((id) => (
                      <button key={id} type="button" className="small-button" onClick={() => onDetails(id)}>
                        Szczegóły: {nameOf(id)}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
