import { useState, type ReactNode } from 'react'

/**
 * "Sterowanie" – the legend of the mouse / keyboard controls (and of the current tool), a collapsible
 * widget in the top-right corner of the viewport like "Światło": a small button, expanded on click.
 */
export default function ControlsHint({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <button type="button" className="light-toggle hint-toggle" data-action="controls-open" onClick={() => setOpen(true)} title="Mysz, klawiatura i skróty">
        <span className="hint-toggle-icon" aria-hidden="true">⌨</span> Sterowanie
      </button>
    )
  return (
    <div className="controls-hint" role="group" aria-label="Sterowanie" data-controls-hint>
      <div className="light-control-header controls-hint-header">
        <b>⌨ Sterowanie</b>
        <button type="button" className="side-panel-close" aria-label="Zwiń" onClick={() => setOpen(false)}>×</button>
      </div>
      {children}
    </div>
  )
}
