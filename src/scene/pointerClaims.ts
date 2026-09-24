/**
 * Pointer events "claimed" by a scene tool listening on window / document (e.g. a constraint handle is
 * under the pointer). Tools that come later in the same event (resize edges) skip claimed events, so
 * where a handle and a board edge overlap on screen, the handle wins.
 */
const claimed = new WeakSet<Event>()

export const claimPointer = (e: Event) => {
  claimed.add(e)
}

export const isPointerClaimed = (e: Event) => claimed.has(e) || e.defaultPrevented
