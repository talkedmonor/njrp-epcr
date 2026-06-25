import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Activity, Ambulance, ArrowLeft, BadgeCheck, Bell, BookOpenCheck, CalendarDays, Check,
  ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, Clock3, FileClock, FilePlus2,
  FileText, Gauge, History, LayoutDashboard, LockKeyhole, LogOut, MapPin, Menu, MessageSquareText,
  MoreHorizontal, Plus, Printer, RefreshCw, Search, ShieldCheck, Stethoscope, UserRound,
  UsersRound, UserPlus, KeyRound, Pencil, RadioTower, Settings, Trash2, Truck, X, XCircle,
} from "lucide-react";
import { clearSession, getSession, request, setSession } from "./api";

const STATUS_META = {
  Draft: { tone: "slate", icon: FileClock },
  Returned: { tone: "amber", icon: RefreshCw },
  Submitted: { tone: "blue", icon: ClipboardCheck },
  Approved: { tone: "green", icon: BadgeCheck },
  Locked: { tone: "dark", icon: LockKeyhole },
};

const blankVitals = { time: "", hr: "", sys: "", dia: "", rr: "", spo2: "", etco2: "", temp: "", bgl: "", pain: "", gcs: "15", rhythm: "NSR", notes: "" };
const blankMedication = { medication: "", dose: "", route: "IV", time: "", indication: "", contraindications: "Checked", response: "", administeredBy: "", notes: "" };
const blankIntervention = { intervention: "", time: "", successful: "Yes", performedBy: "", response: "", notes: "" };
const DEFAULT_AGENCIES = ["Atlantic Mobile Health System", "Trenton Emergency Medical Services", "Virtua Health", "Princeton First Aid and Rescue Squad"];
const PROVIDER_LEVELS = ["EMR", "EMT", "AEMT", "Paramedic", "RN", "Physician", "Dispatcher", "Supervisor"];
const CREW_ROLES = ["Primary on-scene provider", "Primary transport provider", "Driver", "Attendant", "Partner", "Supervisor", "Observer", "CAD / Dispatch"];
const SCENE_TYPES = ["", "9921001-Private residence", "9921003-Street / highway", "9921005-Healthcare facility", "9921007-Public building", "9921009-Industrial / commercial", "9921011-School", "9921013-Outdoor / recreational", "9921015-Other"];
const CALL_DISPOSITIONS = ["", "4212033-Patient treated and transported", "4212035-Patient treated and released", "4212037-Patient refused care", "4212039-Cancelled en route", "4212041-No patient found", "4212043-Standby only"];
const PATIENT_ACUITIES = ["", "Critical", "Emergent", "Lower acuity", "Routine", "No patient"];
const DESTINATION_TYPES = ["", "4225001-Emergency department", "4225003-Trauma center", "4225005-Urgent care", "4225007-Scene release", "4225009-Refusal / no transport"];
const TRANSPORT_MODES = ["", "4218001-Lights and sirens", "4218003-No lights or sirens", "4218005-Downgraded en route", "4218007-Upgraded en route", "4218009-Not transported"];
const INCIDENT_TYPES_NEMSIS = ["", "9916001-Chest Pain", "9916003-Difficulty Breathing", "9916005-Fall", "9916007-Motor Vehicle Collision", "9916009-Overdose / Poisoning", "9916011-Behavioral Emergency", "9916013-Sick Person", "9916015-Traumatic Injury", "9916017-Cardiac Arrest"];
const DEFAULT_RECEIVING_FACILITY = "NJRP Medical Center";
const blankCrewMember = { name: "", agency: DEFAULT_AGENCIES[0], providerLevel: "EMT", role: "Primary on-scene provider", unit: "" };

async function openAuthenticatedPdf(path) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${getSession()?.token || ""}` } });
  if (!response.ok) throw new Error("Unable to generate PDF");
  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.Draft;
  const Icon = meta.icon;
  return <span className={`status-badge ${meta.tone}`}><Icon size={12} />{status}</span>;
}

function Button({ children, icon: Icon, kind = "secondary", className = "", ...props }) {
  return <button className={`btn ${kind} ${className}`} {...props}>{Icon ? <Icon size={15} /> : null}{children}</button>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("ProviderDemo");
  const [password, setPassword] = useState("provider123");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const session = await request("/login", { method: "POST", body: JSON.stringify({ username, password }) });
      setSession(session); onLogin(session);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const choose = (role) => {
    const credentials = {
      Provider: ["ProviderDemo", "provider123"],
    }[role];
    setUsername(credentials[0]); setPassword(credentials[1]);
  };

  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="brand-lockup"><span className="brand-mark"><Ambulance size={26} /></span><span>NJRP <strong>ePCR</strong></span></div>
        <div className="brand-copy">
          <h1>Chart with clarity.<br />Close the call with confidence.</h1>
          <p>A focused patient care reporting workspace built for realistic EMS operations, review, and accountability.</p>
          <div className="login-feature"><ClipboardList /><div><strong>Structured clinical workflow</strong><span>From dispatch through QA lock</span></div></div>
          <div className="login-feature"><ShieldCheck /><div><strong>Role-aware reporting</strong><span>Provider, supervisor, and admin views</span></div></div>
          <div className="login-feature"><FileText /><div><strong>Print-ready records</strong><span>Professional PCR and refusal exports</span></div></div>
        </div>
        <span className="roleplay-note">Training & roleplay environment • Not for real-world patient care</span>
      </section>
      <main className="login-panel">
        <form onSubmit={login} className="login-form">
          <div>
            <span className="small-caps">Secure access</span>
            <h2>Welcome back</h2>
            <p>Sign in to continue to your reporting workspace.</p>
          </div>
          {error ? <div className="alert error">{error}</div> : null}
          <label>Roblox username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
          <label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
          <Button kind="primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          <div className="demo-block">
            <span>Public provider access</span>
            <div className="demo-buttons">
              <button type="button" onClick={() => choose("Provider")}>Use Provider Account</button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: ClipboardList },
  { to: "/cad", label: "CAD / Dispatch", icon: RadioTower, roles: ["Supervisor", "Admin"] },
  { to: "/qa", label: "QA Queue", icon: BookOpenCheck, roles: ["Supervisor", "Admin"] },
  { to: "/refusals", label: "Refusals", icon: XCircle },
  { to: "/search", label: "Search", icon: Search },
  { to: "/audit", label: "Audit Log", icon: History, roles: ["Supervisor", "Admin"] },
  { to: "/users", label: "Users", icon: UsersRound, roles: ["Admin"] },
  { to: "/settings", label: "Agency Settings", icon: Settings, roles: ["Admin"] },
];

function Shell({ session, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const reportCharting = /^\/reports\/[^/]+/.test(location.pathname);
  const current = NAV_ITEMS.find((item) => item.to === location.pathname)?.label || (location.pathname.includes("/reports/") ? "Patient Care Report" : "NJRP ePCR");
  const create = async () => { const report = await request("/reports", { method: "POST" }); navigate(`/reports/${report.id}`); };
  return (
    <div className={`app-shell ${reportCharting ? "classic-report-shell" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-brand"><span className="brand-mark"><Ambulance size={22} /></span><span>NJRP <strong>ePCR</strong></span><button className="mobile-close" onClick={() => setMobileOpen(false)}><X /></button></div>
        <nav>
          <span className="nav-group">Workspace</span>
          {NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(session.user.role)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setMobileOpen(false)}><Icon size={18} />{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="shift-card"><span className="live-dot" />Shift active<strong>Medic 12 • North</strong><small>08:00–20:00</small></div>
          <button type="button" onClick={onLogout}><LogOut size={17} />Sign out</button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left"><button className="menu-button" onClick={() => setMobileOpen(true)}><Menu /></button><div><span className="breadcrumb">NJRP EMS / Operations</span><strong>{current}</strong></div></div>
          <div className="topbar-actions">
            <div className="shift-utility"><CalendarDays size={14} /><span>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date())}</span><Clock3 size={14} /><span>{new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</span><b>Shift: Bravo (0800–2000)</b></div>
            <button className="icon-button"><Bell size={18} /><span className="notification-dot" /></button>
            <Button kind="primary" icon={Plus} onClick={create}>New PCR</Button>
            <div className="user-menu"><span className="avatar">{session.user.name.split(" ").map((n) => n[0]).join("")}</span><div><strong>{session.user.name}</strong><small>{session.user.role}</small></div><ChevronDown size={15} /></div>
          </div>
        </header>
        <div className="page-frame">{children}</div>
      </div>
    </div>
  );
}

function PageHeader({ title, description, actions }) {
  return <div className="page-header"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="page-actions">{actions}</div> : null}</div>;
}

