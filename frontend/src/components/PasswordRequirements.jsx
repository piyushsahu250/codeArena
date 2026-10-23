import { checkPassword } from "../utils/passwordPolicy";

// The password rules, all visible while a student is choosing a password, each judged on its own as they type. A rule is never signalled by colour alone: every line carries a
// check or a cross, and a visually hidden phrase says whether it is met, for screen readers. Frontend convenience only; the server enforces the same rules.
export default function PasswordRequirements({ id, password }) {
  return (
    <ul id={id} className="ca-pw-rules" aria-label="Password requirements">
      {checkPassword(password).map((rule) => (
        <li key={rule.id} data-rule={rule.id} className={`ca-pw-rule ${rule.met ? "met" : "unmet"}`}>
          <span className="ca-pw-rule-icon" aria-hidden="true">{rule.met ? "✓" : "✕"}</span>
          <span>{rule.label}</span>
          <span className="ca-sr-only">{rule.met ? " (requirement met)" : " (requirement not met)"}</span>
        </li>
      ))}
    </ul>
  );
}
