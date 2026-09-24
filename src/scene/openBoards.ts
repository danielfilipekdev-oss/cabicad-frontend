import { createContext, useContext } from 'react'

/**
 * Which boards with a hinge joint are opened in the scene (render only) – shared with the panels, so any
 * hinged board can be opened / closed from its card, not only fronts.
 */
export interface OpenBoards {
  /** Boards that have a valid hinge joint. */
  hinged: Set<string>
  open: Set<string>
  toggle: (boardId: string) => void
}

export const OpenBoardsContext = createContext<OpenBoards>({ hinged: new Set(), open: new Set(), toggle: () => {} })

export const useOpenBoards = () => useContext(OpenBoardsContext)
