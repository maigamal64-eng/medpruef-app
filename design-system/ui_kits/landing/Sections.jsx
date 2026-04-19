// Features + Subjects + Pricing + Footer
function Features() {
  const features = [
    { icon: "brain",           color: "#007B5F", title: "KI-Erklärungen",          desc: "Pro-Tarif: kontextbezogene Erklärungen mit ERC-2021-, ESC- und ÖDG-Quellen." },
    { icon: "repeat-2",        color: "#003A8C", title: "Spaced Repetition",       desc: "Algorithmus, der deine Schwächen erkennt und sie in das richtige Intervall legt." },
    { icon: "clipboard-list",  color: "#D64545", title: "Prüfungssimulation",      desc: "Identische Struktur zu SIP 4 und SIP 5 — mit Zeitdruck und Ergebnisauswertung." },
    { icon: "calendar-days",   color: "#F4A261", title: "Personalisierter Lernplan", desc: "Plant deine Wochen bis zum Prüfungstermin anhand aktueller Schwachstellen." },
    { icon: "languages",       color: "#00A896", title: "7 Sprachen",              desc: "DE primär · EN · RU · AR · FR · TR · UK · SR. Arabisch mit RTL-Layout." },
    { icon: "shield-check",    color: "#3A7CA5", title: "Datenschutz",             desc: "DSGVO-konform, österreichisches Hosting, keine Drittanbieter-Tracker." },
  ];
  return (
    <section style={{ padding: "96px 32px", background: "#fff" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <span style={{ fontFamily: "var(--mp-font-mono)", fontSize: 11, fontWeight: 600, color: "#007B5F", textTransform: "uppercase", letterSpacing: "0.1em" }}>Funktionen</span>
          <h2 style={{ fontFamily: "var(--mp-font-display)", fontSize: 42, fontWeight: 800, color: "#001B3D", margin: "10px 0 12px", letterSpacing: "-0.02em" }}>Was MedPrüf anders macht</h2>
          <p style={{ fontSize: 16, color: "#4A5568", maxWidth: 620, margin: "0 auto", lineHeight: 1.55 }}>
            Die österreichische Kenntnisprüfung entscheidet über deine Approbation in Wien. Jede SIP-4- und SIP-5-Frage seit 2016 — katalogisiert, korrigiert, erklärt.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {features.map(f => (
            <div key={f.title} className="card-interactive" style={{ padding: 28 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `${f.color}15`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Icon name={f.icon} size={22} color={f.color} />
              </div>
              <h3 style={{ fontFamily: "var(--mp-font-display)", fontSize: 18, fontWeight: 700, color: "#001B3D", margin: "0 0 8px" }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: "#4A5568", lineHeight: 1.55, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Subjects() {
  const subjects = [
    { icon: "heart-pulse", name: "Kardiologie", c: "#D64545", q: 1247 },
    { icon: "brain",       name: "Neurologie",  c: "#7C3AED", q: 654  },
    { icon: "scissors",    name: "Chirurgie",   c: "#001B3D", q: 876  },
    { icon: "baby",        name: "Pädiatrie",   c: "#00A896", q: 512  },
    { icon: "stethoscope", name: "Innere Med.", c: "#003A8C", q: 1564 },
    { icon: "ear",         name: "HNO",         c: "#F4A261", q: 298  },
    { icon: "eye",         name: "Augen",       c: "#3A7CA5", q: 312  },
    { icon: "pill",        name: "Pharma",      c: "#007B5F", q: 335  },
  ];
  return (
    <section style={{ padding: "96px 32px", background: "#F7F9FC" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <span style={{ fontFamily: "var(--mp-font-mono)", fontSize: 11, fontWeight: 600, color: "#007B5F", textTransform: "uppercase", letterSpacing: "0.1em" }}>Fachgebiete</span>
          <h2 style={{ fontFamily: "var(--mp-font-display)", fontSize: 42, fontWeight: 800, color: "#001B3D", margin: "10px 0 12px", letterSpacing: "-0.02em" }}>Alle prüfungsrelevanten Fächer</h2>
          <p style={{ fontSize: 16, color: "#4A5568", maxWidth: 620, margin: "0 auto" }}>
            7.567 Fragen aus SIP 4 + SIP 5 · 3.091 aus KMP Innsbruck · 335 aus Pharmakologie
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {subjects.map(s => (
            <div key={s.name} className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: `${s.c}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={s.icon} size={22} color={s.c} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#001B3D" }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "#4A5568", fontFamily: "var(--mp-font-mono)" }}>{s.q.toLocaleString("de-DE")} Fragen</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section style={{ padding: "96px 32px", background: "#fff" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <span style={{ fontFamily: "var(--mp-font-mono)", fontSize: 11, fontWeight: 600, color: "#007B5F", textTransform: "uppercase", letterSpacing: "0.1em" }}>Preise</span>
          <h2 style={{ fontFamily: "var(--mp-font-display)", fontSize: 42, fontWeight: 800, color: "#001B3D", margin: "10px 0 12px", letterSpacing: "-0.02em" }}>Einfach und fair</h2>
          <p style={{ fontSize: 16, color: "#4A5568" }}>Starte kostenlos. Jederzeit kündbar.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          <PriceCard
            name="Free"
            price="€0"
            tagline="Um loszulegen"
            features={["500 Fragen freigeschaltet", "Grundlegende Statistiken", "Keine Kreditkarte"]}
            cta="Kostenlos starten"
          />
          <PriceCard
            featured
            name="Pro"
            price="€19"
            period="/ Monat"
            tagline="Vollzugriff für ernsthafte Vorbereitung"
            features={[
              "Alle 10.993 Fragen freigeschaltet",
              "KI-Erklärungen mit Leitlinien",
              "Spaced Repetition & Lernplan",
              "Prüfungssimulation SIP 4 + 5",
              "Alle 7 Sprachen",
            ]}
            cta="Pro starten"
            badge="Empfohlen"
          />
          <PriceCard
            name="Group"
            price="Individuell"
            tagline="Für Kliniken und Vereine"
            features={["Ab 5 Lizenzen", "Admin-Dashboard", "Rechnung"]}
            cta="Anfragen"
            muted
            comingSoon
          />
        </div>
      </div>
    </section>
  );
}

function PriceCard({ name, price, period, tagline, features, cta, featured, muted, badge, comingSoon }) {
  return (
    <div style={{
      background: featured ? "#001B3D" : "#fff",
      color: featured ? "#fff" : "#1A2B3C",
      borderRadius: 18,
      border: featured ? 0 : "1px solid #E4E9F0",
      boxShadow: featured ? "0 20px 40px rgba(0,27,61,.25)" : "0 1px 3px rgba(0,27,61,.05)",
      padding: 30, position: "relative",
      transform: featured ? "translateY(-8px)" : undefined,
    }}>
      {badge && (
        <span style={{ position: "absolute", top: -12, left: 24, padding: "4px 12px", background: "#00A896", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 9999 }}>{badge}</span>
      )}
      {comingSoon && (
        <span style={{ position: "absolute", top: 20, right: 20, padding: "3px 10px", background: "#F7F9FC", color: "#A0AEC0", fontSize: 10, fontWeight: 600, borderRadius: 9999 }}>BALD</span>
      )}
      <h3 style={{ fontFamily: "var(--mp-font-display)", fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: featured ? "#fff" : "#001B3D" }}>{name}</h3>
      <p style={{ fontSize: 13, color: featured ? "rgba(255,255,255,.7)" : "#4A5568", margin: "0 0 20px" }}>{tagline}</p>
      <div style={{ marginBottom: 24 }}>
        <span style={{ fontFamily: "var(--mp-font-display)", fontSize: 44, fontWeight: 900, letterSpacing: "-0.02em", color: featured ? "#fff" : "#001B3D" }}>{price}</span>
        {period && <span style={{ fontSize: 13, color: featured ? "rgba(255,255,255,.6)" : "#A0AEC0", marginLeft: 4 }}>{period}</span>}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px" }}>
        {features.map(f => (
          <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, fontSize: 13, lineHeight: 1.5, color: featured ? "rgba(255,255,255,.9)" : "#1A2B3C" }}>
            <Icon name="check" size={16} color={featured ? "#00A896" : "#007B5F"} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button style={{
        width: "100%", padding: "12px", borderRadius: 12, border: 0, cursor: muted ? "not-allowed" : "pointer",
        background: featured ? "#00A896" : muted ? "#F7F9FC" : "#001B3D",
        color: muted ? "#A0AEC0" : "#fff",
        fontWeight: 600, fontSize: 14,
      }}>{cta}</button>
    </div>
  );
}

function Footer() {
  return (
    <footer style={{ background: "#001B3D", color: "#fff", padding: "64px 32px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(3, 1fr)", gap: 48, marginBottom: 40 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <LogoMark size={32} white />
              <span style={{ fontFamily: "var(--mp-font-display)", fontSize: 18, fontWeight: 800 }}>
                Med<span style={{ color: "#00A896" }}>Prüf</span>
              </span>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.6)", lineHeight: 1.55, maxWidth: 320, margin: 0 }}>
              Vorbereitung auf die Wiener Kenntnisprüfung — gebaut von und für ausländische Ärzt:innen.
            </p>
          </div>
          {[
            { h: "Produkt",     l: ["Quiz", "Lernplan", "Prüfungssimulation", "Statistiken"] },
            { h: "Unternehmen", l: ["Über uns", "Blog", "Kontakt", "Impressum"] },
            { h: "Recht",       l: ["Datenschutz", "AGB", "DSGVO", "Cookie-Einstellungen"] },
          ].map(col => (
            <div key={col.h}>
              <h4 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#A0AEC0" }}>{col.h}</h4>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {col.l.map(i => <li key={i} style={{ marginBottom: 10 }}><a href="#" style={{ fontSize: 13, color: "rgba(255,255,255,.8)", textDecoration: "none" }}>{i}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "rgba(255,255,255,.6)" }}>
          <span>© 2026 MedPrüf GmbH · Wien, Österreich</span>
          <span style={{ fontFamily: "var(--mp-font-mono)" }}>🇦🇹 Made in Austria</span>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { Features, Subjects, Pricing, Footer });
