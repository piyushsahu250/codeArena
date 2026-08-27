import { createContext, useCallback, useContext, useState } from "react";

const ConfirmContext = createContext(null);

// Promise-based replacement for window.confirm() — usage: const ok = await confirm({ title, message }).
// Used in new code from this redesign onward; the ~22 existing window.confirm() call sites across
// the app aren't retrofitted in this pass (flagged separately) but this is a drop-in upgrade path
// for them later since the call shape (await a boolean) is the same shape confirm() already has.
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, confirmLabel, cancelLabel, danger, resolve }

  const confirm = useCallback(({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) => {
    return new Promise((resolve) => {
      setState({ title, message, confirmLabel, cancelLabel, danger, resolve });
    });
  }, []);

  function handle(result) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="ca-modal-overlay" onClick={() => handle(false)}>
          <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>{state.title}</h3>
            {/* whiteSpace: pre-wrap so a caller's \n-separated lines (e.g. an old->new value list)
                actually render as separate lines instead of collapsing into one run of text — a
                plain single-line message is completely unaffected by this. */}
            {state.message && <p style={{ marginTop: 10, fontSize: 14, color: "var(--ink-dim)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{state.message}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={() => handle(false)}>{state.cancelLabel}</button>
              <button
                className="btn btn-primary"
                style={state.danger ? { background: "var(--rust)", color: "#fff" } : undefined}
                onClick={() => handle(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