function Metric({ label, value, tone, onClick }) {
  return <button className={`metric ${tone}`} onClick={onClick}><strong>{value || 0}</strong><span>{label}</span></button>;
}

function ReportTable({ reports, compact = false }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table className={`data-table elite-report-table ${compact ? "compact-table" : ""}`}>
        <thead><tr><th>PCR / CAD</th><th>Patient</th><th>Incident</th><th>Unit</th><th>Provider</th><th>Updated</th><th>Status</th><th /></tr></thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} onClick={() => navigate(`/reports/${report.id}`)}>
              <td><strong>{report.pcrId}</strong><small>{report.cadNumber || "No CAD assigned"}</small></td>
              <td>{report.patientName}</td>
              <td>{report.incidentType || "Unspecified"}{!compact ? <small>{report.priority}</small> : null}</td>
              <td>{report.unit || "—"}</td><td>{report.providerName}</td><td>{formatTime(report.updatedAt)}</td>
              <td><StatusBadge status={report.status} /></td>
              <td><button className="row-action" aria-label="Open report"><ChevronRight size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!reports.length ? <Empty title="No reports found" body="Try changing your filters or create a new patient care report." /> : null}
    </div>
  );
}

function Empty({ title, body }) {
  return <div className="empty-state"><ClipboardList size={28} /><strong>{title}</strong><p>{body}</p></div>;
}

function Dashboard({ session }) {
  const [data, setData] = useState({ counts: {}, reports: [], activity: [] });
  const navigate = useNavigate();
  useEffect(() => { request("/dashboard").then(setData); }, []);
  const firstName = session.user.name.split(" ")[0];
  return (
    <>
      <PageHeader title={`Good morning, ${firstName}`} description={session.user.role === "Provider" ? "Your open charts and recent field activity." : "System-wide reporting and QA activity."}
        actions={<><Button icon={XCircle} onClick={() => navigate("/refusals/new")}>New refusal</Button><Button kind="primary" icon={Plus} onClick={async () => { const r = await request("/reports", { method: "POST" }); navigate(`/reports/${r.id}`); }}>New PCR</Button></>} />
      <section className="status-overview"><div className="status-overview-title">My Report Status</div><div className="metrics-grid">
        <Metric label="Draft" value={data.counts.Draft} tone="slate" onClick={() => navigate("/reports?status=Draft")} />
        <Metric label="Returned" value={data.counts.Returned} tone="amber" onClick={() => navigate("/reports?status=Returned")} />
        <Metric label="Submitted" value={data.counts.Submitted} tone="blue" onClick={() => navigate("/reports?status=Submitted")} />
        <Metric label="Pending QA" value={session.user.role === "Provider" ? data.counts.Submitted : data.counts.Submitted} tone="purple" onClick={() => navigate(session.user.role === "Provider" ? "/reports?status=Submitted" : "/qa")} />
        <Metric label="Approved" value={data.counts.Approved} tone="green" onClick={() => navigate("/reports?status=Approved")} />
        <Metric label="Locked" value={data.counts.Locked} tone="dark" onClick={() => navigate("/reports?status=Locked")} />
      </div></section>
      <div className="dashboard-grid">
        <section className="panel reports-panel">
          <div className="panel-heading"><div><h2>Recent patient care reports</h2><p>Continue a chart or review its current status.</p></div><Button onClick={() => navigate("/reports")}>View all</Button></div>
          <ReportTable reports={data.reports.slice(0, 6)} compact />
        </section>
        <aside className="panel activity-panel">
          <div className="panel-heading"><div><h2>Recent activity</h2><p>Latest workflow events</p></div><Activity size={19} /></div>
          <div className="timeline">
            {data.activity.length ? data.activity.slice(0, 6).map((item) => <div className="timeline-item" key={item.id}><span /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.user_name} • {formatTime(item.created_at)}</small></div></div>) :
              <div className="timeline-item"><span /><div><strong>Workspace ready</strong><p>Your activity appears here.</p><small>Just now</small></div></div>}
          </div>
        </aside>
      </div>
    </>
  );
}

function Filters({ status, setStatus, query, setQuery }) {
  return <div className="filters"><label className="search-field"><Search size={16} /><input placeholder="Search PCR, CAD, patient, incident…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select value={status} onChange={(e) => setStatus(e.target.value)}>{["All", "Draft", "Returned", "Submitted", "Approved", "Locked"].map((value) => <option key={value}>{value}</option>)}</select><Button icon={CalendarDays}>Date range</Button><Button icon={MoreHorizontal}>More filters</Button></div>;
}

function Reports({ title = "Patient care reports", qaOnly = false }) {
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState(qaOnly ? "Submitted" : new URLSearchParams(location.search).get("status") || "All");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const load = useCallback(() => request(`/reports?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}`).then(setReports), [status, query]);
  useEffect(() => { const timeout = setTimeout(load, 150); return () => clearTimeout(timeout); }, [load]);
  return <>
    <PageHeader title={title} description={qaOnly ? "Review submitted reports, document findings, and advance the QA workflow." : "Find, continue, and review EMS reports across the reporting lifecycle."}
      actions={<Button kind="primary" icon={Plus} onClick={async () => { const r = await request("/reports", { method: "POST" }); navigate(`/reports/${r.id}`); }}>New PCR</Button>} />
    <section className="panel"><Filters status={status} setStatus={setStatus} query={query} setQuery={setQuery} /><div className="result-count">{reports.length} report{reports.length === 1 ? "" : "s"}<span>Sorted by most recently updated</span></div><ReportTable reports={reports} /></section>
  </>;
}

function Field({ label, value, onChange, type = "text", options, textarea = false, span = 1, disabled = false, placeholder = "" }) {
  const props = { value: value ?? "", onChange: (e) => onChange?.(e.target.value), disabled, placeholder };
  return <label className={`field span-${span}`}><span>{label}</span>{textarea ? <textarea {...props} /> : options ? <select {...props}>{options.map((option) => <option key={option}>{option}</option>)}</select> : <input type={type} {...props} />}</label>;
}

function SectionCard({ title, description, children, action }) {
  return <section className="form-section"><div className="form-section-heading"><div><h3>{title}</h3>{description ? <p>{description}</p> : null}</div>{action}</div><div className="form-grid">{children}</div></section>;
}

