import { useState } from 'react'
import FinishFields from './FinishFields.tsx'
import InheritableFinish from './InheritableFinish.tsx'
import { finishLabel, finishOf, type BoardFinish, type PanelDefaults } from '../boards/finish.ts'
import NumberField from '../ui/NumberField.tsx'
import { DIMENSION_STEP, formatNumber } from '../ui/format.ts'
import type { Board } from '../boards/board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import type { AnchorConstraint } from '../layout/constraints.ts'
import {
  AUTO_PITCH_DEFAULT,
  AUTO_PITCH_LIMITS,
  DIVIDER_LABELS,
  DIVIDER_PLURAL,
  ROOT_SECTION_ID,
  DIVIDER_ORIENTATION,
  addProblem,
  compartmentSizes,
  sectionLayout,
  allowedKinds,
  dividerFrontOffset,
  dividersUsingSectionFinish,
  effectiveSectionFinish,
  findSection,
  missingSectionAnchors,
  parentSection,
  sectionBoxes,
  sectionLabels,
  type DividerKind,
  type Section,
  type SectionBox,
  type SectionLayout,
} from '../sections/sections.ts'

interface Props {
  boards: Board[]
  furniture: Furniture
  constraints: AnchorConstraint[]
  sections: Section
  /** Selected section (null = none yet – the panel then shows the root). */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Board (model + thickness) + edge banding of the new shelves / partitions (the default of every section). */
  defaults: PanelDefaults
  onDefaultsChange: (defaults: PanelDefaults) => void
  /** Finish from the furniture parameters – used when the panel has no default finish of its own. */
  furnitureFinish: BoardFinish
  /** Sets (null = removes) the finish override of a section – inherited by its sub-sections. */
  onSectionFinishChange: (sectionId: string, finish: BoardFinish | null) => void
  /** Sets the section's finish on its dividers (and those of sub-sections without their own). */
  onApplySectionFinish: (sectionId: string) => void
  onAdd: (sectionId: string, kind: DividerKind) => void
  /** Equal / manual layout of the dividers of a section. */
  onLayoutChange: (sectionId: string, layout: SectionLayout) => void
  /** Automatic dividers of a section: kind + pitch [mm] (every divider reserves that much), null = off. */
  onAutoChange: (sectionId: string, auto: { kind: DividerKind; pitch: number } | null) => void
  /** Size [mm] of sub-section `index` (manual layout – the last one takes the rest). */
  onCompartmentSizeChange: (sectionId: string, index: number, value: number) => void
  onRemoveDivider: (boardId: string) => void
  onClear: (sectionId: string) => void
  onFrontOffsetChange: (sectionId: string, value: number) => void
  onRestoreJoints: () => void
  onDetails: (boardId: string) => void
  onClose: () => void
}

const KINDS: DividerKind[] = ['shelf', 'partition']
const ADD_LABELS: Record<DividerKind, string> = { shelf: 'Dodaj półkę', partition: 'Dodaj przedział' }
const FRONT_OFFSET_LIMITS = { min: 0, max: 500 }

const size = (b: SectionBox | undefined) =>
  b ? `${formatNumber(b.max[0] - b.min[0])} × ${formatNumber(b.max[1] - b.min[1])} × ${formatNumber(b.max[2] - b.min[2])} mm` : '–'

/** How a section came to be – for the tree ("między półkami" …). */
function origin(root: Section, s: Section): string {
  const parent = parentSection(root, s.id)
  if (!parent?.split) return 'cała przestrzeń mebla'
  return parent.split === 'shelf' ? 'między półkami' : 'między przedziałami'
}

/**
 * Helper panel "Półki i Przedziały": the tree of sections of the furniture (see `sections/sections.ts`),
 * the selected section with "Dodaj półkę" / "Dodaj przedział" (only what its place in the tree allows),
 * its default setback of the dividers from the front and the list of its dividers. The selection is
 * shared with the scene (sections as planes at the front of the furniture – `SectionOverlay`).
 */
