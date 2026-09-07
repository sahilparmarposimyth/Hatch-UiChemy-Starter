// Size-aware icon stroke.
//
// Hugeicons draw on a 24-unit canvas, so a flat 1.5 stroke rendered at 12–16px
// thins to <1px and reads lighter than the 500-weight text beside it. Holding a
// constant *physical* stroke (~UC_ICON_STROKE px), strokeWidth = stroke × 24 / size
//, keeps small and large glyphs at the same optical weight. Mirrors the app-wide
// rule in components/icons.jsx (mk) so DS glyphs match the rest of the dashboard.
export const UC_ICON_STROKE = 1.25;

export const strokeFor = (size: number): number =>
  +((UC_ICON_STROKE * 24) / size).toFixed(2);