function IncidentTab({ report, update, readOnly }) {
  const data = report.incident;
  const [agencies, setAgencies] = useState(DEFAULT_AGENCIES);
  const [crewModal, setCrewModal] = useState(false);
  const [crewEntry, setCrewEntry] = useState(blankCrewMember);
  useEffect(() => { request("/settings/agencies").then((rows) => setAgencies(rows.filter((agency) => agency.active !== false && agency.active !== 0).map((agency) => agency.name))).catch(() => setAgencies(DEFAULT_AGENCIES)); }, []);
  const set = (key, value) => update("incident", { ...data, [key]: value });
  const addCrew = () => {
    const clean = { ...crewEntry, agency: crewEntry.agency || agencies[0] || "", providerLevel: crewEntry.providerLevel || "EMT", role: crewEntry.role || CREW_ROLES[0] };
    const crewMembers = [...(data.crewMembers || []), clean];
    update("incident", { ...data, crewMembers, crew: crewMembers.map((member) => `${member.name || "Unnamed"} (${member.role || "Crew"})`).join("; ") });
    setCrewModal(false);
  };
  const removeCrew = (index) => {
    const crewMembers = (data.crewMembers || []).filter((_, i) => i !== index);
    update("incident", { ...data, crewMembers, crew: crewMembers.map((member) => `${member.name || "Unnamed"} (${member.role || "Crew"})`).join("; ") });
  };
  return <>
    <SectionCard title="Incident information" description="Dispatch and response details for this call.">
      <Field label="PCR ID" value={report.pcrId} disabled /><Field label="CAD call number" value={data.cadNumber} onChange={(v) => set("cadNumber", v)} disabled={readOnly} placeholder="26-000001 or any local CAD number" />
      <Field label="Incident location / ERLC postal" value={data.location} onChange={(v) => set("location", v)} disabled={readOnly} span={2} placeholder="Street address, landmark, or ERLC postal code" />
      <Field label="Dispatch complaint / notes" value={data.dispatch} onChange={(v) => set("dispatch", v)} disabled={readOnly} span={2} placeholder="Optional CAD dispatch text" />
      <Field label="Unit" value={data.unit} onChange={(v) => set("unit", v)} disabled={readOnly} /><Field label="Primary provider" value={data.primaryProvider} onChange={(v) => set("primaryProvider", v)} disabled={readOnly} />
      <Field label="Agencies on call" value={data.agencies} onChange={(v) => set("agencies", v)} disabled={readOnly} span={2} placeholder="Example: Atlantic Mobile Health System, Trenton EMS" />
      <Field label="Incident type" value={data.incidentType} onChange={(v) => set("incidentType", v)} disabled={readOnly} options={INCIDENT_TYPES_NEMSIS} />
      <Field label="Scene type" value={data.sceneType} onChange={(v) => set("sceneType", v)} disabled={readOnly} options={SCENE_TYPES} />
      <Field label="Response priority" value={data.priority} onChange={(v) => set("priority", v)} disabled={readOnly} options={["1-Emergent", "2-Urgent", "3-Routine"]} />
      <Field label="Patient acuity" value={data.patientAcuity} onChange={(v) => set("patientAcuity", v)} disabled={readOnly} options={PATIENT_ACUITIES} />
      <Field label="Call disposition" value={data.callDisposition} onChange={(v) => set("callDisposition", v)} disabled={readOnly} options={CALL_DISPOSITIONS} />
      <Field label="Transport mode from scene" value={data.transportMode} onChange={(v) => set("transportMode", v)} disabled={readOnly} options={TRANSPORT_MODES} />
      <Field label="Destination type" value={data.destinationType} onChange={(v) => set("destinationType", v)} disabled={readOnly} options={DESTINATION_TYPES} />
      <Field label="Receiving facility" value={data.receivingFacility || DEFAULT_RECEIVING_FACILITY} onChange={(v) => set("receivingFacility", v)} disabled={readOnly} />
      <Field label="Incident date" value={data.incidentDate} onChange={(v) => set("incidentDate", v)} disabled={readOnly} type="date" /><Field label="Report status" value={report.status} disabled />
      <div className="crew-roster span-2">
        <div className="crew-roster-head"><div><strong>Crew member roles</strong><span>Add each provider as a structured Elite-style crew row.</span></div>{!readOnly ? <Button kind="primary" icon={UserPlus} onClick={() => { setCrewEntry({ ...blankCrewMember, agency: agencies[0] || "" }); setCrewModal(true); }}>Add crew</Button> : null}</div>
        {(data.crewMembers || []).length ? <table><thead><tr><th>Name / Roblox</th><th>Agency</th><th>Level</th><th>Role</th><th>Unit</th>{!readOnly ? <th /> : null}</tr></thead><tbody>{data.crewMembers.map((member, index) => <tr key={`${member.name}-${index}`}><td>{member.name || "—"}</td><td>{member.agency || "—"}</td><td>{member.providerLevel || "—"}</td><td>{member.role || "—"}</td><td>{member.unit || data.unit || "—"}</td>{!readOnly ? <td><button onClick={() => removeCrew(index)}><X size={14} /></button></td> : null}</tr>)}</tbody></table> : <div className="crew-empty">{data.crew ? `Legacy crew text: ${data.crew}` : "No crew members added yet."}</div>}
      </div>
    </SectionCard>
    {crewModal ? <Modal title="Add crew member" saveLabel="Add crew" onClose={() => setCrewModal(false)} onSave={addCrew}><div className="form-grid modal-grid">
      <Field label="Provider / Roblox username" value={crewEntry.name} onChange={(v) => setCrewEntry({ ...crewEntry, name: v })} />
      <Field label="Agency" value={crewEntry.agency} onChange={(v) => setCrewEntry({ ...crewEntry, agency: v })} options={["", ...agencies]} />
      <Field label="Provider level" value={crewEntry.providerLevel} onChange={(v) => setCrewEntry({ ...crewEntry, providerLevel: v })} options={PROVIDER_LEVELS} />
      <Field label="Crew role" value={crewEntry.role} onChange={(v) => setCrewEntry({ ...crewEntry, role: v })} options={CREW_ROLES} />
      <Field label="Assigned unit" value={crewEntry.unit} onChange={(v) => setCrewEntry({ ...crewEntry, unit: v })} placeholder={data.unit || "Unit number"} />
    </div></Modal> : null}
  </>;
}

function PatientTab({ report, update, readOnly }) {
  const data = report.patient; const set = (key, value) => update("patient", { ...data, [key]: value });
  return <SectionCard title="Patient demographics" description="Identity and medical history collected during the encounter.">
    <Field label="Patient name" value={data.patientName} onChange={(v) => set("patientName", v)} disabled={readOnly} span={2} />
    <Field label="Age" value={data.age} onChange={(v) => set("age", v)} disabled={readOnly} /><Field label="Date of birth" value={data.dob} onChange={(v) => set("dob", v)} disabled={readOnly} type="date" />
    <Field label="Sex" value={data.sex} onChange={(v) => set("sex", v)} disabled={readOnly} options={["", "Male", "Female", "Non-binary", "Unknown"]} /><Field label="Weight" value={data.weight} onChange={(v) => set("weight", v)} disabled={readOnly} />
    <Field label="Chief complaint" value={data.chiefComplaint} onChange={(v) => set("chiefComplaint", v)} disabled={readOnly} span={2} />
    <Field label="Allergies" value={data.allergies} onChange={(v) => set("allergies", v)} disabled={readOnly} /><Field label="Current medications" value={data.medications} onChange={(v) => set("medications", v)} disabled={readOnly} />
    <Field label="Past medical history" value={data.pastMedicalHistory} onChange={(v) => set("pastMedicalHistory", v)} disabled={readOnly} textarea span={2} />
  </SectionCard>;
}

const timeFields = [["dispatched", "Dispatched"], ["enroute", "En route"], ["onScene", "On scene"], ["patientContact", "Patient contact"], ["departScene", "Depart scene"], ["atDestination", "At destination"], ["transferOfCare", "Transfer of care"], ["available", "Available"]];
function TimesTab({ report, update, readOnly }) {
  const set = (key, value) => update("times", { ...report.times, [key]: value });
  return <SectionCard title="Response timeline" description="Use current time to capture milestones quickly.">
    {timeFields.map(([key, label]) => <label className="field time-field" key={key}><span>{label}</span><div><input type="time" value={report.times[key] || ""} disabled={readOnly} onChange={(e) => set(key, e.target.value)} />{!readOnly ? <button onClick={() => set(key, new Date().toTimeString().slice(0, 5))} type="button"><Clock3 size={14} />Now</button> : null}</div></label>)}
  </SectionCard>;
}

function AssessmentTab({ report, update, readOnly }) {
  const data = report.assessment; const set = (key, value) => update("assessment", { ...data, [key]: value });
  return <>
    <SectionCard title="Primary assessment">
      <Field label="Mental status" value={data.mentalStatus} onChange={(v) => set("mentalStatus", v)} disabled={readOnly} options={["", "Alert and oriented ×4", "Alert and confused", "Responds to verbal stimuli", "Responds to painful stimuli", "Unresponsive"]} />
      <Field label="AVPU" value={data.avpu} onChange={(v) => set("avpu", v)} disabled={readOnly} options={["", "Alert", "Verbal", "Pain", "Unresponsive"]} />
      <Field label="GCS" value={data.gcs} onChange={(v) => set("gcs", v)} disabled={readOnly} /><Field label="Pain scale" value={data.painScale} onChange={(v) => set("painScale", v)} disabled={readOnly} />
      <Field label="Airway" value={data.airway} onChange={(v) => set("airway", v)} disabled={readOnly} /><Field label="Breathing" value={data.breathing} onChange={(v) => set("breathing", v)} disabled={readOnly} />
      <Field label="Circulation" value={data.circulation} onChange={(v) => set("circulation", v)} disabled={readOnly} /><Field label="Skin" value={data.skin} onChange={(v) => set("skin", v)} disabled={readOnly} />
      <Field label="Pupils" value={data.pupils} onChange={(v) => set("pupils", v)} disabled={readOnly} /><Field label="Lung sounds" value={data.lungSounds} onChange={(v) => set("lungSounds", v)} disabled={readOnly} />
    </SectionCard>
    <SectionCard title="Clinical history & exam">
      <Field label="OPQRST" value={data.opqrst} onChange={(v) => set("opqrst", v)} disabled={readOnly} textarea span={2} />
      <Field label="SAMPLE" value={data.sample} onChange={(v) => set("sample", v)} disabled={readOnly} textarea span={2} />
      <Field label="Physical exam" value={data.physicalExam} onChange={(v) => set("physicalExam", v)} disabled={readOnly} textarea span={2} />
      <Field label="Primary impression" value={data.impression} onChange={(v) => set("impression", v)} disabled={readOnly} span={2} />
    </SectionCard>
  </>;
}

function Modal({ title, children, onClose, onSave, saveLabel = "Add entry" }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal elite-entry-modal"><div className="modal-heading"><div><span className="small-caps">General Form</span><h2>{title}</h2></div><button onClick={onClose}><X /></button></div><div className="elite-modal-toolbar"><button type="button" onClick={onSave}><Check size={14} />OK</button><button type="button" onClick={onClose}><X size={14} />Cancel</button></div><div className="modal-body">{children}</div><div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button kind="primary" icon={Check} onClick={onSave}>{saveLabel}</Button></div></div></div>;
}

