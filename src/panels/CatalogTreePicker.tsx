import { useEffect, useRef, useState, type CSSProperties } from 'react'

/** A leaf of the tree (a concrete board / edge band) or an extra option shown above the tree. */
export interface PickerItem {
  id: string
  title: string
  subtitle?: string
  /** Style of the swatch (texture / colour); `swatchClass` for special swatches (e.g. "no band"). */
  swatch?: CSSProperties
  swatchClass?: string
  tooltip?: string
  /** Text the search field matches (default: title + subtitle). */
  search?: string
}

/** 2nd level – brand. */
export interface PickerGroup {
  key: string
  name: string
  items: PickerItem[]
}

/** 1st level – type. */
export interface PickerNode {
  key: string
  name: string
  groups: PickerGroup[]
}

/** Options above the tree (e.g. "Brak obrzeża", "Pasujące do płyty"), with an optional heading. */
export interface PickerSection {
  label?: string
  items: PickerItem[]
}

interface Props {
  tree: PickerNode[]
  /** Id of the selected leaf / option. */
  selectedId: string | null
  onPick: (id: string) => void
  /** What the closed button shows. */
  current: PickerItem
  sections?: PickerSection[]
  /** Loading / error note under the button. */
  note?: { kind: 'hint' | 'error'; text: string } | null
  /** `data-field` of the button. */
  field: string
  ariaLabel: string
  disabled?: boolean
  /** Smaller button (per-edge rows). */
  compact?: boolean
  searchPlaceholder?: string
}

const text = (i: PickerItem) => (i.search ?? `${i.title} ${i.subtitle ?? ''}`).toLowerCase()

function Leaf({ item, selected, onPick }: { item: PickerItem; selected: boolean; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`board-tree-leaf${selected ? ' board-tree-leaf--selected' : ''}`}
      data-catalog-item={item.id}
      onClick={() => onPick(item.id)}
      title={item.tooltip}
      role="treeitem"
      aria-selected={selected}
    >
      <span className={`board-swatch board-swatch--small ${item.swatchClass ?? ''}`} style={item.swatch} aria-hidden="true" />
      <span className="board-tree-leaf-text">
        <b>{item.title}</b>
        {item.subtitle && <small>{item.subtitle}</small>}
      </span>
    </button>
  )
}

/**
 * Drop-down list as a tree: type → brand → concrete item (used by the board model and the edge band
 * pickers). The branch of the selected item is open when the list opens; a search field filters the
 * items (and opens every branch with a hit). Extra options (sections) are listed above the tree.
 */
export default function CatalogTreePicker({
  tree,
  selectedId,
  onPick,
  current,
  sections = [],
  note,
  field,
  ariaLabel,
  disabled = false,
  compact = false,
  searchPlaceholder = 'Szukaj: marka, kod, nazwa…',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const root = useRef<HTMLDivElement>(null)

  // opening → the branch of the selected item is expanded
  useEffect(() => {
    if (!open) return
    const node = tree.find((t) => t.groups.some((g) => g.items.some((i) => i.id === selectedId)))
    const group = node?.groups.find((g) => g.items.some((i) => i.id === selectedId))
    setExpanded(new Set(node ? [node.key, `${node.key}/${group?.key}`] : []))
    setQuery('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // click outside / Escape closes the list
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const pick = (id: string) => {
    onPick(id)
    setOpen(false)
  }
  const q = query.trim().toLowerCase()
  const hit = (i: PickerItem) => !q || text(i).includes(q)
  const isOpen = (key: string) => !!q || expanded.has(key)

  return (
    <div className={`board-picker${compact ? ' board-picker--compact' : ''}`} ref={root}>
      <button
        type="button"
        className="board-picker-button"
        data-field={field}
        aria-label={ariaLabel}
        aria-haspopup="tree"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={current.tooltip ?? [current.title, current.subtitle].filter(Boolean).join(' – ')}
      >
        <span className={`board-swatch ${current.swatchClass ?? ''}`} style={current.swatch} aria-hidden="true" />
        <span className="board-picker-label">
          <b>{current.title}</b>
          {current.subtitle && <small>{current.subtitle}</small>}
        </span>
        <span className="board-picker-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {note && <small className={note.kind === 'error' ? 'field-error' : 'field-hint'}>{note.text}</small>}
      {open && (
        <div className="board-picker-popup">
          <input
            type="text"
            className="board-picker-search"
            placeholder={searchPlaceholder}
            aria-label="Szukaj"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {sections.map((s, si) => {
            const items = s.items.filter(hit)
            if (!items.length) return null
            return (
              <div key={si} className="board-picker-section" role="group">
                {s.label && <small className="board-picker-section-label">{s.label}</small>}
                {items.map((i) => (
                  <Leaf key={i.id} item={i} selected={i.id === selectedId} onPick={pick} />
                ))}
              </div>
            )
          })}
          <ul className="board-tree" role="tree">
            {tree.map((node) => {
              const groups = node.groups.map((g) => ({ ...g, items: g.items.filter(hit) })).filter((g) => g.items.length)
              if (!groups.length) return null
              return (
                <li key={node.key} role="treeitem" aria-expanded={isOpen(node.key)} data-catalog-type={node.key}>
                  <button type="button" className="board-tree-node board-tree-node--type" onClick={() => toggle(node.key)}>
                    <span aria-hidden="true">{isOpen(node.key) ? '▾' : '▸'}</span> {node.name}
                  </button>
                  {isOpen(node.key) && (
                    <ul role="group">
                      {groups.map((g) => {
                        const key = `${node.key}/${g.key}`
                        return (
                          <li key={key} role="treeitem" aria-expanded={isOpen(key)} data-catalog-brand={g.name}>
                            <button type="button" className="board-tree-node board-tree-node--brand" onClick={() => toggle(key)}>
                              <span aria-hidden="true">{isOpen(key) ? '▾' : '▸'}</span> {g.name}
                            </button>
                            {isOpen(key) && (
                              <ul role="group">
                                {g.items.map((i) => (
                                  <li key={i.id}>
                                    <Leaf item={i} selected={i.id === selectedId} onPick={pick} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
