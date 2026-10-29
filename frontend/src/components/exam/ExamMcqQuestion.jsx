import MathText from "../MathText";

// One aptitude or technical question. The options arrive already in this student's order and the answer key is never sent, so the only thing held here is what was chosen.
export default function ExamMcqQuestion({ item, number, total, payload, onChange, disabled }) {
  const selected = payload?.selected;
  const chosen = Array.isArray(selected) ? selected : selected === null || selected === undefined ? [] : [selected];
  function toggle(i) {
    if (disabled) return;
    if (item.multiple) {
      const next = chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i].sort((a, b) => a - b);
      onChange({ selected: next.length ? next : null });
    } else onChange({ selected: i });
  }
  return (
    <div className="ex-q">
      <div className="ex-row between">
        <span className="ex-muted mono">Question {number} of {total}</span>
        {item.marks != null && <span className="ex-chip">{item.marks} mark{item.marks === 1 ? "" : "s"}</span>}
      </div>
      {item.title && <h3 style={{ marginTop: 8 }}>{item.title}</h3>}
      <div className="ex-q-text"><MathText text={item.text || ""} /></div>
      {item.multiple && <p className="ex-sub" style={{ marginTop: -6 }}>More than one option may be correct.</p>}
      <div role={item.multiple ? "group" : "radiogroup"} aria-label={`Options for question ${number}`}>
        {(item.options || []).map((opt, i) => (
          <label key={i} className={`ex-opt ${chosen.includes(i) ? "on" : ""}`}>
            <input type={item.multiple ? "checkbox" : "radio"} name={`q-${item.id}`} checked={chosen.includes(i)} onChange={() => toggle(i)} disabled={disabled} />
            <span><MathText text={String(opt)} /></span>
          </label>
        ))}
      </div>
      {chosen.length > 0 && !disabled && (
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onChange({ selected: null })}>Clear my answer</button>
      )}
    </div>
  );
}
