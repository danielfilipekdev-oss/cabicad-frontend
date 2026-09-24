export type Tool = 'furniture' | 'addBoard' | 'boards' | 'sections' | 'fronts'

/** Tools of the "Sekcje mebla" group – they select sections, never single boards. */
export const SECTION_TOOLS: readonly Tool[] = ['sections', 'fronts']
export const isSectionTool = (tool: Tool | null): boolean => !!tool && SECTION_TOOLS.includes(tool)

interface Props {
  activeTool: Tool | null
  onToolChange: (tool: Tool | null) => void
  /** Number of boards – shown on the "Płyty" button. */
  boardCount?: number
}

/** Tools grouped by what they work on. */
const GROUPS: { title: string; tools: { tool: Tool; label: string; hint: string }[] }[] = [
  {
    title: 'Mebel',
    tools: [{ tool: 'furniture', label: 'Parametry mebla', hint: 'Wymiary mebla oraz domyślna płyta i obrzeże' }],
  },
  {
    title: 'Płyty',
    tools: [
      { tool: 'addBoard', label: 'Dodaj płytę', hint: 'Płyty korpusu (dach, podłoga, boki, plecy) i pojedyncze płyty' },
      { tool: 'boards', label: 'Płyty', hint: 'Lista dodanych płyt – wymiary, płyta, obrzeża, wycięcia, wiązania' },
    ],
  },
  {
    // modes working on the SECTIONS of the furniture (not on single boards): a section is picked in the
    // scene / list, boards cannot be selected (see `SECTION_TOOLS`); drawers (szuflady) will join later
    title: 'Sekcje mebla',
    tools: [
      { tool: 'sections', label: 'Półki i Przedziały', hint: 'Podział mebla na sekcje półkami i przedziałami' },
      { tool: 'fronts', label: 'Fronty', hint: 'Drzwi i klapy zamykające sekcje' },
    ],
  },
]

/** Main tool panel on the left side of the screen – every tool opens its helper panel to the right. */
export default function ToolPanel({ activeTool, onToolChange, boardCount }: Props) {
  return (
    <nav className="tool-panel" aria-label="Panel narzędziowy">
      {GROUPS.map((g) => (
        <div key={g.title} className="tool-group" role="group" aria-label={g.title} data-tool-group={g.title}>
          <div className="tool-group-title">{g.title}</div>
          {g.tools.map(({ tool, label, hint }) => (
            <button
              key={tool}
              type="button"
              data-tool={tool}
              title={hint}
              className={`tool-button${activeTool === tool ? ' tool-button--active' : ''}`}
              aria-pressed={activeTool === tool}
              onClick={() => onToolChange(activeTool === tool ? null : tool)}
            >
              {label}
              {tool === 'boards' && boardCount !== undefined && <span className="tool-badge">{boardCount}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
