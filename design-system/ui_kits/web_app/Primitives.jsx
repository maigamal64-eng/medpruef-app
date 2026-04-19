// Shared primitives for the MedPrüf web app UI kit
// Lucide icons via window.lucide (UMD); all colors/tokens match globals.css.

const { useState, useEffect } = React;

// ─── Icon helper ─────────────────────────────────────────────
function Icon({ name, size = 18, color, className = "", style }) {
  const ref = React.useRef(null);
  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const svg = window.lucide.createElement(window.lucide.icons[toPascal(name)]);
      if (svg) {
        svg.setAttribute("width", size);
        svg.setAttribute("height", size);
        svg.setAttribute("stroke-width", "2");
        ref.current.appendChild(svg);
      }
    }
  }, [name, size]);
  return <span ref={ref} className={className} style={{ display: "inline-flex", color, ...style }} />;
}
function toPascal(kebab) {
  return kebab.split("-").map(s => s[0].toUpperCase() + s.slice(1)).join("");
}

// ─── Logo ────────────────────────────────────────────────────
function LogoMark({ size = 32, white = false }) {
  return (
    <img
      src="../../assets/logomark.svg"
      alt="MedPrüf"
      width={size}
      height={size}
      style={{ filter: white ? "brightness(0) invert(1)" : undefined, flexShrink: 0 }}
    />
  );
}
function Wordmark() {
  return (
    <h1 style={{ fontFamily: "var(--mp-font-display)", fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", margin: 0 }}>
      <span>Med</span><span style={{ color: "#00A896" }}>Prüf</span>
    </h1>
  );
}

// ─── Buttons ─────────────────────────────────────────────────
function BtnPrimary({ children, onClick, icon, full }) {
  return (
    <button onClick={onClick} className="btn-primary" style={{ width: full ? "100%" : undefined }}>
      {icon && <Icon name={icon} size={16} color="#fff" />}
      {children}
    </button>
  );
}
function BtnSecondary({ children, onClick, icon }) {
  return (
    <button onClick={onClick} className="btn-secondary">
      {icon && <Icon name={icon} size={16} color="#1A2B3C" />}
      {children}
    </button>
  );
}
function BtnSuccess({ children, onClick, icon }) {
  return (
    <button onClick={onClick} className="btn-success">
      {icon && <Icon name={icon} size={16} color="#fff" />}
      {children}
    </button>
  );
}

// ─── Badge ───────────────────────────────────────────────────
function Badge({ tone = "neutral", children, icon }) {
  const tones = {
    correct: { bg: "rgba(0,168,150,.12)", fg: "#00A896" },
    wrong:   { bg: "rgba(214,69,69,.12)",  fg: "#D64545" },
    review:  { bg: "rgba(244,162,97,.12)", fg: "#F4A261" },
    info:    { bg: "rgba(58,124,165,.12)", fg: "#3A7CA5" },
    pro:     { bg: "rgba(0,123,95,.1)",    fg: "#007B5F" },
    dark:    { bg: "#001B3D",              fg: "#fff"    },
    neutral: { bg: "#fff",                 fg: "#1A2B3C", border: "1px solid #E4E9F0" },
  };
  const t = tones[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: t.bg, color: t.fg, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 9999, border: t.border }}>
      {icon && <Icon name={icon} size={12} color={t.fg} />}
      {children}
    </span>
  );
}

// ─── Card ────────────────────────────────────────────────────
function Card({ children, interactive, style, onClick }) {
  return (
    <div
      onClick={onClick}
      className={interactive ? "card-interactive" : "card"}
      style={{ borderRadius: 14, padding: 20, ...style }}
    >
      {children}
    </div>
  );
}

Object.assign(window, { Icon, LogoMark, Wordmark, BtnPrimary, BtnSecondary, BtnSuccess, Badge, Card });
