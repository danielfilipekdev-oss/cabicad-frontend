import { useEffect, useMemo, useRef, useState } from 'react'
import Scene from './scene/Scene.tsx'
import LightControl from './scene/LightControl.tsx'
import ControlsHint from './scene/ControlsHint.tsx'
import { loadLightSettings, loadSunRays, saveLightSettings, saveSunRays, type LightSettings } from './scene/lighting.ts'
import { loadBoardCatalog } from './api/boardCatalog.ts'
import { loadEdgeBandCatalog } from './api/edgeBandCatalog.ts'
import ToolPanel, { isSectionTool, type Tool } from './panels/ToolPanel.tsx'
import AddBoardPanel from './panels/AddBoardPanel.tsx'
import BoardsPanel from './panels/BoardsPanel.tsx'
import FurniturePanel from './panels/FurniturePanel.tsx'
import CarcassPanel from './panels/CarcassPanel.tsx'
import FrontsPanel from './panels/FrontsPanel.tsx'
import { applyStructure, pruneStructure } from './structure.ts'
import {
  DEFAULT_FRONT_GAP,
  addFrontProblem,
  createFront,
  ctrlPickSection,
  selectionCovers,
  type Front,
  type FrontSelection,
} from './fronts/fronts.ts'
import SectionsPanel from './panels/SectionsPanel.tsx'
import { DEFAULT_FURNITURE, type Furniture } from './furniture/furniture.ts'
import { createBoard, draftBoard, type Board, type BoardParams } from './boards/board.ts'
import type { CameraRigHandle } from './scene/CameraRig.tsx'
import { DEFAULT_FINISH, finishOf, withFinish, type BoardFinish, type PanelDefaults } from './boards/finish.ts'
import type { FrontDefaults } from './panels/FrontsPanel.tsx'
import {
  connectHandles,
  rederiveOffsets,
  removeAnchorsWithRestore,
  violatedAnchors,
  type AnchorConstraint,
  type HandleRef,
} from './layout/constraints.ts'
import { solveLayout } from './layout/solver.ts'
import { hiddenBands } from './layout/edgeContacts.ts'
import { boardHinges } from './layout/hinges.ts'
import { OpenBoardsContext } from './scene/openBoards.ts'
import {
  CARCASS_ROLES,
  DEFAULT_CARCASS_RELATIONS,
  createCarcassBoard,
  findRoleBoard,
  type CarcassBoardOptions,
  type CarcassRelations,
  type CarcassRole,
} from './carcass/carcass.ts'
import {
  addDivider,
  moveDivider,
  setCompartmentSize,
  setSectionLayout,
  setSectionAuto,
  allSections,
  type SectionLayout,
  dividersUsingSectionFinish,
  effectiveSectionFinish,
  setSectionFinish,
  clearSection,
  createRootSection,
  findSection,
  removeDividerFromTree,
  sectionOfDivider,
  setSectionFrontOffset,
  type DividerKind,
  type Section,
} from './sections/sections.ts'

/** Furniture + boards + layout constraints – kept together, every change is solved at once. */
interface Model {
  furniture: Furniture
  boards: Board[]
  constraints: AnchorConstraint[]
  /** Relations between the predefined carcass boards (who covers whom – see `carcass/carcass.ts`). */
  carcass: CarcassRelations
  /** Tree of sections split by shelves / partitions (see `sections/sections.ts`). */
  sections: Section
  /** Fronts (doors / flaps) covering sections (see `fronts/fronts.ts`). */
  fronts: Front[]
}

/** Regenerates the generated joints (carcass, shelves / partitions) and solves the layout. */
const structured = (m: Model, edited?: string): Model => {
  // fronts whose sections are gone go away first
  const p = pruneStructure(m.sections, m.fronts, m.boards, m.constraints)
  return { ...m, ...p, ...applyStructure(m.furniture, p.boards, p.constraints, m.carcass, m.sections, p.fronts, edited) }
}

/** Some section adds / removes its dividers by itself (automatic dividers) – a size change must run the structure. */
const hasAutoSections = (m: Model) => allSections(m.sections).some((s) => !!s.auto)

/**
 * Solves the layout of the boards for the given furniture and constraints. `edited` is the board the
 * user has just changed – it keeps what was set and the boards hanging on it follow.
 */
const solved = (m: Model, edited?: string): Model => ({
  ...m,
  boards: solveLayout(m.furniture, m.boards, m.constraints, edited).boards,
})

