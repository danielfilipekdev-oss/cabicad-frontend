import { useMemo, useState } from 'react'
import NumberField from '../ui/NumberField.tsx'
import { formatNumber } from '../ui/format.ts'
import type { BoardOrientation } from '../boards/board.ts'
import {
  DEFAULT_EDGE_BAND_THICKNESS,
  EDGE_BAND_THICKNESS_LIMITS,
  EDGE_BAND_THICKNESS_STEP,
  activeOverrideCount,
  edgeBandLabel,
  edgeSideLabel,
  resolveEdgeBand,
  type EdgeBand,
  type EdgeBanding,
  type EdgeId,
} from '../boards/edgeBanding.ts'
import {
  bandWidthProblem,
  bandsMatchingBoard,
  edgeBandSwatchStyle,
  edgeBandTree,
  findEdgeBandModel,
  fitBandThickness,
  edgeBandTagStyle,
  useEdgeBandCatalog,
  type EdgeBandModel,
} from '../boards/edgeBandCatalog.ts'
import { edgeKindLabel, type ContourEdge, type EdgeKey } from '../boards/cutouts.ts'
import CatalogTreePicker, { type PickerItem, type PickerNode } from './CatalogTreePicker.tsx'

/**
 * Band thickness: a list of the band model's variants, or – when the model has none (or is not known
 * yet) – any value typed by hand.
 */
function ThicknessField({ typeId, value, onChange, name }: { typeId: string; value: number; onChange: (v: number) => void; name: string }) {
  const variants = findEdgeBandModel(typeId)?.thicknesses ?? []
  if (!variants.length)
    return (
      <div className="band-thickness">
        <NumberField
          name={name}
          data-field={name}
          aria-label="Grubość obrzeża [mm]"
          min={EDGE_BAND_THICKNESS_LIMITS.min}
          max={EDGE_BAND_THICKNESS_LIMITS.max}
          step={EDGE_BAND_THICKNESS_STEP}
          scrubStep={0.1}
          value={value}
          onChange={onChange}
        />
      </div>
    )
  const offList = !variants.includes(value)
  return (
    <div className="band-thickness">
      <select name={`${name}-preset`} data-field={name} aria-label="Grubość obrzeża" value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        {offList && <option value={String(value)}>{formatNumber(value)} mm (spoza wariantów)</option>}
        {variants.map((t) => (
          <option key={t} value={String(t)}>
            {formatNumber(t)} mm
          </option>
        ))}
      </select>
    </div>
  )
}

const NONE = 'none'
const INHERIT = 'inherit'

const bandItem = (m: EdgeBandModel): PickerItem => ({
  id: m.id,
  title: m.seriesCode,
  subtitle: m.name,
  swatch: edgeBandSwatchStyle(m.id),
  search: `${m.brand} ${m.seriesCode} ${m.name}`,
  tooltip: `Grubości: ${m.thicknesses.length ? `${m.thicknesses.join(', ')} mm` : 'dowolna'} · szerokości rolek: ${m.widths.join(', ')} mm`,
})

/** What a picker shows for a band id / "no band" / "as all edges". */
function currentItem(id: string, common: EdgeBand | null): PickerItem {
  if (id === NONE) return { id, title: 'Brak obrzeża', swatchClass: 'band-swatch--none' }
  if (id === INHERIT)
    return common
      ? { id, title: 'Jak wszystkie', subtitle: edgeBandLabel(common), swatch: edgeBandSwatchStyle(common.typeId) }
      : { id, title: 'Jak wszystkie', subtitle: 'brak obrzeża', swatchClass: 'band-swatch--none' }
  const m = findEdgeBandModel(id)
  return m ? { ...bandItem(m), title: `${m.brand} ${m.seriesCode}` } : { id, title: `Nieznane obrzeże (${id})`, swatch: edgeBandSwatchStyle(id) }
}

/**
 * Band picker – the catalog tree Typ (ABS, PCV, melamina) → Marka → okleina, with "Brak obrzeża"
 * (and "Jak wszystkie" for an edge override) and the bands matching the board decor on top.
 */
