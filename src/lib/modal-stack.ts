// Shared client-side stack of "currently-open modals." Each modal pushes
// its onClose handler when it mounts and pops it on unmount. BackGuard
// (the dashboard's hardware-back-button interceptor) pops the topmost
// handler on a back press, so the device back gesture closes the modal
// instead of triggering the "Leave the vault?" prompt — Lance's expected
// behaviour for any phone-app-style modal.
//
// Pure module-level state. Lives client-side only; never imported into a
// server component.

type CloseFn = () => void

const stack: CloseFn[] = []

/**
 * Register `close` on the modal stack. Returns a release function the
 * caller MUST invoke on unmount (idempotent — safe to call after
 * closeTopModal already removed this entry).
 */
export function pushModal(close: CloseFn): () => void {
  stack.push(close)
  return () => {
    const idx = stack.lastIndexOf(close)
    if (idx !== -1) stack.splice(idx, 1)
  }
}

/**
 * Pop + invoke the topmost open modal's close handler. Returns true
 * when something was popped (caller should suppress whatever default
 * back-button behaviour would otherwise run), false when the stack is
 * empty (caller continues with its default flow — e.g. BackGuard shows
 * its leave-the-vault prompt).
 */
export function closeTopModal(): boolean {
  const top = stack.pop()
  if (!top) return false
  try { top() } catch { /* swallow — back press already consumed */ }
  return true
}