export default function App() {
  const cameraRef = useRef<CameraRigHandle>(null)
  const [activeTool, setActiveTool] = useState<Tool | null>(null)
  /**
   * Furniture cuboid = working volume of the boards (it can't shrink below the free boards – see
   * FurniturePanel), the boards and the layout constraints (wiązania, see `layout/constraints.ts`).
   */
  const [model, setModel] = useState<Model>({
    furniture: DEFAULT_FURNITURE,
    boards: [],
    constraints: [],
    carcass: DEFAULT_CARCASS_RELATIONS,
    sections: createRootSection(),
    fronts: [],
  })
  const { furniture, boards, constraints } = model
  /**
   * Default board (model + thickness + grain) and edge banding of the whole furniture ("Parametry mebla") – inherited by every more
   * specific configuration: new ordinary boards, the carcass (default → role) and the shelves /
   * partitions (default → section) unless they set their own.
   */
  const [furnitureFinish, setFurnitureFinish] = useState<BoardFinish>(DEFAULT_FINISH)
  /** Scene lighting ("Światło" widget, top right) – remembered in this browser. */
  const [light, setLightState] = useState<LightSettings>(loadLightSettings)
  /** "Pokaż promienie" ("Światło" panel): dashed rays from the sun in the scene to the furniture – off by default. */
  const [sunRays, setSunRaysState] = useState<boolean>(loadSunRays)
  const setSunRays = (on: boolean) => {
    setSunRaysState(on)
    saveSunRays(on)
  }
  const setLight = (next: LightSettings) => {
    setLightState(next)
    saveLightSettings(next)
  }
  /**
   * Board models and edge bands (Typ → Marka → Model) from the backend – until they arrive only the
   * default raw chipboard and no band models (bands already set are drawn grey).
   */
  useEffect(() => {
    const controller = new AbortController()
    loadBoardCatalog(controller.signal)
    loadEdgeBandCatalog(controller.signal)
    return () => controller.abort()
  }, [])
  const violated = useMemo(() => violatedAnchors(constraints, boards, furniture), [constraints, boards, furniture])
  /** Edges touching another board – their band is left out everywhere (see `layout/edgeContacts.ts`). */
  /** Boards with a hinge joint – they can be opened (`layout/hinges.ts`), render only. */
  const hinges = useMemo(() => boardHinges(constraints, boards, furniture), [constraints, boards, furniture])
  const [openBoards, setOpenBoards] = useState<Set<string>>(new Set())
  const toggleOpenBoard = (id: string) =>
    setOpenBoards((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const openBoardsCtx = useMemo(
    () => ({ hinged: new Set(hinges.keys()), open: openBoards, toggle: toggleOpenBoard }),
    [hinges, openBoards],
  )
  // a board opening on a hinge moves – touching it takes no band away (it is visible when open)
  const hidden = useMemo(() => hiddenBands(boards, new Set(hinges.keys())), [boards, hinges])
  /** Board opened for editing in the side panel – highlighted (green edges) in the scene. */
  const [editingId, setEditingId] = useState<string | null>(null)

  /** Parameters in the "Nowa płyta" form – previewed in the scene before "Dodaj" (see `draftBoard`). */
  const [draftParams, setDraftParams] = useState<BoardParams | null>(null)
  // the preview is hidden while a board is selected, so it does not get in the way of editing it
  const draft = useMemo(
    () => (activeTool === 'addBoard' && !editingId && draftParams ? draftBoard(draftParams, furniture) : null),
    [activeTool, editingId, draftParams, furniture],
  )
  /** Carcass roles whose "add" button is hovered in "Dodaj płytę" – previewed before they are added. */
  const [carcassPreview, setCarcassPreview] = useState<CarcassRole[] | null>(null)

  /** "Dodaj": the board appears in the centre of the furniture and is selected (green edges + dimensions). */
  const addBoard = (params: BoardParams) => {
    const board = createBoard(params, model.boards, model.furniture)
    setModel((m) => ({ ...m, boards: [...m.boards, board] }))
    // the new board opens in "Płyty" (selected, card expanded) – ready to be tuned / joined
    setActiveTool('boards')
    setEditingId(board.id)
  }
  /**
   * A board edited by the user (form or drag in the scene), then the layout is solved – boards anchored
   * to it follow. Positions / sizes fixed by the board's own joints cannot be edited (see `boardLocks`),
   * the offsets are changed in the panel – only a changed orientation (the faces swap axes) re-derives them.
   */
  const updateBoard = (board: Board) =>
    setModel((m) => {
      const prev = m.boards.find((b) => b.id === board.id)
      if (!prev) return m
      const cs =
        prev.orientation === board.orientation
          ? m.constraints
          : rederiveOffsets(m.constraints, prev, board, m.boards, m.furniture)
      const next = { ...m, constraints: cs, boards: m.boards.map((b) => (b.id === board.id ? board : b)) }
      return hasAutoSections(next) ? structured(next, board.id) : solved(next, board.id)
    })
  /**
   * Removes boards with their joints (boards hanging on them return to where they were). A removed
   * shelf / partition is taken out of the section tree (its two sections merge – see
   * `removeDividerFromTree`, which may remove more dividers), a removed carcass board gives its place back.
   */
  const removeBoards = (m: Model, ids: string[]): Model => {
    let sections = m.sections
    const all = new Set(ids)
    for (const id of ids) {
      if (!sectionOfDivider(sections, id)) continue
      const r = removeDividerFromTree(sections, id)
      sections = r.sections
      r.removed.forEach((x) => all.add(x))
    }
    // a leaf of a front → the whole front goes (both leaves of a double front)
    const removedFronts = new Set(m.boards.filter((b) => all.has(b.id) && b.front).map((b) => b.front!))
    const fronts = m.fronts.filter((f) => !removedFronts.has(f.id))
    for (const f of m.fronts) if (removedFronts.has(f.id)) f.boards.forEach((id) => all.add(id))
    const anchorIds = m.constraints
      .filter((c) => all.has(c.board) || (c.target.kind === 'board' && all.has(c.target.id)))
      .map((c) => c.id)
    const { constraints, boards } = removeAnchorsWithRestore(m.constraints, anchorIds, m.boards)
    const next = { ...m, sections, fronts, constraints, boards: boards.filter((b) => !all.has(b.id)) }
    const structural = m.boards.some((b) => all.has(b.id) && (b.role || b.divider || b.front))
    return structural ? structured(next) : solved(next)
  }
  const removeBoard = (id: string) => {
    setModel((m) => removeBoards(m, [id]))
    setEditingId((cur) => (cur === id ? null : cur))
  }
  /** New furniture size → boards bound to the furniture walls follow it. */
  // the structure runs too: automatic dividers follow the size, fronts re-check their limits
  const changeFurniture = (f: Furniture) => setModel((m) => structured({ ...m, furniture: f }))
  const changeConstraints = (cs: AnchorConstraint[]) =>
    setModel((m) => {
      const removed = m.constraints.filter((c) => !cs.some((n) => n.id === c.id)).map((c) => c.id)
      const restored = removeAnchorsWithRestore(m.constraints, removed, m.boards)
      return solved({ ...m, constraints: cs, boards: restored.boards })
    })
  /** A chain pulled in the scene from one handle to another → new joint (nothing moves, see `connectHandles`). */
  const connect = (from: HandleRef, to: HandleRef) =>
    setModel((m) => solved({ ...m, constraints: connectHandles(m.constraints, from, to, m.boards, m.furniture) }))
  /** Chain clicked in the scene → the joint goes away and the board returns where it was before it. */
  const disconnect = (id: string) => setModel((m) => solved({ ...m, ...removeAnchorsWithRestore(m.constraints, [id], m.boards) }))
  /** Predefined carcass board (dach, podłoga, boki, plecy) – each role at most once. */
  /** Board + edge banding of new carcass boards and per-role overrides ("Płyty korpusu" panel). */
  const [carcassDefaults, setCarcassDefaults] = useState<PanelDefaults>({ finish: null })
  const [carcassOverrides, setCarcassOverrides] = useState<Partial<Record<CarcassRole, BoardFinish>>>({})
  /** Finish inheritance: role override → carcass default → furniture parameters. */
  const carcassFinish = (role: CarcassRole): BoardFinish => carcassOverrides[role] ?? carcassDefaults.finish ?? furnitureFinish
  const carcassOptions = (role: CarcassRole): CarcassBoardOptions => finishOf(carcassFinish(role))
  const setCarcassOverride = (role: CarcassRole, finish: BoardFinish | null) =>
    setCarcassOverrides((o) => {
      const next = { ...o }
      if (finish) next[role] = finish
      else delete next[role]
      return next
    })
  const addCarcassRoles = (m: Model, roles: CarcassRole[]): Model => {
    const missing = roles.filter((r) => !findRoleBoard(m.boards, r))
    if (missing.length === 0) return m
    return structured({ ...m, boards: [...m.boards, ...missing.map((r) => createCarcassBoard(r, carcassOptions(r), m.furniture))] })
  }
  /**
   * Preview of the hovered carcass roles (only those not added yet): the boards exactly where adding them
   * would put them (joints solved), drawn as a green wireframe.
   */
  const carcassDrafts = useMemo(() => {
    const roles = activeTool === 'addBoard' ? (carcassPreview ?? []).filter((r) => !findRoleBoard(model.boards, r)) : []
    if (!roles.length) return []
    const ids = new Set(model.boards.map((b) => b.id))
    return addCarcassRoles(model, roles).boards.filter((b) => !ids.has(b.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, carcassPreview, model, carcassDefaults, carcassOverrides, furnitureFinish])
  const drafts = useMemo(
    () => [...(draft ? [{ board: draft, dimensions: true }] : []), ...carcassDrafts.map((board) => ({ board, dimensions: false }))],
    [draft, carcassDrafts],
  )
  const addCarcass = (role: CarcassRole) => setModel((m) => addCarcassRoles(m, [role]))
  const addAllCarcass = () => setModel((m) => addCarcassRoles(m, CARCASS_ROLES))
  /** The configured finish (role override, else default) on the carcass boards already added. */
  const applyCarcassFinish = () =>
    setModel((m) => ({ ...m, boards: m.boards.map((b) => (b.role ? withFinish(b, carcassFinish(b.role)) : b)) }))
  /** New relations (e.g. dach między bokami) → the carcass joints are regenerated and the boards re-placed. */
  const changeCarcassRelations = (carcass: CarcassRelations) => setModel((m) => structured({ ...m, carcass }))
  /** Regenerates all the generated joints (carcass, shelves / partitions), e.g. after some were removed by hand. */
  const restoreGeneratedJoints = () => setModel((m) => structured(m))

  /**
   * "Półki i Przedziały": the section selected in the panel / the scene (null = the root highlighted,
   * nothing entered yet – see `SectionOverlay`).
   */
  const [sectionId, setSectionId] = useState<string | null>(null)
  const validSectionId = findSection(model.sections, sectionId) ? sectionId : null
  /** Board + edge banding of new shelves / partitions (sections may override it). */
  const [sectionDefaults, setSectionDefaults] = useState<PanelDefaults>({ finish: null })
  /** Finish inheritance: section override (own / an ancestor's) → shelves default → furniture parameters. */
  const sectionDefaultFinish = sectionDefaults.finish ?? furnitureFinish
  const changeSectionFinish = (id: string, finish: BoardFinish | null) =>
    setModel((m) => ({ ...m, sections: setSectionFinish(m.sections, id, finish) }))
  /** The section's finish (own / inherited / default) on its dividers and those of sub-sections without their own. */
  const applySectionFinish = (id: string) =>
    setModel((m) => {
      const finish = effectiveSectionFinish(m.sections, id)?.finish ?? sectionDefaultFinish
      const ids = new Set(dividersUsingSectionFinish(m.sections, id))
      return { ...m, boards: m.boards.map((b) => (ids.has(b.id) ? withFinish(b, finish) : b)) }
    })
  /**
   * "Parametry mebla" → the finish each carcass board / shelf / partition inherits (role override, section
   * override…, else the furniture default) set on the boards already there. Free boards are not touched.
   */
  const applyInheritedFinish = () =>
    setModel((m) => ({
      ...m,
      boards: m.boards.map((b) => {
        if (b.role) return withFinish(b, carcassFinish(b.role))
        if (b.divider) {
          const sec = sectionOfDivider(m.sections, b.id)
          return withFinish(b, (sec && effectiveSectionFinish(m.sections, sec.id)?.finish) || sectionDefaultFinish)
        }
        if (b.front) return withFinish(b, frontFinish)
        return b
      }),
    }))
  /**
   * "Fronty": the section selected in the panel / scene, the defaults of new fronts (finish null =
   * inherited from the furniture) and which fronts are open (render only).
   */
  const [frontSel, setFrontSel] = useState<FrontSelection>({ id: null, range: null })
  const validFrontSectionId = findSection(model.sections, frontSel.id) ? frontSel.id : null
  const validFrontSel: FrontSelection = { id: validFrontSectionId, range: validFrontSectionId ? frontSel.range : null }
  /** A section picked in the panel / by a plain click in the scene – the sub-section range starts again. */
  const setFrontSectionId = (id: string | null) => setFrontSel({ id, range: null })
  /** Ctrl + click in the scene – a run of neighbouring sub-sections for one front. */
  const ctrlPickFrontSection = (id: string) => setFrontSel((cur) => ctrlPickSection(model.sections, cur, id))
  const [frontDefaults, setFrontDefaults] = useState<FrontDefaults>({
    gapH: DEFAULT_FRONT_GAP,
    gapV: DEFAULT_FRONT_GAP,
    mount: 'overlay',
    opening: 'rtl',
    finish: null,
  })
  const frontFinish = frontDefaults.finish ?? furnitureFinish
  /** Front clicked in the "Fronty" list – its sections are highlighted in the scene (null = none / removed). */
  const [highlightedFront, setHighlightedFront] = useState<string | null>(null)
  const highlightedCovers = model.fronts.find((f) => f.id === highlightedFront)?.covers ?? null
  const addFront = (covers: string[]) =>
    setModel((m) => {
      const r = createFront(m.sections, m.boards, m.furniture, covers, { ...frontDefaults, thickness: frontFinish.thickness, finish: frontFinish })
      return r ? structured({ ...m, boards: [...m.boards, ...r.boards], fronts: [...m.fronts, r.front] }) : m
    })
  const removeFront = (id: string) => {
    const f = model.fronts.find((o) => o.id === id)
    if (f) removeBoard(f.boards[0])
  }
  /** Mount / gaps / opening of a front; single ↔ double changes the number of leaves → the front is made again. */
  const changeFront = (id: string, patch: Partial<Pick<Front, 'mount' | 'gapH' | 'gapV' | 'opening'>>) =>
    setModel((m) => {
      const f = m.fronts.find((o) => o.id === id)
      if (!f) return m
      const next = { ...f, ...patch }
      const leavesChange = (f.opening === 'double') !== (next.opening === 'double')
      if (!leavesChange) return structured({ ...m, fronts: m.fronts.map((o) => (o.id === id ? next : o)) })
      const first = m.boards.find((b) => b.id === f.boards[0])
      const without = removeBoards(m, [f.boards[0]])
      const r = createFront(without.sections, without.boards, without.furniture, f.covers, {
        mount: next.mount,
        opening: next.opening,
        gapH: next.gapH,
        gapV: next.gapV,
        thickness: first?.thickness ?? frontFinish.thickness,
        finish: first ? finishOf(first) : frontFinish,
      })
      return r ? structured({ ...without, boards: [...without.boards, ...r.boards], fronts: [...without.fronts, r.front] }) : without
    })
  /** A front is open when its leaves are (the leaves are ordinary boards with a hinge joint). */
  const openFronts = new Set(model.fronts.filter((f) => f.boards.some((id) => openBoards.has(id))).map((f) => f.id))
  const toggleFront = (id: string) => {
    const f = model.fronts.find((o) => o.id === id)
    if (!f) return
    const open = openFronts.has(id)
    setOpenBoards((cur) => {
      const next = new Set(cur)
      for (const b of f.boards) if (open) next.delete(b)
      else next.add(b)
      return next
    })
  }
  const allHingedOpen = hinges.size > 0 && [...hinges.keys()].every((id) => openBoards.has(id))
  const setAllFrontsOpen = (open: boolean) => {
    const ids = model.fronts.flatMap((f) => f.boards)
    setOpenBoards((cur) => {
      const next = new Set(cur)
      for (const b of ids) if (open) next.add(b)
      else next.delete(b)
      return next
    })
  }

  /** Shelf / partition dragged in the scene → joint offsets of its section (manual layout). */
  const moveSectionDivider = (boardId: string, lo: number) =>
    setModel((m) => structured({ ...m, ...moveDivider(m, boardId, lo, m.furniture) }))
  const changeSectionLayout = (id: string, layout: SectionLayout) =>
    setModel((m) => structured({ ...m, ...setSectionLayout(m, id, layout, m.furniture) }))
  /**
   * Automatic dividers of a section on (kind + pitch; thickness and finish of the new boards = the
   * panel defaults / the section finish now) or off.
   */
  const changeSectionAuto = (id: string, auto: { kind: DividerKind; pitch: number } | null) =>
    setModel((m) => {
      const finish = effectiveSectionFinish(m.sections, id)?.finish ?? sectionDefaultFinish
      const cfg = auto && { ...auto, thickness: finish.thickness, finish: finishOf(finish) }
      return structured({ ...m, ...setSectionAuto(m, id, cfg, m.furniture) })
    })
  const changeCompartmentSize = (id: string, index: number, value: number) =>
    setModel((m) => structured({ ...m, ...setCompartmentSize(m, id, index, value, m.furniture) }))
  const addSectionDivider = (id: string, kind: DividerKind) =>
    setModel((m) => {
      const r = addDivider(m, id, kind, finishOf(sectionDefaultFinish), m.furniture)
      return r.added ? structured({ ...m, boards: r.boards, constraints: r.constraints, sections: r.sections }) : m
    })
  const clearSectionDividers = (id: string) =>
    setModel((m) => {
      const r = clearSection(m.sections, id)
      return removeBoards({ ...m, sections: r.sections }, r.removed)
    })
  const changeSectionOffset = (id: string, value: number) =>
    setModel((m) => {
      const r = setSectionFrontOffset(m.sections, m.constraints, id, value)
      return structured({ ...m, sections: r.sections, constraints: r.constraints })
    })
  /** Carcass board / shelf / front → its full parameters in the "Płyty" list. */
  const showBoardDetails = (id: string) => {
    setActiveTool('boards')
    setEditingId(id)
  }
  /**
   * Delete / Backspace (the Delete key of a Mac keyboard) → removes the selected board (green edges), like "Usuń" on its tile. Ignored while typing
   * in a field (Delete edits the text there) and inside the 2D shape editor.
   */
  const deleteSelected = useRef<() => void>(() => {})
  deleteSelected.current = () => {
    if (editingId && boards.some((b) => b.id === editingId)) removeBoard(editingId)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.closest('input, textarea, select, .shape-editor, .shape-window'))) return
      e.preventDefault()
      deleteSelected.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  /** Enter in the "Fronty" tool → a front over the selected section(s), like "+ Dodaj front". */
  const addSelectedFront = useRef<() => void>(() => {})
  addSelectedFront.current = () => {
    if (activeTool !== 'fronts') return
    const covers = selectionCovers(model.sections, validFrontSel)
    if (addFrontProblem(model.sections, model.fronts, covers, boards) === null) addFront(covers)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.closest('input, textarea, select, button, a'))) return
      e.preventDefault()
      addSelectedFront.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  /** Board clicked in the 3D scene → "Płyty" with that board's card expanded. */
  const selectBoard = (id: string) => {
    setActiveTool('boards')
    setEditingId(id)
  }
  const changeTool = (tool: Tool | null) => {
    setActiveTool(tool)
    setCarcassPreview(null)
    if (tool !== 'boards') setEditingId(null)
    if (tool === 'sections') setSectionId(null)
    if (tool === 'fronts') {
      setFrontSectionId(null)
      setHighlightedFront(null)
    }
  }
  /**
   * Tool whose panel is rendered: the active one, or – while the panel slides out after closing – the
   * last one (cleared when the slide-out transition ends).
   */
  const [shownTool, setShownTool] = useState<Tool | null>(null)
  useEffect(() => {
    if (activeTool) return setShownTool(activeTool)
    // fallback when no transitionend comes (reduced motion, hidden tab)
    const t = window.setTimeout(() => setShownTool(null), 400)
    return () => window.clearTimeout(t)
  }, [activeTool])
  const panelTool = activeTool ?? shownTool
  const sectionsMode = activeTool === 'sections'
  const frontsMode = activeTool === 'fronts'
  /** "Parametry mebla": the furniture is edited as a whole – boards cannot be selected in the scene. */
  const furnitureMode = activeTool === 'furniture'
  /**
   * Single boards cannot be selected in the scene in "Parametry mebla" (the furniture as a whole) and in
   * the "Sekcje mebla" tools (they pick sections instead).
   */
  const boardSelectable = !furnitureMode && !isSectionTool(activeTool)

  return (
    <OpenBoardsContext.Provider value={openBoardsCtx}>
    <div className="app">
      <header className="toolbar">
        <span className="toolbar-title">CabiCAD</span>
        <span className="toolbar-info">Płyty: {boards.length}</span>
        <span className="toolbar-info" data-info="constraints">
          Wiązania: {constraints.length}
          {violated.length > 0 && <b className="toolbar-warning"> · niespełnione: {violated.length}</b>}
        </span>
        {hinges.size > 0 && (
          <label className="toolbar-toggle" title="Otwiera / zamyka wszystkie płyty z wiązaniem-zawiasem – fronty, klapy, otwierane blaty (tylko podgląd)">
            <input
              type="checkbox"
              data-field="open-hinged"
              checked={allHingedOpen}
              onChange={(e) => setOpenBoards(e.target.checked ? new Set(hinges.keys()) : new Set())}
            />
            Otwórz zawiasy
          </label>
        )}
        <button type="button" className="toolbar-button" onClick={() => cameraRef.current?.resetView()}>
          Resetuj widok
        </button>
      </header>
      <div className="workspace">
        <ToolPanel activeTool={activeTool} onToolChange={changeTool} boardCount={boards.length} />
        <div className="stage">
        {/*
          Helper panels float OVER the scene (the viewport never changes its size, so the scene does not jump
          when a panel opens / closes / changes its width) and slide in / out.
        */}
        <div
          className={`side-panel-host${activeTool ? ' side-panel-host--open' : ''}`}
          data-panel={panelTool ?? ''}
          aria-hidden={!activeTool}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget && !activeTool) setShownTool(null)
          }}
        >
        {panelTool === 'furniture' && (
          <FurniturePanel
            furniture={furniture}
            boards={boards}
            constraints={constraints}
            violatedCount={violated.length}
            onChange={changeFurniture}
            finish={furnitureFinish}
            onFinishChange={setFurnitureFinish}
            onApplyFinish={applyInheritedFinish}
            structuredCount={boards.filter((b) => b.role || b.divider || b.front).length}
            sections={model.sections}
            onClose={() => changeTool(null)}
          />
        )}
        {panelTool === 'sections' && (
          <SectionsPanel
            boards={boards}
            furniture={furniture}
            constraints={constraints}
            sections={model.sections}
            selectedId={validSectionId}
            onSelect={setSectionId}
            defaults={sectionDefaults}
            onDefaultsChange={setSectionDefaults}
            furnitureFinish={furnitureFinish}
            onSectionFinishChange={changeSectionFinish}
            onApplySectionFinish={applySectionFinish}
            onAdd={addSectionDivider}
            onLayoutChange={changeSectionLayout}
            onAutoChange={changeSectionAuto}
            onCompartmentSizeChange={changeCompartmentSize}
            onRemoveDivider={removeBoard}
            onClear={clearSectionDividers}
            onFrontOffsetChange={changeSectionOffset}
            onRestoreJoints={restoreGeneratedJoints}
            onDetails={showBoardDetails}
            onClose={() => changeTool(null)}
          />
        )}
        {panelTool === 'fronts' && (
          <FrontsPanel
            boards={boards}
            furniture={furniture}
            sections={model.sections}
            fronts={model.fronts}
            selection={validFrontSel}
            onSelectionChange={setFrontSel}
            defaults={frontDefaults}
            onDefaultsChange={setFrontDefaults}
            furnitureFinish={furnitureFinish}
            openFronts={openFronts}
            onToggleOpen={toggleFront}
            onAllOpen={setAllFrontsOpen}
            onAdd={addFront}
            onChange={changeFront}
            onRemove={removeFront}
            onDetails={showBoardDetails}
            onClose={() => changeTool(null)}
            highlightedFront={highlightedCovers ? highlightedFront : null}
            onHighlightFront={setHighlightedFront}
          />
        )}
        {panelTool === 'addBoard' && (
          <AddBoardPanel
            furniture={furniture}
            onAdd={addBoard}
            onClose={() => changeTool(null)}
            onDraftChange={setDraftParams}
            defaultFinish={furnitureFinish}
            carcass={
              <CarcassPanel
                boards={boards}
                constraints={constraints}
                relations={model.carcass}
                defaults={carcassDefaults}
                onDefaultsChange={setCarcassDefaults}
                furnitureFinish={furnitureFinish}
                overrides={carcassOverrides}
                onOverrideChange={setCarcassOverride}
                onApplyFinish={applyCarcassFinish}
                onAdd={addCarcass}
                onAddAll={addAllCarcass}
                onRelationsChange={changeCarcassRelations}
                onRestoreJoints={restoreGeneratedJoints}
                onRemove={removeBoard}
                onDetails={showBoardDetails}
                onPreview={setCarcassPreview}
              />
            }
          />
        )}
        {panelTool === 'boards' && (
          <BoardsPanel
            boards={boards}
            furniture={furniture}
            onUpdate={updateBoard}
            onRemove={removeBoard}
            constraints={constraints}
            violated={violated}
            onConstraintsChange={changeConstraints}
            onClose={() => changeTool(null)}
            editingId={editingId}
            onEditingChange={setEditingId}
            hiddenBands={hidden}
            onAddClick={() => changeTool('addBoard')}
          />
        )}
        </div>
        <main className="viewport">
          <Scene
            light={light}
            sunRays={sunRays}
            ref={cameraRef}
            boards={boards}
            furniture={furniture}
            highlightedId={editingId}
            onBoardSelect={boardSelectable ? selectBoard : undefined}
            onEmptyClick={() => (sectionsMode ? setSectionId(null) : frontsMode ? (setFrontSectionId(null), setHighlightedFront(null)) : setEditingId(null))}
            onBoardMove={updateBoard}
            constraints={constraints}
            violated={violated}
            onConnectHandles={connect}
            onDisconnectChain={disconnect}
            onBoardResize={updateBoard}
            drafts={drafts}
            hiddenBands={hidden}
            sections={
              sectionsMode
                ? { root: model.sections, selectedId: validSectionId, onSelect: setSectionId, onMoveDivider: moveSectionDivider }
                : frontsMode
                  ? {
                      root: model.sections,
                      selectedId: validFrontSectionId,
                      onSelect: setFrontSectionId,
                      range: validFrontSel.range,
                      onCtrlPick: ctrlPickFrontSection,
                      highlighted: highlightedCovers,
                    }
                  : undefined
            }
            hinges={hinges}
            openLeaves={openBoards}
          />
          <div className="viewport-widgets">
            <LightControl value={light} onChange={setLight} furniture={furniture} showRays={sunRays} onShowRaysChange={setSunRays} />
            <ControlsHint>
              <div className="controls-hint-title controls-hint-title--plain">Mysz</div>
              <div><b>Kółko myszy</b> – przybliż / oddal</div>
              <div><b>LPM + przeciągnij</b> – przesuń kamerę</div>
              <div><b>PPM + przeciągnij</b> – obróć kamerę</div>
              <div className="controls-hint-title controls-hint-title--plain" data-hint="keyboard">Klawiatura</div>
              <div>
                <kbd>W</kbd> <kbd>S</kbd> – kamera do przodu / do tyłu
              </div>
              <div>
                <kbd>A</kbd> <kbd>D</kbd> – kamera w lewo / w prawo
              </div>
              <div>
                <kbd>Q</kbd> <kbd>E</kbd> – kamera w dół / w górę
              </div>
              <div>
                <kbd>Shift</kbd> + klawisz ruchu – 3× szybciej
              </div>
              <div>
                <kbd>Delete</kbd> / <kbd>Backspace</kbd> – usuń zaznaczoną płytę
              </div>
              <div>
                <kbd>Enter</kbd> – dodaj front (narzędzie „Fronty”)
              </div>
              <div>
                <kbd>Esc</kbd> – poziom sekcji wyżej / anuluj wiązanie / zamknij listę
              </div>
              <div className="controls-hint-note">Klawisze kamery nie działają podczas pisania w polach formularza.</div>
              <div className="controls-hint-sep">
                <span className="dot" /> punkt 0,0,0 – lewy-górny róg dna mebla
              </div>
              {sectionsMode && (
                <div className="controls-hint-section" data-hint="sections">
                  <div className="controls-hint-title">Półki i Przedziały</div>
                  <div><b>Kliknij sekcję</b> – wejdź głębiej (podświetlą się jej sekcje)</div>
                  <div><b>PPM</b> (bez przeciągania) / <b>Esc</b> – poziom wyżej</div>
                  <div><b>Klik poza meblem</b> – z powrotem cały mebel</div>
                  <div><b>Przeciągnij pomarańczowy pasek</b> – przesuń półkę / przedział (rozkład ręczny)</div>
                </div>
              )}
              {frontsMode && (
                <div className="controls-hint-section" data-hint="fronts">
                  <div className="controls-hint-title">Fronty</div>
                  <div><b>Kliknij sekcję</b> – wejdź głębiej, <b>PPM</b> / <b>Esc</b> – poziom wyżej</div>
                  <div><b>Ctrl + klik</b> – dodaj / odejmij sąsiednią podsekcję do jednego frontu</div>
                  <div><b>Enter</b> – dodaj front na zaznaczonych sekcjach</div>
                </div>
              )}
              {editingId && (
                <div className="controls-hint-section" data-hint="board-move">
                  <div className="controls-hint-title">Zaznaczona płyta</div>
                  <div><b>LPM + przeciągnij płytę</b> – przesuń w płaszczyźnie XZ</div>
                  <div><b>Shift + LPM + przeciągnij</b> – przesuń w osi Y (góra / dół)</div>
                  <div><b>Przeciągnij zieloną krawędź</b> – zmień szerokość / wysokość (róg – obie)</div>
                  <div><b>Delete / Backspace</b> – usuń zaznaczoną płytę</div>
                  <div className="controls-hint-note">Płyta nie wyjdzie poza mebel; kolizje oznaczone na czerwono.</div>
                  <div className="controls-hint-title">Uchwyty wiązań</div>
                  <div>
                    <b>Przeciągnij uchwyt</b> na inny uchwyt – łańcuch tworzy wiązanie (<b>Esc</b> – anuluj)
                  </div>
                  <div><b>Kliknij łańcuch</b> – usuń wiązanie</div>
                  <div className="controls-hint-note">
                    <span className="handle-dot handle-dot--selected" /> zaznaczona płyta ·{' '}
                    <span className="handle-dot handle-dot--other" /> inne płyty / ściany mebla ·{' '}
                    <span className="handle-dot handle-dot--disabled" /> nie można połączyć
                  </div>
                </div>
              )}
            </ControlsHint>
          </div>
        </main>
        </div>
      </div>
    </div>
    </OpenBoardsContext.Provider>
  )
}