function EdgeBandPicker({
  value,
  onChange,
  common,
  override = false,
  materialId,
  field,
  ariaLabel,
}: {
  value: string
  onChange: (id: string) => void
  common: EdgeBand | null
  override?: boolean
  materialId?: string
  field: string
  ariaLabel: string
}) {
  const { catalog, status, error } = useEdgeBandCatalog()
  const tree = useMemo<PickerNode[]>(
    () =>
      edgeBandTree(catalog).map(({ type, brands }) => ({
        key: type.id,
        name: type.name,
        groups: brands.map((b) => ({ key: b.brand, name: b.brand, items: b.bands.map(bandItem) })),
      })),
    [catalog],
  )
  const matching = bandsMatchingBoard(materialId).map(bandItem)
  const top = [...(override ? [currentItem(INHERIT, common)] : []), currentItem(NONE, common)]
  return (
    <CatalogTreePicker
      tree={tree}
      selectedId={value}
      onPick={onChange}
      current={currentItem(value, common)}
      sections={[{ items: top }, ...(matching.length ? [{ label: 'Pasujące do płyty', items: matching }] : [])]}
      field={field}
      ariaLabel={ariaLabel}
      compact={override}
      note={
        status === 'error'
          ? { kind: 'error', text: `Nie udało się pobrać listy obrzeży z backendu. (${error})` }
          : status === 'loading'
            ? { kind: 'hint', text: 'Wczytywanie listy obrzeży…' }
            : null
      }
    />
  )
}

interface Props {
  value: EdgeBanding
  onChange: (next: EdgeBanding) => void
  /** Only for the side names next to the edge letters (A – góra / tył …); null = boards of mixed orientations (no side names). */
  orientation: BoardOrientation | null
  /** Edges of the board outline (A–D + the cut-out edges E, F…), clockwise. */
  edges: ContourEdge[]
  idPrefix: string
  /**
   * Edges that touch another board (edge → reason, e.g. "przylega do: Lewy bok") – they never get a band
   * (see `layout/edgeContacts.ts`), so their row is locked to "brak".
   */
  locked?: Map<string, string>
  /** Board model of the board(s) – bands of the same decor are offered first ("Pasujące do płyty"). */
  materialId?: string
  /** Board thickness [mm] – a warning when a chosen band has no roll that wide. */
  boardThickness?: number
}

/**
 * Edge banding (okleina krawędzi / obrzeże) of a board:
 *  - the band for all edges – a band model from the catalog tree (type → brand → band, with the bands
 *    matching the board decor on top) + its thickness (the model's variants, or any when it has none),
 *    or none,
 *  - below it: overrides of selected edges (different band / no band) – the board sides A–D and the new
 *    edges E, F… created by the cut-outs (stored under their stable edge key).
 * The band thickness is included in the entered board dimensions.
 */
