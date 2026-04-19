// Landing site — Nav + Hero
const { useState: useStateL } = React;

function LandingNav() {
  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(228,233,240,.5)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="../../assets/logomark.svg" alt="MedPrüf" width="30" height="30" style={{ filter: "none" }} />
          <span style={{ fontFamily: "var(--mp-font-display)", fontSize: 18, fontWeight: 800, color: "#001B3D", letterSpacing: "-0.01em" }}>
            Med<span style={{ color: "#007B5F" }}>Prüf</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {["Features", "Fächer", "Preise", "Über uns"].map(l => (
            <a key={l} href="#" style={{ fontSize: 13, color: "#4A5568", textDecoration: "none", fontWeight: 500 }}>{l}</a>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E4E9F0", background: "#fff", fontSize: 12, fontWeight: 500, color: "#4A5568", cursor: "pointer" }}>DE · EN</button>
          <a href="#" style={{ fontSize: 13, color: "#1A2B3C", textDecoration: "none", fontWeight: 500 }}>Anmelden</a>
          <BtnPrimary icon="arrow-right">Kostenlos starten</BtnPrimary>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section style={{ background: "#F7F9FC", position: "relative", overflow: "hidden", padding: "96px 32px 80px" }}>
      {/* Subtle dot grid */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.4, backgroundImage: "radial-gradient(circle at 2px 2px, #E4E9F0 1px, transparent 0)", backgroundSize: "28px 28px", pointerEvents: "none" }} />
      {/* Soft glow blob */}
      <div style={{ position: "absolute", top: "-20%", right: "-10%", width: 600, height: 600, background: "radial-gradient(circle, rgba(0,168,150,.12), transparent 70%)", pointerEvents: "none" }} />

      <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 56, alignItems: "center" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 9999, background: "#fff", border: "1px solid #E4E9F0", boxShadow: "0 1px 2px rgba(0,27,61,.03)" }}>
            <span style={{ width: 18, height: 12, borderRadius: 2, background: "linear-gradient(to bottom, #ED2939 33%, #fff 33%, #fff 66%, #ED2939 66%)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#1A2B3C" }}>Wien · Kenntnisprüfung</span>
            <span style={{ padding: "2px 8px", borderRadius: 9999, background: "rgba(0,123,95,.12)", color: "#007B5F", fontSize: 10, fontWeight: 700 }}>NEU</span>
          </div>

          <h1 style={{ fontFamily: "var(--mp-font-display)", fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.025em", color: "#001B3D", margin: "22px 0 18px" }}>
            Bereit für die<br />
            <span style={{ background: "linear-gradient(90deg, #007B5F, #00A896)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Kenntnisprüfung.</span>
          </h1>

          <p style={{ fontSize: 17, lineHeight: 1.6, color: "#4A5568", maxWidth: 560, margin: "0 0 28px" }}>
            10.993 echte Klinikfragen aus Kenntnisprüfung Wien (SIP 4 + SIP 5), KMP Innsbruck und Pharmakologie — strukturiert wie die echten Prüfungen. Auf Deutsch oder Englisch lernen, KI-Erklärungen freischalten, mit Spaced Repetition trainieren.
          </p>

          <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
            <button className="cta-shimmer-landing" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 12, border: 0, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 20px rgba(0,123,95,.3)" }}>
              <Icon name="play-circle" size={18} color="#fff" /> Kostenlos starten
            </button>
            <BtnSecondary icon="play">Demo ansehen</BtnSecondary>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 12, color: "#4A5568" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="check" size={14} color="#007B5F" /> Keine Kreditkarte</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="check" size={14} color="#007B5F" /> 7 Sprachen</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="check" size={14} color="#007B5F" /> DSGVO-konform</span>
          </div>
        </div>

        {/* Product mockup */}
        <HeroMockup />
      </div>

      {/* Stat strip */}
      <div style={{ maxWidth: 1200, margin: "72px auto 0", position: "relative", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderTop: "1px solid #E4E9F0", borderBottom: "1px solid #E4E9F0", background: "#fff" }}>
        {[
          { v: "10.993", l: "Klinikfragen" },
          { v: "7.567",  l: "SIP 4 + SIP 5 seit 2016" },
          { v: "7",      l: "Sprachen" },
          { v: "82%",    l: "Ø Bestehenswahrscheinlichkeit" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "24px 28px", borderRight: i < 3 ? "1px solid #E4E9F0" : 0 }}>
            <div style={{ fontFamily: "var(--mp-font-display)", fontSize: 32, fontWeight: 800, color: "#001B3D", lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontSize: 12, color: "#4A5568", marginTop: 6, fontFamily: "var(--mp-font-mono)" }}>{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", inset: "-20px -20px -20px -20px", background: "linear-gradient(135deg, rgba(0,58,140,.08), rgba(0,168,150,.08))", borderRadius: 28, filter: "blur(24px)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 18, border: "1px solid #E4E9F0", boxShadow: "0 24px 60px rgba(0,27,61,.15), 0 2px 4px rgba(0,27,61,.04)", padding: 22, transform: "rotate(0.5deg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Icon name="heart-pulse" size={18} color="#D64545" />
          <span style={{ fontSize: 11, color: "#A0AEC0", fontFamily: "var(--mp-font-mono)" }}>Innere Medizin · Kardiologie</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#A0AEC0", fontFamily: "var(--mp-font-mono)" }}>14 / 60</span>
        </div>
        <p style={{ fontSize: 14, color: "#1A2B3C", lineHeight: 1.5, margin: "0 0 16px", fontWeight: 500 }}>
          Welches Medikament ist bei einer hypertensiven Krise mit akuter Linksherzinsuffizienz und Lungenödem primär indiziert?
        </p>
        {[
          { l: "A · Nifedipin sublingual", state: "idle" },
          { l: "B · Glyceroltrinitrat i.v. + Furosemid i.v.", state: "correct" },
          { l: "C · Metoprolol p.o.", state: "idle" },
          { l: "D · Captopril sublingual", state: "wrong" },
        ].map((o, i) => {
          const styles = {
            idle:    { bg: "#fff",                border: "1px solid #E4E9F0",     color: "#1A2B3C" },
            correct: { bg: "rgba(0,168,150,.12)", border: "2px solid #00A896",     color: "#007B5F", fontWeight: 600 },
            wrong:   { bg: "rgba(214,69,69,.08)", border: "1px solid #D64545",     color: "#D64545" },
          }[o.state];
          return (
            <div key={i} style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 6, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", ...styles }}>
              <span>{o.l}</span>
              {o.state === "correct" && <Icon name="check-circle-2" size={14} color="#00A896" />}
              {o.state === "wrong" && <Icon name="x" size={14} color="#D64545" />}
            </div>
          );
        })}
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(0,168,150,.08)", borderLeft: "3px solid #00A896", fontSize: 11, color: "#1A2B3C", lineHeight: 1.45 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Icon name="lightbulb" size={11} color="#F4A261" />
            <span style={{ fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "#4A5568" }}>ESC-Leitlinien 2023</span>
          </div>
          GTN senkt Vor- und Nachlast rasch. Furosemid bei Lungenödem.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LandingNav, Hero });