export default function SectionsPanel({
  boards,
  furniture,
  constraints,
  sections,
  selectedId,
  onSelect,
  defaults,
  onDefaultsChange,
  furnitureFinish,
  onSectionFinishChange,
  onApplySectionFinish,
  onAdd,
  onLayoutChange,
  onAutoChange,
  onCompartmentSizeChange,
  onRemoveDivider,
  onClear,
  onFrontOffsetChange,
  onRestoreJoints,
  onDetails,
  onClose,
}: Props) {
  const labels = sectionLabels(sections)
  const boxes = sectionBoxes(sections, boards, furniture)
  const current = findSection(sections, selectedId) ?? sections
  const missing = missingSectionAnchors(constraints, boards, sections)
  const nameOf = (id: string) => boards.find((b) => b.id === id)?.name ?? '?'

  const renderTree = (s: Section) => (
    <li key={s.id}>
      <button
        type="button"
        className={`section-node${s.id === current.id ? ' section-node--selected' : ''}`}
        aria-current={s.id === current.id}
        data-section={s.id}
        onClick={() => onSelect(s.id)}
      >
        <b>{labels.get(s.id)}</b>
        <small>
          {origin(sections, s)}
          {s.split && ` · ${s.dividers.length} × ${DIVIDER_LABELS[s.split].toLowerCase()}`}
        </small>
      </button>
      {s.children.length > 0 && <ul className="section-tree">{s.children.map(renderTree)}</ul>}
    </li>
  )

  const box = boxes.get(current.id)
  // finish the section's new boards get: its own override, an ancestor's, or the panel default
  const parentOfCurrent = parentSection(sections, current.id)
  const inheritedSource = parentOfCurrent ? effectiveSectionFinish(sections, parentOfCurrent.id) : null
  const inherited: BoardFinish = inheritedSource?.finish ?? defaults.finish ?? furnitureFinish
  const inheritedFrom = inheritedSource?.from.id ?? null
  const applyCount = dividersUsingSectionFinish(sections, current.id).length
  const sizes = compartmentSizes(sections, current.id, boards, furniture)
  // side names of the edges only when the section can hold one kind of board
  const kinds = allowedKinds(sections, current.id)
  const finishOrientation = kinds.length === 1 ? DIVIDER_ORIENTATION[kinds[0]] : null
  // automatic dividers: the pitch / kind typed while the option is off (used when it is switched on)
  const [autoDraft, setAutoDraft] = useState<{ pitch: number; kind: DividerKind | null }>({ pitch: AUTO_PITCH_DEFAULT, kind: null })
  const auto = current.auto
  const autoKind: DividerKind = auto?.kind ?? current.split ?? (autoDraft.kind && kinds.includes(autoDraft.kind) ? autoDraft.kind : kinds[0])
  const autoPitch = auto?.pitch ?? autoDraft.pitch
  const autoAxisWord = autoKind === 'shelf' ? 'wysokości' : 'szerokości'
  return (
    <aside className="side-panel sections-panel" aria-label="Półki i Przedziały">
      <section className="side-panel-section">
        <div className="side-panel-header">
          <h2>Półki i Przedziały</h2>
          <button type="button" className="side-panel-close" aria-label="Zamknij" onClick={onClose}>×</button>
        </div>
        <p className="field-hint">
          Półki i przedziały dzielą mebel na sekcje. Wybierz sekcję z listy albo na scenie: <b>klik</b> – wejdź
          głębiej, <b>prawy klik</b> / <b>Esc</b> – poziom wyżej, <b>klik poza meblem</b> – od początku.
          <b> Przeciągnij pomarańczowy pasek</b> (przód półki / przedziału), żeby ją przesunąć.
        </p>
        <fieldset className="field finish-group" data-finish-group="sections-default">
          <legend>
            Płyta i obrzeże nowych półek / przedziałów <small>(domyślne – sekcja może je nadpisać)</small>
          </legend>
          <InheritableFinish
            idPrefix="sections-default"
            orientation={null}
            label="Własne dla półek i przedziałów"
            value={defaults.finish}
            inherited={furnitureFinish}
            inheritedFrom="z parametrów mebla"
            onChange={(finish) => onDefaultsChange({ ...defaults, finish })}
          />
        </fieldset>
        {missing > 0 && (
          <div className="carcass-warning">
            <span>Półkom / przedziałom brakuje wiązań ({missing}) – nie dopasują się do sekcji.</span>
            <button type="button" className="small-button" onClick={onRestoreJoints}>
              Odtwórz wiązania
            </button>
          </div>
        )}
      </section>

      <section className="side-panel-section" aria-label="Sekcje">
        <h2 className="board-list-title">Sekcje</h2>
        <ul className="section-tree section-tree--root">{renderTree(sections)}</ul>
      </section>

      <section className="side-panel-section section-details" aria-label="Wybrana sekcja" data-selected-section={current.id}>
        <h2 className="board-list-title">{labels.get(current.id)}</h2>
        <p className="board-card-summary">
          {size(box)} <small>(szer. × wys. × gł.)</small>
        </p>
        <div className="section-actions">
          {KINDS.map((kind) => {
            const problem = addProblem(sections, current.id, kind)
            return (
              <button
                key={kind}
                type="button"
                className="primary-button"
                data-action={`add-${kind}`}
                disabled={problem !== null}
                title={problem ?? undefined}
                onClick={() => onAdd(current.id, kind)}
              >
                + {ADD_LABELS[kind]}
              </button>
            )
          })}
        </div>
        {current.split === null && parentSection(sections, current.id)?.split && (
          <p className="field-hint">
            Sekcja {origin(sections, current)} – można ją podzielić tylko{' '}
            {parentSection(sections, current.id)!.split === 'shelf' ? 'przedziałami' : 'półkami'}.
          </p>
        )}
        {kinds.length > 0 && (
          <fieldset className="field finish-group section-auto" data-section-auto={auto ? 'on' : 'off'}>
            <legend>Automatyczne {autoKind === 'shelf' ? 'półki' : 'przedziały'}</legend>
            <label className="radio">
              <input
                type="checkbox"
                data-field="section-auto"
                checked={!!auto}
                onChange={(e) => onAutoChange(current.id, e.target.checked ? { kind: autoKind, pitch: autoPitch } : null)}
              />
              Dodawaj automatycznie
            </label>
            {kinds.length > 1 && !current.split && (
              <div className="section-auto-kinds">
                {kinds.map((k) => (
                  <label key={k} className="radio">
                    <input
                      type="radio"
                      name={`section-${current.id}-auto-kind`}
                      data-field={`section-auto-kind-${k}`}
                      checked={autoKind === k}
                      onChange={() => (auto ? onAutoChange(current.id, { kind: k, pitch: autoPitch }) : setAutoDraft({ ...autoDraft, kind: k }))}
                    />
                    {k === 'shelf' ? 'półki' : 'przedziały'}
                  </label>
                ))}
              </div>
            )}
            <label className="field">
              <span>
                Co ile [mm] <small>(miejsce jednej {autoKind === 'shelf' ? 'półki' : 'ścianki przedziału'} – od początku poprzedniej)</small>
              </span>
              <NumberField
                name={`section-${current.id}-auto-pitch`}
                data-field="section-auto-pitch"
                aria-label="Rozstaw automatycznych płyt"
                min={AUTO_PITCH_LIMITS.min}
                max={AUTO_PITCH_LIMITS.max}
                step={DIMENSION_STEP}
                scrubStep={10}
                value={autoPitch}
                onChange={(pitch) => (auto ? onAutoChange(current.id, { kind: autoKind, pitch }) : setAutoDraft({ ...autoDraft, pitch }))}
              />
            </label>
            <small className="field-hint">
              Pierwsza {autoKind === 'shelf' ? 'półka' : 'ścianka'} {formatNumber(autoPitch)} mm od {autoKind === 'shelf' ? 'dołu' : 'lewej'} sekcji,
              kolejne co {formatNumber(autoPitch)} mm – dopóki się mieszczą. Można je dalej dodawać, usuwać i przesuwać;
              gdy sekcja rośnie, dochodzą nowe co {formatNumber(autoPitch)} mm, a {autoKind === 'shelf' ? 'półka, na którą najedzie góra' : 'przedział, na który najedzie prawa strona'}{' '}
              zmniejszanej sekcji, znika. Zmiana rozstawu rozkłada je od nowa. Płyta i grubość – jak dla nowych płyt teraz.
            </small>
          </fieldset>
        )}
        <label className="field">
          <span>
            Domyślne odsunięcie od frontu [mm] <small>(półki / przedziały tej sekcji)</small>
          </span>
          <NumberField
            name={`section-${current.id}-front-offset`}
            data-field="section-front-offset"
            aria-label="Domyślne odsunięcie od frontu"
            min={FRONT_OFFSET_LIMITS.min}
            max={FRONT_OFFSET_LIMITS.max}
            step={DIMENSION_STEP}
            scrubStep={1}
            value={current.frontOffset}
            onChange={(v) => onFrontOffsetChange(current.id, v)}
          />
          <small className="field-hint">
            Wiązanie przodu płyty z frontem mebla. Dla pojedynczej płyty można je zmienić w „Szczegóły” → Wiązania.
          </small>
        </label>
        <fieldset className="field finish-group" data-finish-group="section">
          <legend>Płyta i obrzeże płyt tej sekcji</legend>
          <label className="radio">
            <input
              type="checkbox"
              data-field="section-finish-override"
              checked={!!current.finish}
              onChange={(e) =>
                onSectionFinishChange(current.id, e.target.checked ? finishOf(inherited) : null)
              }
            />
            Własne dla tej sekcji
            {!current.finish && (
              <small>
                ({inheritedFrom ? `z: ${labels.get(inheritedFrom)}` : defaults.finish ? 'domyślne' : 'z parametrów mebla'} – {finishLabel(inherited)})
              </small>
            )}
          </label>
          {current.finish && (
            <>
              <FinishFields
                idPrefix={`section-${current.id}`}
                orientation={finishOrientation}
                value={current.finish}
                onChange={(f) => onSectionFinishChange(current.id, f)}
              />
              <small className="field-hint">Dotyczy też jej podsekcji, które nie mają własnych.</small>
            </>
          )}
          {applyCount > 0 && (
            <button type="button" className="small-button" data-action="section-apply-finish" onClick={() => onApplySectionFinish(current.id)}>
              Zastosuj do płyt tej sekcji ({applyCount})
            </button>
          )}
        </fieldset>
        {current.split && (
          <>
            <fieldset className="field finish-group section-layout" data-section-layout={sectionLayout(current)}>
              <legend>Rozkład {current.split === 'shelf' ? 'półek' : 'przedziałów'}</legend>
              <label className="radio">
                <input
                  type="radio"
                  name={`section-${current.id}-layout`}
                  data-field="layout-equal"
                  checked={sectionLayout(current) === 'equal'}
                  onChange={() => onLayoutChange(current.id, 'equal')}
                />
                Równy <small>– sekcje zawsze po równo</small>
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name={`section-${current.id}-layout`}
                  data-field="layout-manual"
                  checked={sectionLayout(current) === 'manual'}
                  onChange={() => onLayoutChange(current.id, 'manual')}
                />
                Ręczny <small>– własne {current.split === 'shelf' ? 'wysokości' : 'szerokości'}; przy zmianie mebla zachowują proporcje</small>
              </label>
              {auto && (
                <label className="radio">
                  <input type="radio" name={`section-${current.id}-layout`} data-field="layout-auto" checked readOnly />
                  Automatyczny <small>– co {formatNumber(auto.pitch)} mm; {autoAxisWord} w mm zostają, ostatnia sekcja – reszta</small>
                </label>
              )}
              <ol className="compartments">
                {current.children.map((c, i) => {
                  const last = i === current.children.length - 1
                  const size = sizes[i] ?? 0
                  return (
                    <li key={c.id} className="compartment" data-compartment={i}>
                      <span className="compartment-name">{labels.get(c.id)}</span>
                      {last ? (
                        <span className="compartment-rest" data-field="compartment-rest">
                          {formatNumber(size)} mm <small>(reszta)</small>
                        </span>
                      ) : (
                        <NumberField
                          name={`section-${current.id}-compartment-${i}`}
                          data-field={`compartment-${i}`}
                          aria-label={`${current.split === 'shelf' ? 'Wysokość' : 'Szerokość'} – ${labels.get(c.id)}`}
                          min={0}
                          max={size + (sizes[sizes.length - 1] ?? 0)}
                          step={DIMENSION_STEP}
                          scrubStep={1}
                          value={size}
                          onChange={(v) => onCompartmentSizeChange(current.id, i, v)}
                        />
                      )}
                    </li>
                  )
                })}
              </ol>
              <small className="field-hint">
                {current.split === 'shelf' ? 'Wysokości' : 'Szerokości'} w świetle (między płytami), od {current.split === 'shelf' ? 'dołu' : 'lewej'}.
                Wpisany wymiar zmienia tylko tę sekcję i ostatnią (reszta).{' '}
                {auto
                  ? 'Rozkład automatyczny zostaje; wybranie Równy / Ręczny wyłącza dodawanie automatyczne.'
                  : `Zmiana wymiaru albo przeciągnięcie ${current.split === 'shelf' ? 'półki' : 'przedziału'} na scenie włącza rozkład ręczny.`}
              </small>
            </fieldset>
            <h3 className="section-subtitle">
              Podzielona {DIVIDER_PLURAL[current.split]} ({current.dividers.length})
            </h3>
            <ul className="board-list">
              {current.dividers.map((id) => {
                const front = dividerFrontOffset(constraints, current, id)
                return (
                  <li key={id} className="board-card section-divider" data-divider={id}>
                    <div className="board-card-header">
                      <div className="board-card-title">
                        <b>{nameOf(id)}</b>
                        <span className="board-card-summary">
                          odsunięcie od frontu:{' '}
                          {front.offset === null ? 'brak wiązania' : `${formatNumber(front.offset)} ${front.unit}`}
                          {front.overridden && <b className="section-override"> (nadpisane)</b>}
                        </span>
                      </div>
                      <div className="board-card-actions">
                        <button type="button" className="small-button" onClick={() => onDetails(id)}>
                          Szczegóły
                        </button>
                        <button type="button" className="small-button small-button--danger" onClick={() => onRemoveDivider(id)} aria-label={`Usuń ${nameOf(id)}`}>
                          Usuń
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <button type="button" className="small-button small-button--danger section-clear" onClick={() => onClear(current.id)}>
              Usuń podział tej sekcji
            </button>
          </>
        )}
        {current.id !== ROOT_SECTION_ID && (
          <button type="button" className="small-button section-up" onClick={() => onSelect(parentSection(sections, current.id)?.id ?? null)}>
            ↑ Sekcja wyżej
          </button>
        )}
      </section>
    </aside>
  )
}
