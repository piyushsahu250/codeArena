import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, HelpCircle, Menu, Moon, Sun, User as UserIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useSidebarUI } from "../context/SidebarContext";
import GlobalSearch from "./GlobalSearch";
import Breadcrumb from "./Breadcrumb";
import api from "../api";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { toggleMobile } = useSidebarUI();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const [loadingNotif, setLoadingNotif] = useState(false);

  function closeMenus() { setNotifOpen(false); setHelpOpen(false); setProfileOpen(false); }

  // Lazy-fetched only when the bell is actually opened (not on every page load) — this hook
  // renders on ~30 pages, so an eager fetch here would run these queries on every navigation
  // across the whole app, which is exactly the "unnecessary API request" the redesign spec asks
  // to avoid. GET /notifications is the persisted source added for the Talent Pool module — the
  // first real notification source for ADMIN/STAFF, who previously always saw a hard-coded "no
  // notifications" stub here since none existed. Students additionally get the older live-computed
  // dashboard items (test reminders, module unlocks, etc.) merged in alongside the persisted ones.
  function openNotifications() {
    const opening = !notifOpen;
    closeMenus();
    setNotifOpen(opening);
    if (opening && notifications === null) {
      setLoadingNotif(true);
      const requests = [api.get("/notifications", { params: { pageSize: 8 } })];
      if (user?.role === "STUDENT") requests.push(api.get("/dashboard/student"));
      Promise.all(requests)
        .then(([notifRes, dashRes]) => {
          const persisted = (notifRes.data.notifications || []).map((n) => ({ id: n.id, message: n.message, date: n.createdAt, read: n.read }));
          const live = dashRes ? (dashRes.data.notifications || []).map((n) => ({ message: n.text, date: n.date, read: true })) : [];
          setNotifications([...persisted, ...live].sort((a, b) => new Date(b.date) - new Date(a.date)));
        })
        .catch(() => setNotifications([]))
        .finally(() => setLoadingNotif(false));
    }
  }

  function markRead(n) {
    if (!n.id || n.read) return;
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    api.patch(`/notifications/${n.id}/read`).catch(() => {});
  }

  function markAllRead() {
    setNotifications((prev) => prev?.map((x) => ({ ...x, read: true })) ?? prev);
    api.post("/notifications/mark-all-read").catch(() => {});
  }

  return (
    <>
      <nav className="ca-topbar">
        {user && (
          <button className="ca-topbar-icon-btn ca-hamburger-btn" onClick={toggleMobile} aria-label="Toggle menu">
            <Menu size={18} />
          </button>
        )}
        <Link to="/" style={{ textDecoration: "none", color: "var(--chalk)" }}>
          <div style={{ background: "#fdfbf5", borderRadius: 8, padding: "3px 10px", display: "flex", alignItems: "center" }}>
            <img src="/branding/logo.png" alt="CodeArena" style={{ height: 34, width: "auto", display: "block" }} />
          </div>
        </Link>

        {user && <GlobalSearch />}

        {user && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ position: "relative" }}>
              <button className="ca-topbar-icon-btn" onClick={openNotifications} aria-label="Notifications">
                <Bell size={17} />
                {notifications?.some((n) => !n.read) && <span className="ca-topbar-dot" />}
              </button>
              {notifOpen && (
                <div className="ca-dropdown">
                  <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>Notifications</span>
                    {notifications?.some((n) => n.id && !n.read) && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={markAllRead}>Mark all read</button>
                    )}
                  </div>
                  {loadingNotif && <div className="ca-dropdown-item">Loading…</div>}
                  {!loadingNotif && (
                    notifications?.length
                      ? notifications.slice(0, 8).map((n, i) => (
                        <div
                          key={n.id || i}
                          className="ca-dropdown-item"
                          style={{ cursor: n.id ? "pointer" : "default", opacity: n.read ? 0.6 : 1 }}
                          onClick={() => markRead(n)}
                        >
                          {n.message}
                        </div>
                      ))
                      : <div className="ca-dropdown-item" style={{ opacity: 0.7, cursor: "default" }}>No new notifications</div>
                  )}
                </div>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <button className="ca-topbar-icon-btn" onClick={() => { const o = !helpOpen; closeMenus(); setHelpOpen(o); }} aria-label="Help">
                <HelpCircle size={17} />
              </button>
              {helpOpen && (
                <div className="ca-dropdown">
                  <div style={{ padding: "12px 14px", fontSize: 12.5, lineHeight: 1.6 }}>
                    <strong>Quick tips</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                      <li>Use the search bar above to jump straight to modules, tests, or students.</li>
                      <li>Use the sidebar's collapse arrow to free up screen space.</li>
                      <li>The back button and breadcrumb trail at the top of every page preserve your place.</li>
                    </ul>
                    <p style={{ marginTop: 8, opacity: 0.75 }}>Need more help? Contact your institute admin.</p>
                  </div>
                </div>
              )}
            </div>

            <button className="ca-topbar-icon-btn" onClick={toggleTheme} title="Toggle dark/light mode" aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            <div style={{ position: "relative" }}>
              <button className="ca-topbar-icon-btn" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={() => { const o = !profileOpen; closeMenus(); setProfileOpen(o); }}>
                <UserIcon size={17} />
                <span className="mono ca-topbar-username" style={{ fontSize: 12 }}>{user.name?.split(" ")[0]}</span>
              </button>
              {profileOpen && (
                <div className="ca-dropdown">
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{user.name}</div>
                    <div className="mono" style={{ fontSize: 11, opacity: 0.6 }}>{user.role}</div>
                  </div>
                  <Link to="/account" className="ca-dropdown-item" onClick={() => setProfileOpen(false)}>Account Settings</Link>
                  <button className="ca-dropdown-item" style={{ color: "var(--rust)" }} onClick={() => { logout(); navigate("/login"); }}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
      {user && <Breadcrumb />}
    </>
  );
}
