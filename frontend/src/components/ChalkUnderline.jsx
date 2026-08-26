// Deliberately a no-op: the amber chalk-underline mark under page titles was removed platform-wide
// per explicit request. Kept as a component (rather than deleting it and its ~73 call sites) so
// every existing <ChalkUnderline /> usage across the app keeps resolving without needing a
// mechanical edit of each file — this is the single place that controls whether it renders.
export default function ChalkUnderline() {
  return null;
}
