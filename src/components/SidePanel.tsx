// src/components/SidePanel.tsx
//
// The side panel is the narrow view shown when users click the app icon
// in the meeting controls. It's used to:
//   1. Show a "Share to Stage" button so participants open the full canvas
//   2. Show a compact tool switcher for annotators
//   3. Show a "Capture My Screen" shortcut for the presenter

import { useState } from "react";
import { meeting } from "@microsoft/teams-js";

/* ── Design tokens (shared language with toolbar components) ─────────── */
const GLASS = "rgba(24,24,36,0.72)";
const ACCENT = "rgba(99,102,241,0.85)";
const ACCENT_SOLID = "#6366f1";
const BORDER = "rgba(255,255,255,0.08)";
const RADIUS = 14;
const BLUR = "blur(20px)";

/* ── SVG icon helper ─────────────────────────────────────────────────── */
function Icon({ d, size = 18, stroke = "currentColor", fill = "none" }: {
  d: string; size?: number; stroke?: string; fill?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function SidePanel() {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  async function shareToStage() {
    try {
      await meeting.shareAppContentToStage((error, result) => {
        if (error) {
          setError(`Could not share to stage: ${error.message}`);
          return;
        }
        setIsSharing(true);
      }, `${window.location.origin}/?view=stage&inTeams=1`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const steps = [
    { icon: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7", text: "Open the annotation canvas using the button above" },
    { icon: "M2 3h20v14H2z M8 21h8 M12 17v4", text: <>Tap <strong>Share Screen</strong> to capture your display</> },
    { icon: "M12 5v14 M5 12h14", text: "A helper window opens — choose what to share" },
    { icon: "M5 3l14 9-14 9V3z", text: <><strong>Go Live</strong> for continuous updates, or capture once</> },
    { icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75", text: "Everyone sees shared content with real-time annotations" },
  ];

  return (
    <div style={S.root}>
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div style={S.hero}>
        <div style={S.logoRing}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.9)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9 M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
        <h1 style={S.title}>MarkUp</h1>
        <p style={S.subtitle}>Annotate over shared content in real time</p>
      </div>

      {/* ── Share to stage CTA ───────────────────────────────────────── */}
      <div style={S.ctaCard}>
        <button
          style={{
            ...S.primaryBtn,
            ...(isSharing ? S.primaryBtnDone : {}),
          }}
          onClick={shareToStage}
          disabled={isSharing}
        >
          {isSharing ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Shared to stage</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7" />
              </svg>
              <span>Open Annotation Canvas</span>
            </>
          )}
        </button>
        <p style={S.hint}>Opens the canvas for everyone in the meeting</p>
      </div>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <div style={S.howSection}>
        <h3 style={S.sectionLabel}>How it works</h3>
        <div style={S.stepsContainer}>
          {steps.map((step, i) => (
            <div
              key={i}
              style={{
                ...S.stepRow,
                ...(hoveredStep === i ? S.stepRowHover : {}),
              }}
              onMouseEnter={() => setHoveredStep(i)}
              onMouseLeave={() => setHoveredStep(null)}
            >
              <div style={S.stepIcon}>
                <Icon d={step.icon} size={15} stroke="rgba(165,168,255,0.8)" />
              </div>
              <span style={S.stepText}>{step.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Role info pill ───────────────────────────────────────────── */}
      <div style={S.rolePill}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="rgba(165,168,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>Only Organisers and Presenters can draw. Attendees are view-only.</span>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {/* ── Footer credit ────────────────────────────────────────────── */}
      <div style={S.footer}>Created by Graham Hosking</div>
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────── */
const S: Record<string, React.CSSProperties> = {
  root: {
    padding: "24px 18px 18px",
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    color: "#fff",
    background: "linear-gradient(170deg, #12121e 0%, #1a1a2e 50%, #16162a 100%)",
    minHeight: "100vh",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 22,
  },

  /* ── Hero ──────────────────────────────────────────────────────────── */
  hero: {
    textAlign: "center",
    paddingTop: 12,
  },
  logoRing: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 56,
    borderRadius: 16,
    background: `linear-gradient(135deg, ${ACCENT_SOLID}, #818cf8)`,
    boxShadow: "0 4px 24px rgba(99,102,241,0.35)",
    marginBottom: 14,
  },
  title: {
    margin: "0 0 4px",
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: -0.5,
    background: "linear-gradient(135deg, #fff 30%, rgba(165,168,255,0.8))",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    fontWeight: 400,
    letterSpacing: 0.2,
  },

  /* ── CTA card ─────────────────────────────────────────────────────── */
  ctaCard: {
    background: GLASS,
    backdropFilter: BLUR,
    WebkitBackdropFilter: BLUR,
    border: `1px solid ${BORDER}`,
    borderRadius: RADIUS,
    padding: "16px",
  },
  primaryBtn: {
    width: "100%",
    padding: "13px 18px",
    borderRadius: 11,
    border: "none",
    background: `linear-gradient(135deg, ${ACCENT_SOLID}, #818cf8)`,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "transform 0.12s, box-shadow 0.12s",
    boxShadow: "0 2px 16px rgba(99,102,241,0.3)",
    letterSpacing: 0.2,
  },
  primaryBtnDone: {
    background: "rgba(52,199,89,0.2)",
    border: "1px solid rgba(52,199,89,0.3)",
    boxShadow: "none",
    color: "rgba(52,199,89,0.9)",
    cursor: "default",
  },
  hint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
    marginTop: 8,
    marginBottom: 0,
    textAlign: "center",
  },

  /* ── How it works ─────────────────────────────────────────────────── */
  howSection: {},
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.35)",
    letterSpacing: 1.5,
    fontWeight: 600,
    marginTop: 0,
    marginBottom: 10,
  },
  stepsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  stepRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 10,
    transition: "background 0.15s",
  },
  stepRowHover: {
    background: "rgba(255,255,255,0.04)",
  },
  stepIcon: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 8,
    background: "rgba(99,102,241,0.12)",
    border: "1px solid rgba(99,102,241,0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepText: {
    fontSize: 13,
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.72)",
  },

  /* ── Role pill ────────────────────────────────────────────────────── */
  rolePill: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.15)",
    borderRadius: 12,
    padding: "11px 14px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.55)",
  },

  /* ── Error ─────────────────────────────────────────────────────────── */
  error: {
    padding: "10px 14px",
    background: "rgba(255,80,80,0.1)",
    border: "1px solid rgba(255,80,80,0.18)",
    borderRadius: 12,
    color: "rgba(255,130,130,0.9)",
    fontSize: 12,
    lineHeight: 1.5,
  },

  /* ── Footer ────────────────────────────────────────────────────────── */
  footer: {
    marginTop: "auto",
    textAlign: "center",
    fontSize: 11,
    color: "rgba(255,255,255,0.38)",
    letterSpacing: 0.3,
    paddingTop: 16,
    paddingBottom: 8,
    fontWeight: 400,
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
};