function DataTable({ columns, rows, abnormal, empty, onDelete, readOnly }) {
  return <div className="clinical-table"><table><thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}{!readOnly ? <th /> : null}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.id || "new"}-${index}`}>{columns.map((c) => <td key={c.key} className={abnormal?.(c.key, row[c.key]) ? "abnormal" : ""}>{row[c.key] || "—"}</td>)}{!readOnly ? <td><button onClick={() => onDelete(index)}><X size={14} /></button></td> : null}</tr>)}</tbody></table>{!rows.length ? <Empty title={empty} body="Add the first entry to begin this clinical timeline." /> : null}</div>;
}

function VitalsTab({ report, update, readOnly }) {
  const [modal, setModal] = useState(false); const [entry, setEntry] = useState(blankVitals);
  const vitalRows = [
    ["bp", "BP (mmHg)", (v) => `${v.sys || "—"}/${v.dia || "—"}`, "90–120 / 60–80"],
    ["hr", "HR (bpm)", (v) => v.hr || "—", "60–100"],
    ["rr", "RR (br/min)", (v) => v.rr || "—", "12–20"],
    ["spo2", "SpO₂ (%)", (v) => v.spo2 || "—", "≥ 94"],
    ["etco2", "EtCO₂ (mmHg)", (v) => v.etco2 || "—", "35–45"],
    ["temp", "Temperature (°F)", (v) => v.temp || "—", "97.0–99.5"],
    ["bgl", "Blood glucose", (v) => v.bgl || "—", "70–140"],
    ["pain", "Pain (0–10)", (v) => v.pain || "—", "—"],
    ["gcs", "GCS", (v) => v.gcs || "—", "15"],
    ["rhythm", "Rhythm", (v) => v.rhythm || "—", "—"],
  ];
  const abnormal = (key, vital) => (key === "bp" && (+vital.sys > 160 || +vital.sys < 90)) || (key === "hr" && (+vital.hr < 50 || +vital.hr > 100)) || (key === "spo2" && +vital.spo2 < 94) || (key === "rr" && (+vital.rr < 10 || +vital.rr > 24)) || (key === "pain" && +vital.pain >= 7);
  return <SectionCard title="Vitals" description="Serial measurements with reference ranges and abnormal-value review." action={<div className="clinical-actions">{!readOnly ? <Button kind="primary" icon={Plus} onClick={() => { setEntry({ ...blankVitals, time: new Date().toTimeString().slice(0, 5) }); setModal(true); }}>Add set</Button> : null}<Button icon={Gauge}>Trend</Button><Button icon={History}>History</Button></div>}>
    <div className="span-2 transposed-vitals"><table><thead><tr><th>Measurement</th>{report.vitals.map((v, index) => <th key={`${v.id || index}-${v.time}`}><strong>{v.time || "Time"}</strong><small>{index === 0 ? "On scene" : index === report.vitals.length - 1 ? "Latest" : "En route"}</small></th>)}<th>Reference range</th></tr></thead><tbody>{vitalRows.map(([key, label, render, range]) => <tr key={key}><th>{label}</th>{report.vitals.map((v, index) => <td key={`${key}-${v.id || index}`} className={abnormal(key, v) ? "abnormal" : ""}>{render(v)}</td>)}<td className="reference-range">{range}</td></tr>)}</tbody></table>{!report.vitals.length ? <Empty title="No vital signs recorded" body="Add the first set to begin the serial vital timeline." /> : null}</div>
    {modal ? <Modal title="Add vital signs" onClose={() => setModal(false)} onSave={() => { update("vitals", [...report.vitals, entry]); setModal(false); }}><div className="form-grid modal-grid">{Object.keys(blankVitals).map((key) => <Field key={key} label={{ sys: "BP systolic", dia: "BP diastolic", spo2: "SpO₂", etco2: "EtCO₂", bgl: "BGL", gcs: "GCS", hr: "Heart rate", rr: "Respiratory rate", temp: "Temperature", pain: "Pain", rhythm: "Rhythm", time: "Time", notes: "Notes" }[key]} value={entry[key]} type={key === "time" ? "time" : "text"} onChange={(v) => setEntry({ ...entry, [key]: v })} />)}</div></Modal> : null}
  </SectionCard>;
}

function MedicationsTab({ report, update, readOnly }) {
  const [modal, setModal] = useState(false); const [entry, setEntry] = useState(blankMedication);
  const columns = [{ key: "time", label: "Time" }, { key: "medication", label: "Medication" }, { key: "dose", label: "Dose" }, { key: "route", label: "Route" }, { key: "indication", label: "Indication" }, { key: "contraindications", label: "Checks" }, { key: "response", label: "Response" }, { key: "administeredBy", label: "By" }];
  return <SectionCard title="Medications" description="Document administered medications and patient response." action={!readOnly ? <Button kind="primary" icon={Plus} onClick={() => { setEntry({ ...blankMedication, time: new Date().toTimeString().slice(0, 5) }); setModal(true); }}>Add medication</Button> : null}>
    <div className="span-2"><DataTable columns={columns} rows={report.medications} empty="No medications recorded" readOnly={readOnly} onDelete={(i) => update("medications", report.medications.filter((_, index) => index !== i))} /></div>
    {modal ? <Modal title="Add medication" onClose={() => setModal(false)} onSave={() => { update("medications", [...report.medications, entry]); setModal(false); }}><div className="form-grid modal-grid">{Object.keys(blankMedication).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, " $1")} value={entry[key]} type={key === "time" ? "time" : "text"} onChange={(v) => setEntry({ ...entry, [key]: v })} />)}</div></Modal> : null}
  </SectionCard>;
}

function InterventionsTab({ report, update, readOnly }) {
  const [modal, setModal] = useState(false); const [entry, setEntry] = useState(blankIntervention);
  const columns = [{ key: "time", label: "Time" }, { key: "intervention", label: "Intervention" }, { key: "successful", label: "Success" }, { key: "performedBy", label: "Performed by" }, { key: "response", label: "Response" }, { key: "notes", label: "Notes" }];
  return <SectionCard title="Procedures & interventions" description="Capture clinical procedures, attempts, and outcomes." action={!readOnly ? <Button kind="primary" icon={Plus} onClick={() => { setEntry({ ...blankIntervention, time: new Date().toTimeString().slice(0, 5) }); setModal(true); }}>Add intervention</Button> : null}>
    <div className="span-2"><DataTable columns={columns} rows={report.interventions} empty="No interventions recorded" readOnly={readOnly} onDelete={(i) => update("interventions", report.interventions.filter((_, index) => index !== i))} /></div>
    {modal ? <Modal title="Add intervention" onClose={() => setModal(false)} onSave={() => { update("interventions", [...report.interventions, entry]); setModal(false); }}><div className="form-grid modal-grid">{Object.keys(blankIntervention).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, " $1")} value={entry[key]} type={key === "time" ? "time" : "text"} onChange={(v) => setEntry({ ...entry, [key]: v })} />)}</div></Modal> : null}
  </SectionCard>;
}

function NarrativeTab({ report, update, readOnly }) {
  const data = report.narrative; const set = (key, value) => update("narrative", { ...data, [key]: value });
  const generateAbstract = () => {
    const first = report.vitals[0] || {};
    const latest = report.vitals.at(-1) || {};
    const medicationText = report.medications.length ? report.medications.map((m) => `${m.medication} ${m.dose} ${m.route}`).join(", ") : "no medications documented";
    const interventionText = report.interventions.length ? report.interventions.map((i) => i.intervention).join(", ") : "no procedures documented";
    const crewText = (report.incident.crewMembers || []).length ? report.incident.crewMembers.map((m) => `${m.name || "Crew"} as ${m.role || "crew"} (${m.providerLevel || "level not set"})`).join("; ") : report.incident.crew || "crew not documented";
    const abstract = `${report.incident.unit || "Unit"} responded ${report.incident.priority || "priority not set"} to ${report.incident.location || "an undocumented location"} for ${report.incident.dispatch || report.patient.chiefComplaint || report.incident.incidentType || "an EMS complaint"}. Scene type ${report.incident.sceneType || "not documented"}; patient acuity ${report.incident.patientAcuity || "not documented"}. Crew: ${crewText}. ${report.patient.age || "Unknown-age"} ${report.patient.sex || "patient"} evaluated for ${report.patient.chiefComplaint || report.incident.incidentType || "EMS complaint"}. Patient was ${report.assessment.mentalStatus || "assessed"} with GCS ${report.assessment.gcs || latest.gcs || "not documented"}, ${report.assessment.airway || "airway status not documented"}, and ${report.assessment.breathing || "breathing status not documented"}. Initial vital signs: BP ${first.sys || "--"}/${first.dia || "--"}, HR ${first.hr || "--"}, RR ${first.rr || "--"}, SpO2 ${first.spo2 || "--"}%. Treatments included ${medicationText}; interventions included ${interventionText}. Latest reassessment: BP ${latest.sys || "--"}/${latest.dia || "--"}, HR ${latest.hr || "--"}, RR ${latest.rr || "--"}, SpO2 ${latest.spo2 || "--"}%, pain ${latest.pain || "--"}/10. Disposition: ${report.incident.callDisposition || "not documented"}; transport mode ${report.incident.transportMode || "not documented"} to ${report.incident.receivingFacility || DEFAULT_RECEIVING_FACILITY}. Primary impression: ${report.assessment.impression || "not documented"}.`;
    set("medicalAbstract", abstract);
  };
  return <SectionCard title="Narrative" description="Build a complete chronological account of assessment, treatment, and transport." action={!readOnly ? <Button icon={Activity} onClick={generateAbstract}>Auto medical abstract</Button> : null}>
    <Field label="Medical abstract" value={data.medicalAbstract} onChange={(v) => set("medicalAbstract", v)} disabled={readOnly} textarea span={2} />
    <div className="rich-text span-2"><div className="rich-toolbar"><button><strong>B</strong></button><button><em>I</em></button><button>• List</button><span /> <small>{(data.full || "").length} characters</small></div><textarea value={data.full || ""} disabled={readOnly} onChange={(e) => set("full", e.target.value)} placeholder="Enter the complete patient care narrative…" /></div>
  </SectionCard>;
}

function DispositionTab({ report, update, readOnly }) {
  const data = report.signatures?.[0] || {};
  const set = (key, value) => update("signatures", [{ ...data, [key]: value }]);
  return <SectionCard title="Disposition & signatures" description="Close the encounter and document transfer of care.">
    <Field label="Disposition" value={data.disposition} onChange={(v) => set("disposition", v)} disabled={readOnly} options={["", "Transported", "Treated and released", "Refused care", "Cancelled", "No patient found"]} />
    <Field label="Destination" value={data.destination} onChange={(v) => set("destination", v)} disabled={readOnly} />
    <Field label="Destination type" value={data.destinationType || report.incident.destinationType} onChange={(v) => set("destinationType", v)} disabled={readOnly} options={DESTINATION_TYPES} />
    <Field label="Transport mode from scene" value={data.transportMode || report.incident.transportMode} onChange={(v) => set("transportMode", v)} disabled={readOnly} options={TRANSPORT_MODES} />
    <Field label="Receiving facility" value={data.receivingFacility || report.incident.receivingFacility || DEFAULT_RECEIVING_FACILITY} onChange={(v) => set("receivingFacility", v)} disabled={readOnly} />
    <Field label="Patient acuity at disposition" value={data.patientAcuity || report.incident.patientAcuity} onChange={(v) => set("patientAcuity", v)} disabled={readOnly} options={PATIENT_ACUITIES} />
    <Field label="Transfer of care to" value={data.transferTo} onChange={(v) => set("transferTo", v)} disabled={readOnly} span={2} />
    {[["providerSignature", "Provider signature"], ["patientSignature", "Patient signature"], ["witnessSignature", "Witness signature"]].map(([key, label]) => <label className="signature-box" key={key}><span>{label}</span><input value={data[key] || ""} disabled={readOnly} onChange={(e) => set(key, e.target.value)} placeholder="Type full legal name" /><small>Electronic signature attestation</small></label>)}
  </SectionCard>;
}

function QaTab({ report, session, reload }) {
  const [comment, setComment] = useState("");
  const isReviewer = ["Supervisor", "Admin"].includes(session.user.role);
  const act = async (action) => {
    const updated = await request(`/reports/${report.id}/action`, { method: "POST", body: JSON.stringify({ action, comment }) });
    setComment(""); reload(updated);
  };
  const addComment = async () => { if (!comment.trim()) return; const updated = await request(`/reports/${report.id}/comments`, { method: "POST", body: JSON.stringify({ comment }) }); setComment(""); reload(updated); };
  return <div className="qa-layout">
    <SectionCard title="QA / QI review" description="Supervisor documentation and report disposition.">
      {isReviewer ? <Field label="QA comment or return reason" value={comment} onChange={setComment} textarea span={2} placeholder="Document findings clearly and specifically…" /> : null}
      {isReviewer ? <div className="qa-actions span-2"><Button icon={MessageSquareText} onClick={addComment}>Add comment</Button>{report.status === "Submitted" ? <><Button kind="danger" icon={RefreshCw} onClick={() => act("return")}>Return to provider</Button><Button kind="success" icon={Check} onClick={() => act("approve")}>Approve report</Button></> : null}{report.status === "Approved" ? <Button kind="dark" icon={LockKeyhole} onClick={() => act("lock")}>Lock report</Button> : null}</div> : <div className="readonly-callout span-2"><LockKeyhole size={17} />QA actions are available to supervisors and administrators.</div>}
    </SectionCard>
    <section className="form-section"><div className="form-section-heading"><div><h3>Review comments</h3><p>Feedback remains with the permanent report history.</p></div></div><div className="comment-list">{report.qaComments.length ? report.qaComments.map((item) => <div className="comment" key={item.id}><span className="avatar small">{item.author.split(" ").map((n) => n[0]).join("")}</span><div><strong>{item.author}<em>{item.type}</em></strong><p>{item.comment}</p><small>{formatTime(item.created_at)}</small></div></div>) : <Empty title="No QA comments" body="This report has not received reviewer feedback." />}</div></section>
    <section className="form-section"><div className="form-section-heading"><div><h3>Audit history</h3><p>Every meaningful report action is recorded.</p></div></div><div className="audit-list">{report.audit.map((item) => <div key={item.id}><span><History size={14} /></span><p><strong>{item.action}</strong>{item.detail}</p><small>{item.user_name}<br />{formatTime(item.created_at)}</small></div>)}</div></section>
  </div>;
}

const TABS = [
  ["Incident", ClipboardList], ["Patient", UserRound], ["Times", Clock3], ["Assessment", Stethoscope],
  ["Vitals", Gauge], ["Medications", Plus], ["Interventions", Activity], ["Narrative", FileText],
  ["Disposition", BadgeCheck], ["QA/QI", ShieldCheck],
];

const SECTION_GROUPS = [
  { title: "Street Sheet", tone: "required", tabs: ["Incident"] },
  { title: "CAD Info/Dispatch", tone: "optional", tabs: ["Times"] },
  { title: "Patient Info", tone: "required", tabs: ["Patient"] },
  { title: "Patient History", tone: "optional", tabs: ["Assessment"] },
  { title: "Vitals/Assessments/Treatments", tone: "optional", tabs: ["Vitals", "Medications", "Interventions"] },
  { title: "Chief Complaint", tone: "optional", tabs: ["Narrative"] },
  { title: "Narrative", tone: "required", tabs: ["Disposition"] },
  { title: "Signatures", tone: "required", tabs: ["QA/QI"] },
];

function PcrEditor({ session }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState("Incident");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [toast, setToast] = useState("");
  const reportRef = useRef(null);
  const load = useCallback((provided) => provided ? setReport(provided) : request(`/reports/${id}`).then(setReport), [id]);
  useEffect(() => { load(); }, [load]);
  const readOnly = report ? report.status === "Locked" || report.status === "Approved" || (session.user.role === "Provider" && !["Draft", "Returned"].includes(report.status)) || session.user.role === "Supervisor" : true;
  useEffect(() => { reportRef.current = report; }, [report]);
  const update = (key, value) => { setReport((current) => ({ ...current, [key]: value })); setDirty(true); setSaveState("Unsaved"); };
  const save = useCallback(async (silent = false) => {
    if (!reportRef.current) return;
    const snapshot = reportRef.current;
    setSaveState("Saving...");
    const updated = await request(`/reports/${id}`, { method: "PUT", body: JSON.stringify(snapshot) });
    const hasNewerTyping = reportRef.current !== snapshot;
    if (silent || hasNewerTyping) {
      reportRef.current = hasNewerTyping ? reportRef.current : { ...reportRef.current, updatedAt: updated.updatedAt };
    } else {
      setReport(updated);
      reportRef.current = updated;
    }
    setDirty(hasNewerTyping);
    setSaveState(hasNewerTyping ? "Unsaved" : "Saved");
    if (!silent && !hasNewerTyping) { setToast("Report saved"); setTimeout(() => setToast(""), 2200); }
  }, [id]);
  useEffect(() => {
    if (!dirty || readOnly) return undefined;
    const timer = setTimeout(() => save(true).catch(() => setSaveState("Save failed")), 1200);
    return () => clearTimeout(timer);
  }, [dirty, readOnly, save]);
  const chartAction = async (action, message) => {
    if (dirty && action === "submit") await save();
    const updated = await request(`/reports/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
    setReport(updated); reportRef.current = updated; setDirty(false); setSaveState("Saved");
    setToast(message); setTimeout(() => setToast(""), 2400);
  };
  const submit = () => chartAction("submit", "Posted to QA");
  const reviewAction = (action) => chartAction(action, action === "approve" ? "Approved report" : action === "return" ? "Returned to provider" : "Locked report");
  const deleteReport = async () => {
    if (!window.confirm(`Delete ${report?.pcrId || "this report"}? This cannot be undone.`)) return;
    await request(`/reports/${id}`, { method: "DELETE" });
    navigate("/reports", { replace: true });
  };
  if (!report) return <div className="loading"><RefreshCw className="spin" />Loading patient care report…</div>;
  const canSubmitReport = ["Provider", "Admin"].includes(session.user.role) && ["Draft", "Returned"].includes(report.status);
  const tabProps = { report, update, readOnly };
  const content = {
    Incident: <IncidentTab {...tabProps} />, Patient: <PatientTab {...tabProps} />, Times: <TimesTab {...tabProps} />,
    Assessment: <AssessmentTab {...tabProps} />, Vitals: <VitalsTab {...tabProps} />, Medications: <MedicationsTab {...tabProps} />,
    Interventions: <InterventionsTab {...tabProps} />, Narrative: <NarrativeTab {...tabProps} />, Disposition: <DispositionTab {...tabProps} />,
    "QA/QI": <QaTab report={report} session={session} reload={load} />,
  }[tab];
  const validationScore = report ? Math.min(100, 35 + [report.incident.cadNumber, report.incident.unit, report.patient.patientName, report.patient.chiefComplaint, report.assessment.impression, report.narrative.full, report.vitals.length, report.signatures.length].filter(Boolean).length * 8) : 0;
  return <div className="editor-page classic-editor">
    <div className="elite-commandbar">
      <label><Search size={17} /><input placeholder="Find field..." /></label>
      {!readOnly ? <button className="elite-save" onClick={() => save(false)}><Check size={17} />Save</button> : null}
      {canSubmitReport ? <button className="elite-post" onClick={submit}><ClipboardCheck size={17} />Post</button> : null}
      {["Supervisor", "Admin"].includes(session.user.role) && report.status === "Submitted" ? <button className="elite-approve" onClick={() => reviewAction("approve")}><Check size={17} />Approve</button> : null}
      {["Supervisor", "Admin"].includes(session.user.role) && report.status === "Submitted" ? <button className="elite-return" onClick={() => reviewAction("return")}><RefreshCw size={17} />Return</button> : null}
      {["Supervisor", "Admin"].includes(session.user.role) && report.status === "Approved" ? <button className="elite-lock" onClick={() => reviewAction("lock")}><LockKeyhole size={17} />Lock</button> : null}
      {session.user.role === "Admin" ? <button className="elite-delete" onClick={deleteReport}><Trash2 size={17} />Delete</button> : null}
      <button onClick={() => openAuthenticatedPdf(`/api/reports/${id}/pdf`)}><Printer size={17} />Print</button>
      <button onClick={() => openAuthenticatedPdf(`/api/reports/${id}/pdf`)}><FileText size={17} />PDF</button>
      <button><Ambulance size={17} />CAD</button><button><RefreshCw size={17} />Transfers</button><button><MessageSquareText size={17} />Messages</button>
      <button className="elite-close" onClick={() => navigate("/reports")}><X size={17} />Close</button>
    </div>
    <div className="editor-header">
      <button className="back-button" onClick={() => navigate(-1)}><ArrowLeft /></button>
      <div><div className="editor-title-line"><h1>{report.pcrId}</h1><StatusBadge status={report.status} />{dirty ? <span className="unsaved-dot">Unsaved changes</span> : null}</div><p>{report.incident.incidentType || "New patient care report"} • {report.patient.patientName || "Patient not identified"} • {report.incident.cadNumber || "CAD pending"}</p></div>
      <div className="editor-header-actions"><Button icon={Printer} onClick={() => openAuthenticatedPdf(`/api/reports/${id}/pdf`)}>Preview PDF</Button></div>
    </div>
    {readOnly ? <div className="readonly-banner"><LockKeyhole size={16} /><div><strong>This report is read-only</strong><span>{report.status === "Submitted" ? "It is currently awaiting QA review." : `Status: ${report.status}`}</span></div></div> : null}
    {canSubmitReport ? <div className="submit-callout"><div><strong>Ready to send this chart to QA?</strong><span>Use Post / Submit when documentation is complete. You can still save drafts until you post.</span></div><Button kind="success" icon={ClipboardCheck} onClick={submit}>Post / Submit to QA</Button></div> : null}
    <div className="classic-workspace">
      <aside className="classic-section-nav">
        <div className="classic-search-label">Elite Field</div>
        {SECTION_GROUPS.map((group) => (
          <div className="classic-nav-group" key={group.title}>
            <div className={`classic-nav-parent ${group.tone}`}><span>{group.tone === "required" ? "!" : ""}</span>{group.title}<ChevronDown size={15} /></div>
            {group.tabs.map((name) => <button key={name} className={`${group.tone} ${tab === name ? "active" : ""}`} onClick={() => setTab(name)}><span>{group.tone === "required" ? "!" : ""}</span>{name}<ChevronRight size={15} /></button>)}
          </div>
        ))}
      </aside>
      <main className="editor-body"><div className="classic-form-title">{tab}</div>{content}</main>
      <aside className="classic-tools">{["Times", "Image", "Timeline", "Validate", "Medical Abstract", "QA"].map((item) => <button key={item}><FileText size={16} />{item}</button>)}</aside>
    </div>
    <div className="editor-actionbar classic-statusbar"><div className="validation-score"><strong>{validationScore}</strong><span>Validation</span></div><div className="save-indicator"><span className={saveState === "Saved" ? "saved-dot" : "saving-dot"} />{saveState}<small>{canSubmitReport ? "Use Post when the chart is ready for QA" : "QA actions are available in the toolbar and QA/QI tab"}</small></div><div className="status-select">Status:<strong>{report.status}</strong></div><div>{!readOnly ? <Button kind="primary" icon={Check} onClick={() => save(false)}>Save</Button> : null}{canSubmitReport ? <Button kind="success" icon={ClipboardCheck} onClick={submit}>Post / Submit</Button> : null}{["Supervisor", "Admin"].includes(session.user.role) && report.status === "Submitted" ? <Button kind="success" icon={Check} onClick={() => reviewAction("approve")}>Approve</Button> : null}{session.user.role === "Admin" ? <Button kind="danger" icon={Trash2} onClick={deleteReport}>Delete</Button> : null}</div></div>
    {toast ? <div className="toast"><Check size={16} />{toast}</div> : null}
  </div>;
}

