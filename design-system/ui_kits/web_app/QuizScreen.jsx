// QuizScreen — core question-answering surface
function QuizScreen({ onExit }) {
  const [selected, setSelected] = useState(1);
  const [submitted, setSubmitted] = useState(true);
  const options = [
    { label: "Nifedipin sublingual", correct: false },
    { label: "Glyceroltrinitrat i.v. + Furosemid i.v.", correct: true },
    { label: "Metoprolol p.o.", correct: false },
    { label: "Captopril sublingual", correct: false },
  ];
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 32px 80px" }}>
      {/* Top meta bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <button onClick={onExit} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: 0, color: "#A0AEC0", fontSize: 13, cursor: "pointer" }}>
          <Icon name="arrow-left" size={14} color="#A0AEC0" /> Zurück
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--mp-font-mono)", fontSize: 12, color: "#4A5568" }}>
          <span>14 / 60</span>
          <span style={{ color: "#00A896" }}>✓ 11</span>
          <span style={{ color: "#D64545" }}>✕ 3</span>
          <span>04:23</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: "#E4E9F0", borderRadius: 9999, overflow: "hidden", marginBottom: 24 }}>
        <div style={{ height: "100%", width: "23%", background: "linear-gradient(to right, #007B5F, #00A896)" }} />
      </div>

      {/* Question card */}
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Icon name="heart-pulse" size={20} color="#D64545" />
          <span style={{ fontSize: 12, color: "#A0AEC0", fontFamily: "var(--mp-font-mono)" }}>Innere Medizin · Kardiologie</span>
          <Badge tone="review" icon="alert-triangle">Wiederholung</Badge>
        </div>
        <h2 style={{ fontSize: 18, color: "#1A2B3C", fontWeight: 500, lineHeight: 1.5, margin: "0 0 20px" }}>
          Welches Medikament ist bei einer hypertensiven Krise mit akuter Linksherzinsuffizienz und Lungenödem primär indiziert?
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {options.map((o, i) => {
            const isSelected = i === selected;
            const show = submitted;
            let bg = "#fff", bd = "1px solid #E4E9F0", fg = "#1A2B3C", suffix = null;
            if (show) {
              if (o.correct)       { bg = "rgba(0,168,150,.12)"; bd = "2px solid #00A896"; fg = "#007B5F"; suffix = <Icon name="check-circle-2" size={18} color="#00A896" />; }
              else if (isSelected) { bg = "rgba(214,69,69,.12)"; bd = "2px solid #D64545"; fg = "#D64545"; suffix = <Icon name="x" size={18} color="#D64545" />; }
            } else if (isSelected) { bd = "2px solid #00A896"; bg = "rgba(0,168,150,.05)"; }
            return (
              <div key={i} onClick={() => !submitted && setSelected(i)} style={{ padding: "12px 16px", borderRadius: 12, background: bg, border: bd, color: fg, fontSize: 14, fontWeight: o.correct && show ? 600 : 500, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: submitted ? "default" : "pointer" }}>
                <span>{String.fromCharCode(65 + i)} · {o.label}</span>
                {suffix}
              </div>
            );
          })}
        </div>

        {/* Feedback strip */}
        {submitted && (
          <div style={{ marginTop: 18, padding: "10px 14px", borderRadius: 10, background: "rgba(0,168,150,.1)", border: "1px solid rgba(0,168,150,.3)", display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="check-circle-2" size={18} color="#00A896" />
            <span style={{ color: "#007B5F", fontWeight: 600, fontSize: 13 }}>+10 XP · Richtig!</span>
            <span style={{ color: "#4A5568", fontSize: 12, marginLeft: "auto", fontFamily: "var(--mp-font-mono)" }}>Streak: 11</span>
          </div>
        )}

        {/* Explanation */}
        {submitted && (
          <div style={{ marginTop: 18, padding: 16, borderRadius: 12, background: "#F7F9FC", borderLeft: "3px solid #00A896" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Icon name="lightbulb" size={15} color="#F4A261" />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#4A5568", textTransform: "uppercase", letterSpacing: "0.06em" }}>Erklärung</span>
            </div>
            <p style={{ fontSize: 14, color: "#1A2B3C", lineHeight: 1.55, margin: 0 }}>
              Bei hypertensiver Krise mit akuter Linksherzinsuffizienz ist Glyceroltrinitrat (GTN) i.v. Mittel der ersten Wahl — es senkt Vor- und Nachlast rasch. Schleifendiuretika (Furosemid) ergänzen bei Lungenödem. Nach ESC-Leitlinien 2023 zur akuten Herzinsuffizienz.
            </p>
          </div>
        )}
      </Card>

      {/* Action rail */}
      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <IconBtn name="star" label="Favorit" />
        <IconBtn name="flag" label="Melden" />
        <IconBtn name="bot" label="KI-Chat" />
        <IconBtn name="highlighter" label="Markieren" />
        {submitted
          ? <BtnPrimary icon="arrow-right" onClick={() => {}}>Nächste Frage</BtnPrimary>
          : <BtnPrimary icon="check" onClick={() => setSubmitted(true)}>Antwort prüfen</BtnPrimary>}
      </div>
    </div>
  );
}

function IconBtn({ name, label }) {
  return (
    <button title={label} style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid #E4E9F0", background: "#fff", color: "#4A5568", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={16} color="#4A5568" />
    </button>
  );
}

Object.assign(window, { QuizScreen });
