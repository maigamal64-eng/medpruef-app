// ProgressScreen — stats with radar-style + calendar heatmap + line chart
function ProgressScreen() {
  const cells = Array.from({ length: 7 * 18 }, (_, i) => {
    const v = (i * 7 + 13) % 9;
    return v;
  });
  const intensity = (v) => {
    if (v === 0) return "#F7F9FC";
    if (v < 2) return "rgba(0,123,95,.2)";
    if (v < 4) return "rgba(0,123,95,.4)";
    if (v < 6) return "rgba(0,123,95,.7)";
    return "#007B5F";
  };
  return (
    <div style={{ padding: "24px 40px 80px", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--mp-font-display)", fontSize: 28, fontWeight: 800, color: "#1A2B3C", margin: "0 0 4px" }}>Fortschritt</h1>
      <p style={{ fontSize: 13, color: "#A0AEC0", margin: "0 0 24px" }}>Deine Leistung über die letzten 18 Wochen</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatTile label="Genauigkeit" value="82%" tone="#007B5F" icon="target" />
        <StatTile label="Beantwortet" value="3.742" tone="#003A8C" icon="check-circle-2" />
        <StatTile label="XP" value="2.847" tone="#F4A261" icon="zap" />
        <StatTile label="Streak" value="14 Tg" tone="#D64545" icon="flame" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18, marginBottom: 24 }}>
        <Card>
          <h3 style={{ fontFamily: "var(--mp-font-display)", fontSize: 16, fontWeight: 700, color: "#1A2B3C", margin: "0 0 4px" }}>Aktivität</h3>
          <p style={{ fontSize: 12, color: "#A0AEC0", margin: "0 0 16px" }}>Fragen pro Tag, 18 Wochen</p>
          <div style={{ display: "grid", gridTemplateRows: "repeat(7, 14px)", gridAutoFlow: "column", gridAutoColumns: "14px", gap: 3 }}>
            {cells.map((v, i) => <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: intensity(v) }} />)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 10, color: "#A0AEC0" }}>
            <span>Weniger</span>
            {[0, 1, 3, 5, 8].map(v => <div key={v} style={{ width: 12, height: 12, borderRadius: 3, background: intensity(v) }} />)}
            <span>Mehr</span>
          </div>
        </Card>

        <Card>
          <h3 style={{ fontFamily: "var(--mp-font-display)", fontSize: 16, fontWeight: 700, color: "#1A2B3C", margin: "0 0 4px" }}>Stärken</h3>
          <p style={{ fontSize: 12, color: "#A0AEC0", margin: "0 0 14px" }}>Top-Fachgebiete</p>
          {[
            { name: "Notfallmedizin", p: 88, c: "#00A896" },
            { name: "Kardiologie",   p: 82, c: "#007B5F" },
            { name: "Pädiatrie",     p: 77, c: "#007B5F" },
            { name: "HNO",           p: 72, c: "#F4A261" },
            { name: "Augen",         p: 33, c: "#D64545" },
          ].map(t => (
            <div key={t.name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#1A2B3C" }}>{t.name}</span>
                <span style={{ color: t.c, fontFamily: "var(--mp-font-mono)", fontWeight: 600 }}>{t.p}%</span>
              </div>
              <div style={{ height: 5, background: "#F7F9FC", borderRadius: 9999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${t.p}%`, background: t.c, borderRadius: 9999 }} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <h3 style={{ fontFamily: "var(--mp-font-display)", fontSize: 16, fontWeight: 700, color: "#1A2B3C", margin: "0 0 14px" }}>Genauigkeit über Zeit</h3>
        <svg viewBox="0 0 800 200" style={{ width: "100%", height: 180 }}>
          <defs>
            <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#007B5F" stopOpacity="0.3" />
              <stop offset="1" stopColor="#007B5F" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0,1,2,3].map(i => <line key={i} x1="40" x2="780" y1={40 + i*40} y2={40 + i*40} stroke="#F7F9FC" strokeWidth="1" />)}
          <path d="M40 140 L120 125 L200 110 L280 130 L360 90 L440 80 L520 70 L600 55 L680 60 L780 45 L780 180 L40 180 Z" fill="url(#g)" />
          <path d="M40 140 L120 125 L200 110 L280 130 L360 90 L440 80 L520 70 L600 55 L680 60 L780 45" stroke="#007B5F" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {[[40,140],[120,125],[200,110],[280,130],[360,90],[440,80],[520,70],[600,55],[680,60],[780,45]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke="#007B5F" strokeWidth="2" />)}
        </svg>
      </Card>
    </div>
  );
}

function StatTile({ label, value, tone, icon }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: `${tone}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={16} color={tone} />
        </div>
        <span style={{ fontSize: 12, color: "#4A5568", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "var(--mp-font-display)", fontSize: 28, fontWeight: 900, color: "#1A2B3C", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </Card>
  );
}

Object.assign(window, { ProgressScreen });