function Refusals({ session }) {
  const [items, setItems] = useState([]);
  const navigate = useNavigate();
  useEffect(() => { request("/refusals").then(setItems); }, []);
  return <>
    <PageHeader title="Refusal reports" description="Document informed refusal, capacity, risks, alternatives, and signatures." actions={<Button kind="primary" icon={Plus} onClick={() => navigate("/refusals/new")}>New refusal</Button>} />
    <section className="panel">
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Refusal ID</th><th>Patient</th><th>Provider</th><th>Capacity</th><th>Updated</th><th>Status</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id} onClick={() => navigate(`/refusals/${item.id}`)}><td><strong>{item.refusalId}</strong></td><td>{item.patientName}</td><td>{item.providerName}</td><td>{item.capacity?.slice(0, 55)}…</td><td>{formatTime(item.updatedAt)}</td><td><StatusBadge status={item.status} /></td><td><ChevronRight size={16} /></td></tr>)}</tbody></table></div>
    </section>
  </>;
}

function RefusalEditor({ session }) {
  const { id } = useParams(); const navigate = useNavigate();
  const [record, setRecord] = useState({ linkedPcrId: "", patientName: "", age: "", sex: "", capacity: "", recommendedCare: "", risksExplained: "", patientRefused: true, alternatives: "", witness: "", providerNotes: "", signatures: { patient: "", provider: session.user.name, witness: "" } });
  const [recordId, setRecordId] = useState(id === "new" ? null : id);
  useEffect(() => { if (id !== "new") request("/refusals").then((rows) => setRecord(rows.find((row) => String(row.id) === id) || record)); }, [id]);
  const set = (key, value) => setRecord((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (recordId) await request(`/refusals/${recordId}`, { method: "PUT", body: JSON.stringify(record) });
    else { const created = await request("/refusals", { method: "POST", body: JSON.stringify(record) }); setRecordId(created.id); navigate(`/refusals/${created.id}`, { replace: true }); }
  };
  return <div className="editor-page">
    <div className="editor-header"><button className="back-button" onClick={() => navigate("/refusals")}><ArrowLeft /></button><div><div className="editor-title-line"><h1>{record.refusalId || "New refusal report"}</h1><StatusBadge status="Draft" /></div><p>Informed refusal of evaluation, treatment, and/or transport</p></div><div className="editor-header-actions">{recordId ? <Button icon={Printer} onClick={() => openAuthenticatedPdf(`/api/refusals/${recordId}/pdf`)}>Preview PDF</Button> : null}</div></div>
    <main className="editor-body refusal-body">
      <SectionCard title="Patient & linked incident"><Field label="Linked PCR ID" value={record.linkedPcrId} onChange={(v) => set("linkedPcrId", v)} /><Field label="Patient name" value={record.patientName} onChange={(v) => set("patientName", v)} /><Field label="Age" value={record.age} onChange={(v) => set("age", v)} /><Field label="Sex" value={record.sex} onChange={(v) => set("sex", v)} options={["", "Male", "Female", "Non-binary", "Unknown"]} /></SectionCard>
      <SectionCard title="Capacity & informed refusal" description="Document the patient’s ability to understand, appreciate, reason, and communicate a choice.">
        <Field label="Capacity assessment" value={record.capacity} onChange={(v) => set("capacity", v)} textarea span={2} /><Field label="Recommended care" value={record.recommendedCare} onChange={(v) => set("recommendedCare", v)} textarea span={2} />
        <Field label="Risks explained" value={record.risksExplained} onChange={(v) => set("risksExplained", v)} textarea span={2} /><Field label="Alternatives offered" value={record.alternatives} onChange={(v) => set("alternatives", v)} textarea span={2} />
        <Field label="Witness" value={record.witness} onChange={(v) => set("witness", v)} /><Field label="Provider notes" value={record.providerNotes} onChange={(v) => set("providerNotes", v)} textarea />
      </SectionCard>
      <SectionCard title="Signatures">
        {["patient", "provider", "witness"].map((key) => <label className="signature-box" key={key}><span>{key[0].toUpperCase() + key.slice(1)} signature</span><input value={record.signatures[key] || ""} onChange={(e) => set("signatures", { ...record.signatures, [key]: e.target.value })} placeholder="Type full legal name" /><small>Electronic signature attestation</small></label>)}
      </SectionCard>
    </main>
    <div className="editor-actionbar"><div><span>Refusal documentation</span><small>Review all fields before finalizing</small></div><div>{recordId ? <Button icon={Printer} onClick={() => openAuthenticatedPdf(`/api/refusals/${recordId}/pdf`)}>Generate PDF</Button> : null}<Button kind="primary" icon={Check} onClick={save}>Save refusal</Button></div></div>
  </div>;
}

function AuditPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { request("/audit").then(setItems); }, []);
  return <><PageHeader title="Audit log" description="Immutable operational history across authentication, documentation, and QA actions." /><section className="panel"><div className="audit-page-list">{items.map((item) => <div key={item.id}><span className="audit-icon"><History size={16} /></span><div><strong>{item.action}</strong><p>{item.detail}</p></div><span>{item.pcr_id || "System"}</span><span>{item.user_name}</span><time>{formatTime(item.created_at)}</time></div>)}</div></section></>;
}

