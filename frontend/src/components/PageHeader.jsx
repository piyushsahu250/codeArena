// Shared page header, replacing the `<h1>Title</h1>` + description + action-button-row shape
// repeated across ~74 page files (the same files that used to also render <ChalkUnderline/>, now
// a no-op). Actions accepts any nodes (usually a row of <Link className="btn ...">).
export default function PageHeader({ title, description, actions, style }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, ...style }}>
      <div>
        <h1>{title}</h1>
        {description && <p style={{ color: "var(--ink-dim)", marginTop: 8, fontSize: 14 }}>{description}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
