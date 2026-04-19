// HomeScreen — recreates the logged-in home page hero banner + stats row + topic grid.
const TOPICS = [
  { name: "Innere Medizin · Kardiologie", icon: "heart-pulse", color: "#D64545", count: 1247, answered: 412, accuracy: 82 },
  { name: "Chirurgie · Allgemein", icon: "scissors", color: "#D64545", count: 876, answered: 221, accuracy: 68 },
  { name: "Neurologie", icon: "brain", color: "#7C3AED", count: 654, answered: 88, accuracy: 45 },
  { name: "Pädiatrie", icon: "baby", color: "#00A896", count: 512, answered: 180, accuracy: 77 },
  { name: "Gynäkologie & Geburtshilfe", icon: "baby", color: "#EC4899", count: 478, answered: 62, accuracy: 55 },
  { name: "HNO", icon: "ear", color: "#F4A261", count: 298, answered: 44, accuracy: 72 },
  { name: "Augenheilkunde", icon: "eye", color: "#3A7CA5", count: 312, answered: 21, accuracy: 33 },
  { name: "Notfallmedizin", icon: "zap", color: "#F4A261", count: 589, answered: 201, accuracy: 88 },
];

function HomeScreen({ onStartQuiz }) {
  return (
    <div style={{ padding: "24px 40px 80px", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A2B3C", margin: 0 }}>Hallo, Aisha</h1>
          <p style={{ fontSize: 13, color: "#A0AEC0", margin: 0 }}>Prüfungsvorbereitung</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ width: 36, height: 36, borderRadius: 10, border: 0, background: "transparent", color: "#A0AEC0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="search" size={18} color="#A0AEC0" />
          </button>
          <button style={{ width: 36, height: 36, borderRadius: 10, border: 0, background: "transparent", color: "#A0AEC0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="sun" size={18} color="#A0AEC0" />
          </button>
          <button style={{ padding: "6px 12px", borderRadius: 10, border: "1px solid #E4E9F0", background: "#fff", color: "#1A2B3C", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>DE · EN</button>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background: "linear-gradient(to right, #001B3D, #003A8C)", borderRadius: 18, padding: 28, color: "#fff", position: "relative", overflow: "hidden", marginBottom: 24 }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.03, backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontFamily: "var(--mp-font-display)", fontSize: 26, fontWeight: 900, margin: "0 0 8px" }}>Du bist 34% näher am Bestehen 🇦🇹</h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.7)", margin: 0 }}>
              Geschätzte Note: <span style={{ color: "#fff", fontWeight: 700 }}>82%</span> · Fortschritt: <span style={{ color: "#fff", fontWeight: 700 }}>34%</span>
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.7)", margin: "4px 0 0" }}>
              Bestehenswahrscheinlichkeit: <span style={{ color: "#fff", fontWeight: 700, fontFamily: "var(--mp-font-display)" }}>76%</span>
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.15)", fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 9999, color: "#fff" }}>
              <Icon name="calendar" size={13} color="#fff" /> Prüfung in 62 Tagen
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.15)", fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 9999, color: "#fff" }}>
              <Icon name="bar-chart-3" size={13} color="#fff" /> Top 28% diese Woche
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(0,168,150,.3)", fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 9999, color: "#fff" }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: "#00A896" }} /> 1.204 lernen jetzt
            </span>
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginBottom: 32 }}>
        <Card>
          <DailyRing current={15} goal={20} />
        </Card>
        <Card>
          <StreakInline streak={14} />
        </Card>
        <Card>
          <XPInline xp={2847} rank="Assistenzarzt" level={4} progress={68} />
        </Card>
      </div>

      {/* Primary CTA */}
      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        <button onClick={onStartQuiz} className="cta-shimmer" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 12, border: 0, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "0 4px 12px rgba(0,123,95,.3)" }}>
          <Icon name="play-circle" size={18} color="#fff" /> Jetzt lernen
        </button>
        <BtnSecondary icon="shuffle">Zufällig üben</BtnSecondary>
        <BtnSecondary icon="clipboard-list">Prüfungssimulation</BtnSecondary>
      </div>

      <h2 style={{ fontFamily: "var(--mp-font-display)", fontSize: 20, fontWeight: 700, color: "#1A2B3C", margin: "0 0 16px" }}>Fachgebiete</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {TOPICS.map((t, i) => <TopicCard key={t.name} {...t} />)}
      </div>
    </div>
  );
}