function CadPage() {
  const [agencies, setAgencies] = useState(DEFAULT_AGENCIES);
  const [units, setUnits] = useState([]);
  const [calls, setCalls] = useState([]);
  const [unitForm, setUnitForm] = useState({ unitNumber: "", label: "Ambulance", agency: DEFAULT_AGENCIES[0], status: "Available", crewText: "" });
  const [callForm, setCallForm] = useState({ location: "", incidentType: "", sceneType: "", priority: "2-Urgent", dispatchNotes: "", unitsText: "" });
  const navigate = useNavigate();
  const load = useCallback(async () => {
    const [agencyRows, unitRows, callRows] = await Promise.all([request("/settings/agencies"), request("/cad/units"), request("/cad/calls")]);
    setAgencies(agencyRows.filter((agency) => agency.active !== false && agency.active !== 0).map((agency) => agency.name));
    setUnits(unitRows);
    setCalls(callRows);
  }, []);
  useEffect(() => { load(); }, [load]);
  const createUnit = async () => {
    if (!unitForm.unitNumber.trim()) return;
    await request("/cad/units", { method: "POST", body: JSON.stringify({ ...unitForm, crew: unitForm.crewText.split(",").map((name) => name.trim()).filter(Boolean) }) });
    setUnitForm({ ...unitForm, unitNumber: "", crewText: "" });
    load();
  };
  const createCall = async () => {
    const row = await request("/cad/calls", { method: "POST", body: JSON.stringify({ ...callForm, units: callForm.unitsText.split(",").map((unit) => unit.trim()).filter(Boolean) }) });
    setCallForm({ location: "", incidentType: "", sceneType: "", priority: "2-Urgent", dispatchNotes: "", unitsText: "" });
    load();
    return row;
  };
  const newPcrFromCall = async (call) => {
    const report = await request("/reports", { method: "POST", body: JSON.stringify({ incident: { cadNumber: call.cadNumber, location: call.location, incidentType: call.incidentType, sceneType: call.sceneType, priority: call.priority, dispatch: call.dispatchNotes, unit: (call.units || [])[0] || "" } }) });
    navigate(`/reports/${report.id}`);
  };
  return <>
    <PageHeader title="CAD / dispatch board" description="Create roleplay CAD calls, active units, and dispatch unit groups. CAD numbers auto-generate as 26-XXXXXX, but PCRs still accept any CAD value." actions={<Button kind="primary" icon={RadioTower} onClick={async () => { const call = await createCall(); if (call) load(); }}>Create call</Button>} />
    <div className="cad-layout">
      <section className="panel cad-panel"><div className="panel-heading"><div><h2>Active units</h2><p>Unit groups can be selected by number in CAD or manually edited in a PCR.</p></div><Truck size={18} /></div><div className="cad-form">
        <Field label="Unit number" value={unitForm.unitNumber} onChange={(v) => setUnitForm({ ...unitForm, unitNumber: v })} placeholder="Medic 12" />
        <Field label="Type / label" value={unitForm.label} onChange={(v) => setUnitForm({ ...unitForm, label: v })} options={["Ambulance", "Medic", "BLS", "Rescue", "Supervisor", "Fly car"]} />
        <Field label="Agency" value={unitForm.agency} onChange={(v) => setUnitForm({ ...unitForm, agency: v })} options={agencies} />
        <Field label="Status" value={unitForm.status} onChange={(v) => setUnitForm({ ...unitForm, status: v })} options={["Available", "Dispatched", "En route", "On scene", "Transporting", "At hospital", "Out of service"]} />
        <Field label="Crew usernames" value={unitForm.crewText} onChange={(v) => setUnitForm({ ...unitForm, crewText: v })} span={2} placeholder="Yoroblox372, ProviderDemo" />
        <Button kind="primary" icon={Plus} onClick={createUnit}>Add / update unit</Button>
      </div><div className="unit-grid">{units.map((unit) => <article className="unit-card" key={unit.id}><strong>{unit.unitNumber}</strong><span>{unit.label} • {unit.status}</span><small>{unit.agency}</small><em>{(unit.crew || []).join(", ") || "Crew not assigned"}</em></article>)}</div></section>
      <section className="panel cad-panel"><div className="panel-heading"><div><h2>Create CAD call</h2><p>Supervisors can keep this open and generate calls for field crews.</p></div><MapPin size={18} /></div><div className="cad-form">
        <Field label="Location / ERLC postal" value={callForm.location} onChange={(v) => setCallForm({ ...callForm, location: v })} span={2} />
        <Field label="Incident type" value={callForm.incidentType} onChange={(v) => setCallForm({ ...callForm, incidentType: v })} options={INCIDENT_TYPES_NEMSIS} />
        <Field label="Scene type" value={callForm.sceneType} onChange={(v) => setCallForm({ ...callForm, sceneType: v })} options={SCENE_TYPES} />
        <Field label="Priority" value={callForm.priority} onChange={(v) => setCallForm({ ...callForm, priority: v })} options={["1-Emergent", "2-Urgent", "3-Routine"]} />
        <Field label="Units" value={callForm.unitsText} onChange={(v) => setCallForm({ ...callForm, unitsText: v })} placeholder="Medic 12, BLS 3" />
        <Field label="Dispatch notes" value={callForm.dispatchNotes} onChange={(v) => setCallForm({ ...callForm, dispatchNotes: v })} textarea span={2} />
        <Button kind="success" icon={RadioTower} onClick={createCall}>Generate CAD</Button>
      </div></section>
      <section className="panel cad-panel cad-calls"><div className="panel-heading"><div><h2>Active CAD calls</h2><p>Open a new PCR from CAD or copy the CAD number into an existing chart.</p></div></div><div className="call-list">{calls.map((call) => <article className="call-card" key={call.id}><div><strong>{call.cadNumber}</strong><StatusBadge status={call.status || "Draft"} /></div><p>{call.incidentType || "Unspecified"} • {call.location || "Location pending"}</p><small>{call.priority} • {(call.units || []).join(", ") || "No units assigned"} • {formatTime(call.updatedAt || call.createdAt)}</small><div className="row-buttons"><Button icon={FilePlus2} onClick={() => newPcrFromCall(call)}>New PCR from CAD</Button><Button icon={ClipboardList} onClick={() => navigator.clipboard?.writeText(call.cadNumber)}>Copy CAD</Button></div></article>)}</div></section>
    </div>
  </>;
}