export default function EdgeBandingFields({ value, onChange, orientation, edges, idPrefix, locked, materialId, boardThickness }: Props) {
  useEdgeBandCatalog() // thickness variants / labels follow the loaded catalog
  const overrideCount = activeOverrideCount(value, edges)
  const [overridesOpen, setOverridesOpen] = useState(overrideCount > 0)
  const common = value.common

  const setCommon = (band: EdgeBand | null) => onChange({ ...value, common: band })
  const setOverride = (edge: EdgeKey, band: EdgeBand | null | undefined) => {
    const overrides = { ...value.overrides }
    if (band === undefined) delete overrides[edge]
    else overrides[edge] = band
    onChange({ ...value, overrides })
  }
  /** A band of the model `id`, keeping the thickness if the model offers it. */
  const bandOf = (id: string, thickness: number | undefined): EdgeBand => ({
    typeId: id,
    thickness: fitBandThickness(thickness ?? DEFAULT_EDGE_BAND_THICKNESS, id),
  })
  // bands used on the board that have no roll as wide as the board is thick
  const widthProblems = boardThickness
    ? [...new Set(edges.map((e) => resolveEdgeBand(value, e.key)?.typeId).filter((id): id is string => !!id))]
        .map((id) => bandWidthProblem(id, boardThickness))
        .filter(Boolean)
    : []

  return (
    <fieldset className="field edge-banding">
      <legend>
        Okleina krawędzi (obrzeże) <small>(wliczona w wymiary płyty)</small>
      </legend>

      <EdgeBandPicker
        value={common ? common.typeId : NONE}
        common={common}
        materialId={materialId}
        field="band"
        ariaLabel="Obrzeże wszystkich krawędzi"
        onChange={(id) => setCommon(id === NONE ? null : bandOf(id, common?.thickness))}
      />
      {common && (
        <div className="band-row-thickness">
          <span>Grubość</span>
          <ThicknessField
            typeId={common.typeId}
            name={`${idPrefix}-band-thickness`}
            value={common.thickness}
            onChange={(thickness) => setCommon({ ...common, thickness })}
          />
        </div>
      )}
      {widthProblems.map((p) => (
        <p key={p} className="field-error" data-band-width-problem>
          {p}
        </p>
      ))}

      {locked && locked.size > 0 && (
        <p className="field-hint edge-locked-hint" data-locked-edges={[...locked.keys()].join(',')}>
          Bez obrzeża – krawędzie przylegające do innych płyt: <b>{[...locked.keys()].sort().join(', ')}</b>.
        </p>
      )}
      <details className="edge-overrides" open={overridesOpen} onToggle={(e) => setOverridesOpen(e.currentTarget.open)}>
        <summary>
          Nadpisz wybrane krawędzie{overrideCount > 0 && <small> ({overrideCount})</small>}
        </summary>
        <p className="field-hint">
          Krawędzie A–D zgodnie z ruchem wskazówek zegara, E, F… – krawędzie wycięć. Oznaczone w scenie i w rzucie 2D.
        </p>
        {edges.map(({ key: edge, label, kind, ...rest }) => {
          const override = value.overrides[edge]
          const pickerValue = !(edge in value.overrides) ? INHERIT : override ? override.typeId : NONE
          const lockReason = locked?.get(edge)
          const band = lockReason ? null : resolveEdgeBand(value, edge)
          const side =
            kind === 'side'
              ? orientation
                ? edgeSideLabel(orientation, edge as EdgeId)
                : ''
              : edgeKindLabel({ key: edge, label, kind, ...rest })
          return (
            <div key={edge} className="edge-override" data-edge={label} data-edge-key={edge}>
              <div className="edge-override-row">
                <span className="edge-tag" style={edgeBandTagStyle(band?.typeId)}>
                  {label}
                </span>
                <small className="edge-side" title={side ?? undefined}>{side}</small>
                {lockReason ? (
                  <select
                    name={`${idPrefix}-band-${edge}`}
                    data-field={`band-${label}`}
                    aria-label={`Obrzeże krawędzi ${label}`}
                    value={NONE}
                    disabled
                    title={`Krawędź ${lockReason} – obrzeże niedostępne`}
                  >
                    <option value={NONE}>Brak (przylega)</option>
                  </select>
                ) : (
                  <EdgeBandPicker
                    override
                    value={pickerValue}
                    common={common}
                    materialId={materialId}
                    field={`band-${label}`}
                    ariaLabel={`Obrzeże krawędzi ${label}`}
                    onChange={(id) =>
                      id === INHERIT
                        ? setOverride(edge, undefined)
                        : id === NONE
                          ? setOverride(edge, null)
                          : setOverride(edge, bandOf(id, override?.thickness ?? common?.thickness))
                    }
                  />
                )}
              </div>
              {lockReason && <small className="edge-locked-reason">{lockReason}</small>}
              {override && !lockReason && (
                <div className="band-row-thickness band-row-thickness--edge">
                  <span>Grubość</span>
                  <ThicknessField
                    typeId={override.typeId}
                    name={`${idPrefix}-band-${edge}-thickness`}
                    value={override.thickness}
                    onChange={(thickness) => setOverride(edge, { ...override, thickness })}
                  />
                </div>
              )}
            </div>
          )
        })}
      </details>
    </fieldset>
  )
}