function DailyRing({ current, goal }) {
  const r = 40, c = 2 * Math.PI * r;
  const p = Math.min(current / goal, 1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", width: 96, height: 96 }}>
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r={r} fill="none" stroke="#F7F9FC" strokeWidth="7" />
          <circle cx="48" cy="48" r={r} fill="none" stroke="#007B5F" strokeWidth="7" strokeDasharray={c} strokeDashoffset={c - p * c} transform="rotate(-90 48 48)" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: "var(--mp-font-mono)", fontSize: 22, fontWeight: 900, color: "#1A2B3C" }}>{current}</span>
          <span style={{ fontSize: 11, color: "#A0AEC0" }}>{Math.round(p * 100)}%</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1A2B3C" }}>Tagesfortschritt</div>
        <div style={{ fontSize: 12, color: "#4A5568" }}>Fragen heute</div>
      </div>
    </div>
  );
}

function StreakInline({ streak }) {
  const days = ["Mo","Di","Mi","Do","Fr","Sa","So"];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>🔥</span>
        <div>
          <div style={{ fontFamily: "var(--mp-font-mono)", fontSize: 26, fontWeight: 900, color: "#D64545", lineHeight: 1 }}>{streak}</div>
          <div style={{ fontSize: 11, color: "#4A5568" }}>Streak · Tage</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, justifyContent: "space-between" }}>
        {days.map((d, i) => {
          const active = i < Math.min(streak, 7);
          const today = i === 5;
          const bg = !active ? "#F7F9FC" : today ? "#007B5F" : "rgba(0,123,95,.5)";
          const fg = active ? "#fff" : "#A0AEC0";
          return (
            <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, border: active ? 0 : "1px solid #E4E9F0" }}>{active ? "✓" : "·"}</div>
              <span style={{ fontSize: 9, color: "#A0AEC0" }}>{d}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function XPInline({ xp, rank, level, progress }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(244,162,97,.1)", border: "1px solid rgba(244,162,97,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⚕️</div>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1A2B3C" }}>{rank}</div>
            <div style={{ fontSize: 11, color: "#4A5568", fontFamily: "var(--mp-font-mono)" }}>Level {level}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--mp-font-display)", fontSize: 22, fontWeight: 900, color: "#F4A261" }}>{xp.toLocaleString("de-DE")}</div>
            <div style={{ fontSize: 11, color: "#A0AEC0" }}>XP</div>
          </div>
        </div>
      </div>
      <div style={{ height: 8, background: "#F7F9FC", borderRadius: 9999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "#F4A261", borderRadius: 9999 }} />
      </div>
      <p style={{ fontSize: 11, color: "#A0AEC0", margin: "6px 0 0", textAlign: "right", fontFamily: "var(--mp-font-mono)" }}>{progress}% bis Level {level + 1}</p>
    </div>
  );
}

function TopicCard({ name, icon, color, count, answered, accuracy }) {
  const ratio = answered / count;
  const tone = accuracy >= 70 ? "#00A896" : accuracy >= 40 ? "#F4A261" : "#D64545";
  const toneBg = accuracy >= 70 ? "rgba(0,168,150,.12)" : accuracy >= 40 ? "rgba(244,162,97,.12)" : "rgba(214,69,69,.12)";
  const toneLabel = accuracy >= 80 ? "Stark" : accuracy >= 40 ? "Schwach" : "Wiederholung";
  return (
    <Card interactive style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <Icon name={icon} size={26} color={color} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontFamily: "var(--mp-font-mono)", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 8, background: toneBg, color: tone }}>{accuracy}%</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 9999, background: tone }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: tone }}>{toneLabel}</span>
          </div>
        </div>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1A2B3C", margin: "0 0 4px", lineHeight: 1.3, minHeight: 36 }}>{name}</h3>
      <p style={{ fontFamily: "var(--mp-font-mono)", fontSize: 11, color: "#A0AEC0", margin: "0 0 4px" }}>{count.toLocaleString("de-DE")} Fragen</p>
      <p style={{ fontFamily: "var(--mp-font-mono)", fontSize: 10, color: "rgba(160,174,192,.7)", margin: "0 0 12px" }}>{answered}/{count} bearbeitet</p>
      <div style={{ height: 6, background: "#F7F9FC", borderRadius: 9999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(ratio * 100, 100)}%`, background: `linear-gradient(to right, ${color}, ${color}60)`, borderRadius: 9999 }} />
      </div>
    </Card>
  );
}

Object.assign(window, { HomeScreen });
