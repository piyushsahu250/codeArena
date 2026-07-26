import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building, Search } from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

export default function ClerkDashboard() {
  const { user } = useAuth();
  const [companyCount, setCompanyCount] = useState(null);

  useEffect(() => {
    api.get("/companies").then((res) => setCompanyCount(res.data.length)).catch(() => setCompanyCount(null));
  }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div>
          <h1>Placement Cell — {user?.name}</h1>
          <ChalkUnderline />
          <p style={{ color: "var(--ink-dim)", marginTop: 8 }}>Institute-scoped placement operations: student directory and Company Master.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 24 }}>
          <StatCard icon={Building} label="Companies" value={companyCount ?? "—"} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 32 }}>
          <Link to="/clerk/students" className="card" style={{ padding: 20, textDecoration: "none", color: "inherit" }}>
            <Search size={20} />
            <h3 style={{ fontSize: 16, marginTop: 10 }}>Student Search</h3>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>Search and view student profiles in your institute.</p>
          </Link>
          <Link to="/clerk/companies" className="card" style={{ padding: 20, textDecoration: "none", color: "inherit" }}>
            <Building size={20} />
            <h3 style={{ fontSize: 16, marginTop: 10 }}>Company Master</h3>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>Maintain the shared company directory used across placement records.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <Icon size={20} />
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
