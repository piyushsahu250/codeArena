// Drag-to-resize for the panels inside a test (problem panel width, results panel height). REPORTED 2026-11-04: "dragging is not working properly inside test".
// The old handles listened for mousemove/mouseup on the window and, for the results panel, added up `event.movementY`. That breaks in ordinary ways: movementY is fractional or wrong at browser
// zoom and on scaled displays, a mouse button released outside the window or over the editor was never seen (the panel then kept following the pointer with no button held), touch screens
// could not drag at all, and the handle was only 6 to 9 pixels thick. One shared implementation fixes all of that:
//  - pointer events with pointer capture, so every move and the release go to the handle wherever the pointer is (over the editor, off the window) and touch/pen work too;
//  - the size is the size at the start plus the distance from where the drag began (never a running sum), so it cannot drift;
//  - the drag always ends: release, cancel, lost capture and a button that is no longer down all stop it, and the page's cursor and text selection are given back.
// The calculation is separate and pure so it can be tested without a browser.

export const clampSize = (value, min, max) => Math.min(max, Math.max(min, value));

// Where the size ends up. `invert` is for a panel that grows when the handle moves toward its start (the results panel under the editor grows as the handle moves up).
export function sizeAfterDrag({ start, delta, invert = false, min, max }) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? Math.max(max, lo) : Infinity;
  return clampSize(start + (invert ? -delta : delta), lo, hi);
}

const bound = (b) => (typeof b === "function" ? b() : b);

// Call from a handle's onPointerDown. `start` is the current size; onChange gets every new size; onEnd gets the final one (once). Returns false when the press should not start a drag.
export function beginDrag(e, { axis, start, invert = false, min, max, onChange, onEnd }) {
  if (e.pointerType === "mouse" && e.button !== 0) return false; // only the main button drags
  const el = e.currentTarget;
  e.preventDefault(); // no text selection, no native drag image
  const origin = axis === "x" ? e.clientX : e.clientY;
  let size = start;
  let live = true;
  const prevCursor = document.body.style.cursor, prevSelect = document.body.style.userSelect;
  document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
  try { el.setPointerCapture(e.pointerId); } catch { /* an element that cannot capture still works for the moves it receives */ }

  function move(ev) {
    if (!live || ev.pointerId !== e.pointerId) return;
    if (ev.pointerType === "mouse" && ev.buttons === 0) return finish(); // the release was missed: do not keep following the pointer
    const delta = (axis === "x" ? ev.clientX : ev.clientY) - origin;
    size = sizeAfterDrag({ start, delta, invert, min: bound(min), max: bound(max) });
    onChange(size);
  }
  function finish() {
    if (!live) return;
    live = false;
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", finish);
    el.removeEventListener("lostpointercapture", finish);
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
    onEnd?.(size);
  }
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
  el.addEventListener("lostpointercapture", finish);
  return true;
}

// Arrow keys move a separator by `step` pixels, so a panel can be resized without a pointer. `grow` and `shrink` are the key names that make it larger and smaller.
export function sizeAfterKey(key, { size, step = 24, min, max, grow, shrink }) {
  if (key === grow) return sizeAfterDrag({ start: size, delta: step, min, max });
  if (key === shrink) return sizeAfterDrag({ start: size, delta: -step, min, max });
  return null;
}
