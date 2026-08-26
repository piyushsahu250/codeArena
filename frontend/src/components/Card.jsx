// Thin wrapper standardizing the `className="card" style={{ padding: X }}` shape repeated on
// nearly every page — same CSS class, just one owner for the default padding value so it stops
// drifting per-page (12/14/16/18/20/24 all appear today for what's meant to be the same "a card").
export default function Card({ children, padding = 20, style, className = "", ...rest }) {
  return (
    <div className={`card ${className}`.trim()} style={{ padding, ...style }} {...rest}>
      {children}
    </div>
  );
}
