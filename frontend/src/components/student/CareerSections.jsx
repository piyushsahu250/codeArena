import { Link } from "react-router-dom";
import { Target, Mic, UserCircle, Award, Activity, Bell, Megaphone, Download, ExternalLink } from "lucide-react";
import api from "../../api";
import { SectionCard, Empty, Bar, toneFor, isErr, track, timeAgo } from "./sdKit";

export function ReadinessCard({ d, onRetry }) {
  const r = d.readiness;
  return (
    <SectionCard id="sd-ready" title="Placement readiness" icon={Target} to="/readiness" linkLabel="Take assessment" error={isErr(r)} onRetry={onRetry}>
      {!r?.assessedSubjects ? <Empty>No readiness assessment yet. Take one to see your score for each placement subject.</Empty> : (
        <div style={{ display: "grid", gap: 10 }}>
          <div><span className="sd-kpi-value sd-num">{r.overall}%</span> <span className="sd-muted">average across {r.assessedSubjects} assessed subject{r.assessedSubjects === 1 ? "" : "s"}</span></div>
          {r.categories.map((c) => (
            <div key={c.key} style={{ display: "grid", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{c.reportUrl ? <Link to={c.reportUrl} className="sd-link">{c.label}</Link> : c.label}</span>
                <span className="sd-num sd-muted">{c.score === null ? "Not assessed" : `${c.score}%`}</span>
              </div>
              <Bar value={c.score || 0} tone={c.score === null ? "" : toneFor(c.score)} />
            </div>
          ))}
          {r.weakAreas?.length > 0 && <p className="sd-muted" style={{ margin: 0 }}>Focus on: {r.weakAreas.join(", ")}</p>}
        </div>
      )}
    </SectionCard>
  );
}

export function MockInterviewCard({ d, onRetry }) {
  const i = d.interview;
  const last = i?.last;
  return (
    <SectionCard id="sd-int" title="AI mock interview" icon={Mic} to="/interview" linkLabel={last ? "Practise again" : "Start"} error={isErr(i)} onRetry={onRetry}>
      {!last ? <Empty>You haven't taken a mock interview yet. Your scores and feedback will appear here.</Empty> : (
        <div style={{ display: "grid", gap: 10 }}>
          <div><span className="sd-kpi-value sd-num">{last.score}</span><span className="sd-muted">/100 · {last.category || "Mock"} · {timeAgo(last.date)}</span></div>
          {last.breakdown.map((b) => (
            <div key={b.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, textTransform: "capitalize" }}><span>{b.label}</span><span className="sd-num">{b.score}</span></div>
          ))}
          {last.weakAreas.length > 0 && <p className="sd-muted" style={{ margin: 0 }}>Improve: {last.weakAreas.join(", ")}</p>}
          <Link to={last.reportUrl} className="sd-link">View full report</Link>
        </div>
      )}
    </SectionCard>
  );
}

export function CareerProfileCard({ d, onRetry }) {
  const c = d.career;
  return (
    <SectionCard id="sd-career" title="Career profile" icon={UserCircle} to="/profile" linkLabel="Edit profile" error={isErr(c)} onRetry={onRetry}>
      {c && !isErr(c) && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>Profile</span><span className="sd-num">{c.profilePercent}%</span></div>
            <Bar value={c.profilePercent} tone={toneFor(c.profilePercent)} />
            {c.profileMissing.length > 0 && <span className="sd-muted">Still needed: {c.profileMissing.join(", ")}</span>}
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Resume</span><span className="sd-num">{c.resume.exists ? `${c.resume.percent}%` : "Not started"}</span>
            </div>
            {c.resume.exists ? <Bar value={c.resume.percent} tone={toneFor(c.resume.percent)} /> : <Link to="/resume" className="sd-link">Build your resume</Link>}
          </div>
          <div className="sd-muted" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{c.hasPhoto ? "Photo added" : "No profile photo yet"}</span>
            {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="sd-link">LinkedIn <ExternalLink size={12} aria-hidden="true" /></a>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

async function downloadCert(c) {
  track("certificate_download_clicked");
  const res = await api.get(c.downloadPath, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url; a.download = `${c.title}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function CertificatesSection({ d, onRetry }) {
  const c = d.certificates;
  return (
    <SectionCard id="sd-certs" title="Certificates" icon={Award} to="/certificates" error={isErr(c)} onRetry={onRetry}>
      {!c?.items?.length ? <Empty>No certificates yet. Complete a course or assessment to earn one.</Empty> : (
        <ul className="sd-list">
          {c.items.map((x) => (
            <li key={x.id} className="sd-row">
              <div className="sd-row-main">
                <div className="sd-row-title">{x.title}</div>
                <div className="sd-muted">{x.typeLabel} · {timeAgo(x.issuedAt)}{x.status !== "VALID" ? ` · ${x.status.toLowerCase()}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <a className="sd-btn ghost sm" href={x.verifyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Verify ${x.title}`}><ExternalLink size={14} aria-hidden="true" /></a>
                <button type="button" className="sd-btn ghost sm" onClick={() => downloadCert(x).catch(() => {})} aria-label={`Download ${x.title}`}><Download size={14} aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function RecentActivity({ d, onRetry }) {
  const a = d.activity;
  return (
    <SectionCard id="sd-act" title="Recent activity" icon={Activity} to="/results" error={isErr(a)} onRetry={onRetry}>
      {!a?.length ? <Empty>Nothing yet. Finish a lesson or a test and it will show up here.</Empty> : (
        <ul className="sd-list">
          {a.slice(0, 6).map((x, i) => (
            <li key={i} className="sd-row"><span className="sd-row-title">{x.text}</span><span className="sd-muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(x.date)}</span></li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function NotificationPanel({ d, onRetry }) {
  const n = d.notifications;
  const ann = n?.announcements || [];
  return (
    <SectionCard id="sd-notif" title="Notifications" icon={Bell} error={isErr(n)} onRetry={onRetry}>
      {n && !isErr(n) && (
        <div style={{ display: "grid", gap: 12 }}>
          {n.unreadCount > 0 && <span className="sd-chip warn" style={{ justifySelf: "start" }}>{n.unreadCount} unread</span>}
          {ann.length > 0 && (
            <div>
              <div className="sd-kpi-label" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}><Megaphone size={13} aria-hidden="true" /> Announcements</div>
              <ul className="sd-list">{ann.map((x) => <li key={x.id} className="sd-row"><span className="sd-row-title" style={{ fontWeight: x.read ? 400 : 600 }}>{x.message}</span><span className="sd-muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(x.createdAt)}</span></li>)}</ul>
            </div>
          )}
          {n.items.length === 0 && ann.length === 0 ? <Empty>You're all caught up.</Empty> : (
            <ul className="sd-list">
              {n.items.filter((x) => x.type !== "SYSTEM_ANNOUNCEMENT").slice(0, 4).map((x) => (
                <li key={x.id} className="sd-row">
                  <span className="sd-row-title" style={{ fontWeight: x.read ? 400 : 600 }}>{x.link ? <Link to={x.link} className="sd-link">{x.message}</Link> : x.message}</span>
                  <span className="sd-muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(x.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}
