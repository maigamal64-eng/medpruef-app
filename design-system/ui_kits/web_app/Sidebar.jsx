// Sidebar — dark Oxford-Blue nav column, collapsible to 68px.
const SIDEBAR_ITEMS = [
  { key: "home",        icon: "home",           label: "Home" },
  { key: "quiz",        icon: "file-text",      label: "Quiz" },
  { key: "flashcards",  icon: "layers",         label: "Karteikarten" },
  { key: "exam",        icon: "graduation-cap", label: "Prüfung" },
  { key: "stats",       icon: "bar-chart-3",    label: "Statistik" },
  { key: "progress",    icon: "trending-up",    label: "Fortschritt" },
  { key: "curriculum",  icon: "map",            label: "Curriculum" },
  { key: "study-plan",  icon: "calendar-days",  label: "Lernplan" },
  { key: "pricing",     icon: "crown",          label: "Preise" },
];
const SIDEBAR_BOTTOM = [
  { key: "changelog", icon: "sparkles", label: "Neuigkeiten" },
  { key: "settings",  icon: "settings", label: "Einstellungen" },
];

function Sidebar({ active = "home", collapsed, onToggleCollapse, onNavigate, user }) {
  const w = collapsed ? 68 : 260;
  return (
    <aside style={{
      width: w, flexShrink: 0, background: "#001B3D", borderRight: "1px solid rgba(255,255,255,.06)",
      boxShadow: "2px 0 12px rgba(0,27,61,.15)", position: "sticky", top: 0, height: "100vh",
      display: "flex", flexDirection: "column", transition: "width 300ms var(--mp-ease-out)", zIndex: 20,
    }}>
      {/* Logo */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,.06)", padding: collapsed ? "16px 12px 8px" : "20px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: collapsed ? 0 : 12, justifyContent: collapsed ? "center" : "flex-start" }}>
          <LogoMark size={collapsed ? 30 : 32} white />
          {!collapsed && (
            <div>
              <Wordmark />
              <p style={{ fontSize: 10, color: "#A0AEC0", margin: 0, lineHeight: 1.2 }}>Prüfungsvorbereitung</p>
            </div>
          )}
        </div>
      </div>

      {/* User card */}
      {user && !collapsed && (
        <div style={{ margin: "12px 12px 4px", padding: 10, borderRadius: 12, background: "#002952" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9999, background: "#007B5F", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px rgba(0,168,150,.3)" }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</p>
              <p style={{ fontSize: 10, color: "#A0AEC0", margin: 0, fontFamily: "var(--mp-font-mono)" }}>{user.rank} · Lv.{user.level}</p>
            </div>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,.08)", borderRadius: 9999, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${user.progress}%`, background: "#00A896", borderRadius: 9999 }} />
          </div>
          <div style={{ padding: "6px 8px", borderRadius: 8, background: "rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <span style={{ fontSize: 11, color: "#E2E8F0" }}>Kenntnisprüfung Wien</span>
            <Icon name="chevron-down" size={12} color="#A0AEC0" />
          </div>
        </div>
      )}

      {/* Main nav */}
      <nav style={{ padding: collapsed ? "12px 8px 0" : "12px 12px 0" }}>
        {SIDEBAR_ITEMS.map(item => <NavLink key={item.key} {...item} collapsed={collapsed} active={active === item.key} onClick={() => onNavigate?.(item.key)} />)}
      </nav>

      <div style={{ flex: 1 }} />

      <nav style={{ padding: collapsed ? "0 8px 4px" : "0 12px 4px" }}>
        {SIDEBAR_BOTTOM.map(item => <NavLink key={item.key} {...item} collapsed={collapsed} active={active === item.key} onClick={() => onNavigate?.(item.key)} />)}
      </nav>

      {/* Collapse toggle */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", padding: collapsed ? "8px" : "8px 16px" }}>
        <button onClick={onToggleCollapse} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "8px" : "8px 12px", borderRadius: 12, color: "rgba(160,174,192,.6)", background: "transparent", border: 0, cursor: "pointer", fontSize: 12 }}>
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={16} color="rgba(160,174,192,.7)" />
          {!collapsed && <span>Einklappen</span>}
        </button>
      </div>
    </aside>
  );
}

function NavLink({ icon, label, collapsed, active, onClick }) {
  const base = collapsed
    ? { display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, margin: "0 auto 2px", borderRadius: 10, cursor: "pointer", transition: "all 150ms" }
    : { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "0 12px 12px 0", marginBottom: 1, cursor: "pointer", transition: "all 150ms" };
  const activeStyle = active
    ? { background: "rgba(0,123,95,.2)", color: "#00A896", fontWeight: 600, borderLeft: collapsed ? undefined : "3px solid #00A896" }
    : { color: "#A0AEC0" };
  return (
    <div onClick={onClick} style={{ ...base, ...activeStyle }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,.05)"; e.currentTarget.style.color = "#fff"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#A0AEC0"; } }}>
      <Icon name={icon} size={18} color={active ? "#00A896" : "#A0AEC0"} />
      {!collapsed && <span style={{ fontSize: 13 }}>{label}</span>}
    </div>
  );
}

Object.assign(window, { Sidebar });
