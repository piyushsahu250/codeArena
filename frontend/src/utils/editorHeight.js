// Height of the code editor on the stacked (mobile) exam layouts.
//
// The stacked layouts give the editor a fixed pixel height (380 / 420 / 360 px) because a percentage height inside a flex item collapsed to 0 on some mobile browsers (see TestTaking.jsx).
// That is right for a portrait phone, but a phone held sideways is only about 375 px tall and the on-screen keyboard takes roughly half of that: a 380 px editor is taller than the screen,
// so the line being typed can sit behind the keyboard. On a short landscape screen the editor is capped instead.
// The rule depends on the screen's shape, not on the keyboard (which resizes the viewport while typing), so the layout never jumps under the student's fingers.

export const SHORT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";
export const SHORT_LANDSCAPE_EDITOR_PX = 220;

export function editorHeightFor(basePx, shortLandscape) {
  return shortLandscape ? Math.min(basePx, SHORT_LANDSCAPE_EDITOR_PX) : basePx;
}
