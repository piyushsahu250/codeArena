import { useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 6 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginTop: 10, display: "block" };
const CATEGORIES = ["LEARNING", "CODING", "ASSESSMENT", "CONSISTENCY", "SPECIAL"];

export default function GamificationManagement() {
  const { user } = useAuth();
  const isAdmin = user.role === "ADMIN";
  const [rules, setRules] = useState(null);
  const [badges, setBadges] = useState(null);
  const [stats, setStats] = useState(null);

  function loadRules() { api.get("/gamification/xp-rules").then((res) => setRules(res.data)); }
  function loadBadges() { api.get("/gamification/badges").then((res) => setBadges(res.data)); }
  function loadStats() { api.get("/gamification/admin/stats").then((res) => setStats(res.data)).catch(() => setStats(null)); }

  useEffect(() => { loadRules(); loadBadges(); loadStats(); }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Gamification Management</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Configure XP values, manage badges, and review student achievement statistics.
        </p>

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 24 }}>
            <StatCard label="Students" value={stats.totalStudents} />
            <StatCard label="Total XP Awarded" value={stats.totalXpAwarded} />
            <StatCard label="Badges Awarded" value={stats.totalBadgesAwarded} />
          </div>
        )}

        {stats?.topStudents?.length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Top students by XP</div>
            {stats.topStudents.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                <span>#{i + 1} {s.name}</span>
                <span className="mono">{s.xp} XP</span>
              </div>
            ))}
          </div>
        )}

        {/* XP Rules */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>XP Values</h3>
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Activity</th>
                <th style={{ padding: "10px 12px" }}>XP</th>
                {isAdmin && <th style={{ padding: "10px 12px" }}></th>}
              </tr>
            </thead>
            <tbody>
              {rules?.length === 0 && (
                <tr><td colSpan={isAdmin ? 3 : 2} style={{ padding: 20, textAlign: "center", color: "var(--ink-dim)" }} className="mono">No XP rules configured.</td></tr>
              )}
              {(rules || []).map((r) => (
                <XpRuleRow key={r.activity} rule={r} editable={isAdmin} onSaved={loadRules} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Badges */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Badges</h3>
        {isAdmin && <NewBadgeForm onCreated={loadBadges} />}
        {badges?.length === 0 && (
          <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 12 }} className="mono">No badges created yet.</p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
          {(badges || []).map((b) => (
            <BadgeCard key={b.id} badge={b} editable={isAdmin} onChanged={loadBadges} />
          ))}
        </div>

        {isAdmin && (
          <div className="card" style={{ padding: 20, marginTop: 32, borderColor: "var(--rust)" }}>
            <h3 style={{ fontSize: 15, color: "var(--rust)" }}>Danger zone</h3>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 6 }}>
              Resets every student's XP to zero platform-wide. Badges and streaks are not affected. This cannot be undone.
            </p>
            <ResetLeaderboardButton />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}

function XpRuleRow({ rule, editable, onSaved }) {
  const [xp, setXp] = useState(rule.xp);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/gamification/xp-rules/${rule.activity}`, { xp: Number(xp) });
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update XP rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <td style={{ padding: "10px 12px" }}>{rule.label}</td>
      <td style={{ padding: "10px 12px" }}>
        {editable ? (
          <input type="number" className="mono" style={{ width: 80, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)" }} value={xp} onChange={(e) => setXp(e.target.value)} />
        ) : (
          <span className="mono">{rule.xp}</span>
        )}
      </td>
      {editable && (
        <td style={{ padding: "10px 12px" }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={save} disabled={saving || Number(xp) === rule.xp}>
            {saving ? "Saving…" : "Save"}
          </button>
        </td>
      )}
    </tr>
  );
}

function BadgeCard({ badge, editable, onChanged }) {
  async function toggleActive() {
    await api.patch(`/gamification/badges/${badge.id}`, { isActive: !badge.isActive });
    onChanged();
  }
  async function remove() {
    if (!confirm(`Delete badge "${badge.name}"? Students who earned it will lose it.`)) return;
    await api.delete(`/gamification/badges/${badge.id}`);
    onChanged();
  }

  return (
    <div className="card" style={{ padding: 14, opacity: badge.isActive ? 1 : 0.5 }}>
      <div style={{ fontSize: 22 }}>{badge.icon}</div>
      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{badge.name}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{badge.description}</div>
      <div className="badge" style={{ marginTop: 8 }}>{badge.category}</div>
      {editable && (
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={toggleActive}>{badge.isActive ? "Disable" : "Enable"}</button>
          <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 11 }} onClick={remove}>Delete</button>
        </div>
      )}
    </div>
  );
}

const EMPTY_BADGE = { code: "", name: "", description: "", icon: "🏅", category: "SPECIAL" };

function NewBadgeForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_BADGE);
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/gamification/badges", form);
      setForm(EMPTY_BADGE);
      setOpen(false);
      onCreated();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create badge");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setOpen(true)}>+ Add custom badge</button>;

  return (
    <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ flex: "1 1 100px" }}>
        <label style={labelStyle} htmlFor="badge-code">Code</label>
        <input id="badge-code" style={inputStyle} required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })} />
      </div>
      <div style={{ flex: "1 1 60px" }}>
        <label style={labelStyle} htmlFor="badge-icon">Icon</label>
        <input id="badge-icon" style={inputStyle} value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
      </div>
      <div style={{ flex: "2 1 150px" }}>
        <label style={labelStyle} htmlFor="badge-name">Name</label>
        <input id="badge-name" style={inputStyle} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div style={{ flex: "2 1 200px" }}>
        <label style={labelStyle} htmlFor="badge-description">Description</label>
        <input id="badge-description" style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div style={{ flex: "1 1 140px" }}>
        <label style={labelStyle} htmlFor="badge-category">Category</label>
        <select id="badge-category" style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add"}</button>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function ResetLeaderboardButton() {
  const [resetting, setResetting] = useState(false);
  async function reset() {
    if (!confirm("Reset ALL students' XP to zero platform-wide? This cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? Type-to-confirm isn't required, but this is irreversible.")) return;
    setResetting(true);
    try {
      const { data } = await api.post("/gamification/leaderboard/reset");
      alert(`Leaderboard reset. ${data.xpEventsDeleted} XP events removed.`);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to reset leaderboard");
    } finally {
      setResetting(false);
    }
  }
  return (
    <button className="btn btn-ghost" style={{ marginTop: 12, color: "var(--rust)", borderColor: "var(--rust)" }} onClick={reset} disabled={resetting}>
      {resetting ? "Resetting…" : "Reset Leaderboard (delete all XP)"}
    </button>
  );
}