function SettingsPage() {
  const [agencies, setAgencies] = useState([]);
  const [name, setName] = useState("");
  const load = useCallback(() => request("/settings/agencies").then(setAgencies), []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!name.trim()) return;
    await request("/settings/agencies", { method: "POST", body: JSON.stringify({ name }) });
    setName("");
    load();
  };
  return <><PageHeader title="Agency settings" description="Configure agencies used by CAD, crew rosters, and user account profiles." actions={<Button kind="primary" icon={Plus} onClick={add}>Add agency</Button>} />
    <section className="panel settings-panel"><div className="panel-heading"><div><h2>Configured agencies</h2><p>Starter NJRP agencies are seeded automatically; admins can add more.</p></div><ShieldCheck size={18} /></div><div className="cad-form settings-form"><Field label="Agency name" value={name} onChange={setName} span={2} placeholder="Agency / department name" /><Button kind="primary" icon={Plus} onClick={add}>Add agency</Button></div><div className="agency-list">{agencies.map((agency) => <div key={agency.id || agency.name}><strong>{agency.name}</strong><span>{agency.active === false || agency.active === 0 ? "Inactive" : "Active"}</span></div>)}</div></section>
  </>;
}

function AccountModal({ user, onClose, onSaved }) {
  const editing = Boolean(user);
  const [agencies, setAgencies] = useState(DEFAULT_AGENCIES);
  const [form, setForm] = useState(user ? { ...user, agencies: user.agencies || [], providerLevel: user.providerLevel || "EMT", password: "" } : { name: "", username: "", role: "Provider", providerLevel: "EMT", agencies: [], password: "", active: 1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { request("/settings/agencies").then((rows) => setAgencies(rows.filter((agency) => agency.active !== false && agency.active !== 0).map((agency) => agency.name))).catch(() => setAgencies(DEFAULT_AGENCIES)); }, []);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleAgency = (agency) => set("agencies", form.agencies?.includes(agency) ? form.agencies.filter((item) => item !== agency) : [...(form.agencies || []), agency]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const saved = await request(editing ? `/users/${user.id}` : "/users", { method: editing ? "PUT" : "POST", body: JSON.stringify(form) });
      onSaved(saved);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal account-modal">
    <div className="modal-heading"><div><span className="small-caps">Administration</span><h2>{editing ? "Edit user account" : "Create user account"}</h2></div><button onClick={onClose}><X /></button></div>
    <div className="modal-body"><div className="form-grid">
      {error ? <div className="alert error span-2">{error}</div> : null}
      <Field label="Full name" value={form.name} onChange={(v) => set("name", v)} />
      <Field label="Roblox username" value={form.username} onChange={(v) => set("username", v)} />
      <Field label="Role" value={form.role} onChange={(v) => set("role", v)} options={["Provider", "Supervisor", "Admin"]} />
      <Field label="Provider level" value={form.providerLevel} onChange={(v) => set("providerLevel", v)} options={PROVIDER_LEVELS} />
      <Field label={editing ? "Reset password (optional)" : "Temporary password"} value={form.password} onChange={(v) => set("password", v)} type="password" placeholder={editing ? "Leave blank to keep current password" : "Minimum 8 characters"} />
      <div className="agency-checklist span-2"><span>Agencies</span>{agencies.map((agency) => <label key={agency}><input type="checkbox" checked={(form.agencies || []).includes(agency)} onChange={() => toggleAgency(agency)} />{agency}</label>)}</div>
      {editing ? <label className="account-toggle span-2"><input type="checkbox" checked={Boolean(form.active)} onChange={(e) => set("active", e.target.checked ? 1 : 0)} /><span><strong>Account active</strong><small>Inactive users cannot sign in.</small></span></label> : null}
    </div></div>
    <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button kind="primary" icon={editing ? Check : UserPlus} onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create account"}</Button></div>
  </div></div>;
}

function UsersPage() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(undefined);
  const [message, setMessage] = useState("");
  const load = useCallback(() => request("/users").then(setItems), []);
  useEffect(() => { load(); }, [load]);
  const saved = async (user) => { setSelected(undefined); setMessage(user.temporaryPassword ? `${user.username} saved. Temporary password: ${user.temporaryPassword}` : `${user.username}'s account was saved.`); await load(); setTimeout(() => setMessage(""), 8000); };
  return <><PageHeader title="User management" description="Create accounts, assign operational roles, reset passwords, and control access." actions={<Button kind="primary" icon={UserPlus} onClick={() => setSelected(null)}>Add user</Button>} />
    {message ? <div className="alert success"><Check size={15} />{message}</div> : null}
    <section className="panel"><div className="panel-heading user-tools"><div><h2>System users</h2><p>{items.filter((user) => user.active).length} active accounts • changes are written to the audit log</p></div><div className="user-legend"><ShieldCheck size={15} />Admin only</div></div><div className="table-wrap"><table className="data-table users-table"><thead><tr><th>User</th><th>Roblox username</th><th>Role</th><th>Level / agencies</th><th>Access</th><th>Actions</th></tr></thead><tbody>{items.map((user) => <tr key={user.id}><td><div className="user-cell"><span className="avatar">{user.name.split(" ").map((n) => n[0]).join("")}</span><strong>{user.name}</strong></div></td><td><strong>{user.username}</strong></td><td><span className="role-badge">{user.role}</span></td><td><strong>{user.providerLevel || "EMT"}</strong><small>{(user.agencies || []).join(", ") || "No agencies set"}</small></td><td><span className={user.active ? "active-status" : "inactive-status"}><span />{user.active ? "Active" : "Inactive"}</span></td><td><div className="row-buttons"><Button icon={Pencil} onClick={() => setSelected(user)}>Edit</Button><Button icon={KeyRound} onClick={() => setSelected(user)}>Reset password</Button></div></td></tr>)}</tbody></table></div></section>
    {selected !== undefined ? <AccountModal user={selected} onClose={() => setSelected(undefined)} onSaved={saved} /> : null}
  </>;
}

function App() {
  const [session, setCurrentSession] = useState(getSession());
  const logout = () => { clearSession(); setCurrentSession(null); window.location.assign("/"); };
  if (!session) return <Login onLogin={setCurrentSession} />;
  return <Shell session={session} onLogout={logout}><Routes>
    <Route path="/" element={<Dashboard session={session} />} />
    <Route path="/reports" element={<Reports />} />
    <Route path="/reports/:id" element={<PcrEditor session={session} />} />
    <Route path="/cad" element={["Supervisor", "Admin"].includes(session.user.role) ? <CadPage /> : <Navigate to="/" />} />
    <Route path="/qa" element={["Supervisor", "Admin"].includes(session.user.role) ? <Reports title="QA review queue" qaOnly /> : <Navigate to="/" />} />
    <Route path="/refusals" element={<Refusals session={session} />} />
    <Route path="/refusals/:id" element={<RefusalEditor session={session} />} />
    <Route path="/search" element={<Reports title="Search reports" />} />
    <Route path="/audit" element={["Supervisor", "Admin"].includes(session.user.role) ? <AuditPage /> : <Navigate to="/" />} />
    <Route path="/users" element={session.user.role === "Admin" ? <UsersPage /> : <Navigate to="/" />} />
    <Route path="/settings" element={session.user.role === "Admin" ? <SettingsPage /> : <Navigate to="/" />} />
    <Route path="*" element={<Navigate to="/" />} />
  </Routes></Shell>;
}

export default App;
