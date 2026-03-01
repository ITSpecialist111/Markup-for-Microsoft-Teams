// src/components/AnnotationToolbar.tsx
//
// Drawing-tools toolbar — Fluent-inspired, glassmorphism design.
// Shown only to the Annotator (Organiser / Presenter role).

import { useState } from "react";
import { InkingManager, InkingTool, fromCssColor } from "@microsoft/live-share-canvas";

interface Props {
  inkingManager: InkingManager;
  onSetTool: (tool: InkingTool) => void;
  onSetColor: (hex: string) => void;
  onClear: () => void;
}

// ── SVG icon paths (inline so we don't need extra assets) ──────────────────

const Icon = ({ d, size = 18, stroke = "currentColor", fill = "none" }: {
  d: string; size?: number; stroke?: string; fill?: string;
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS: Record<string, string> = {
  laser:       "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83",
  pen:         "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  arrow:       "M5 12h14 M13 6l6 6-6 6",
  highlighter: "M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z M12 8l4 4",
  eraser:      "M7 21h10 M5.5 13.5L12.5 6.5a2 2 0 0 1 2.83 0l2.17 2.17a2 2 0 0 1 0 2.83L10.5 18.5 2 18.5z",
  clear:       "M3 6h18 M8 6V4h8v2 M5 6l1 14h12l1-14 M10 11v6 M14 11v6",
  arrowOn:     "M5 12h14 M13 6l6 6-6 6",
  arrowOff:    "M5 12h14",
};

const TOOLS: { tool: InkingTool; icon: string; label: string }[] = [
  { tool: InkingTool.laserPointer, icon: "laser",       label: "Laser" },
  { tool: InkingTool.pen,          icon: "pen",         label: "Pen" },
  { tool: InkingTool.line,         icon: "arrow",       label: "Line" },
  { tool: InkingTool.highlighter,  icon: "highlighter", label: "Highlight" },
  { tool: InkingTool.eraser,       icon: "eraser",      label: "Eraser" },
];

const PRESET_COLORS = [
  "#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE", "#FFFFFF",
];

export function AnnotationToolbar({ inkingManager, onSetTool, onSetColor, onClear }: Props) {
  const [activeTool, setActiveTool] = useState<InkingTool>(InkingTool.laserPointer);
  const [activeColor, setActiveColor] = useState<string>("#FF3B30");
  const [arrowEnabled, setArrowEnabled] = useState(true);

  function handleToolClick(tool: InkingTool) {
    setActiveTool(tool);
    onSetTool(tool);
    if (tool === InkingTool.line) {
      inkingManager.lineBrush.endArrow = arrowEnabled ? "open" : "none";
    }
  }

  function handleColorClick(hex: string) {
    setActiveColor(hex);
    onSetColor(hex);
    const color = fromCssColor(hex);
    inkingManager.penBrush.color = color;
    inkingManager.lineBrush.color = color;
    inkingManager.laserPointerBrush.color = color;
    inkingManager.highlighterBrush.color = color;
  }

  function handleToggleArrow() {
    const next = !arrowEnabled;
    setArrowEnabled(next);
    inkingManager.lineBrush.endArrow = next ? "open" : "none";
  }

  return (
    <div style={S.bar}>
      {/* ── Tools ─────────────────────────────────────────────────────── */}
      <div style={S.segment}>
        {TOOLS.map(({ tool, icon, label }) => {
          const active = activeTool === tool;
          return (
            <button
              key={tool}
              title={label}
              onClick={() => handleToolClick(tool)}
              style={{
                ...S.iconBtn,
                ...(active ? S.iconBtnActive : {}),
              }}
            >
              <Icon d={ICONS[icon]} size={18} />
            </button>
          );
        })}
      </div>

      <div style={S.sep} />

      {/* ── Colours ───────────────────────────────────────────────────── */}
      <div style={S.segment}>
        {PRESET_COLORS.map((hex) => (
          <button
            key={hex}
            title={hex}
            onClick={() => handleColorClick(hex)}
            style={{
              ...S.swatch,
              background: hex,
              boxShadow:
                activeColor === hex
                  ? `0 0 0 2px rgba(255,255,255,0.9), 0 0 0 4px ${hex}`
                  : "0 0 0 1px rgba(255,255,255,0.12)",
              transform: activeColor === hex ? "scale(1.2)" : "scale(1)",
            }}
          />
        ))}
        <label style={S.customColorWrap} title="Custom colour">
          <input
            type="color"
            value={activeColor}
            onChange={(e) => handleColorClick(e.target.value)}
            style={S.hiddenColorInput}
          />
          <span style={S.customColorRing}>+</span>
        </label>
      </div>

      <div style={S.sep} />

      {/* ── Arrow toggle ──────────────────────────────────────────────── */}
      <button
        title={arrowEnabled ? "Arrow heads on" : "Arrow heads off"}
        onClick={handleToggleArrow}
        style={{
          ...S.iconBtn,
          opacity: activeTool === InkingTool.line ? 1 : 0.35,
        }}
      >
        <Icon d={ICONS[arrowEnabled ? "arrowOn" : "arrowOff"]} size={16} />
      </button>

      {/* ── Clear strokes ─────────────────────────────────────────────── */}
      <button
        title="Clear all annotations"
        onClick={onClear}
        style={{ ...S.iconBtn, ...S.dangerBtn }}
      >
        <Icon d={ICONS.clear} size={16} />
      </button>
    </div>
  );
}

// ── Design tokens & styles ──────────────────────────────────────────────────

const GLASS = "rgba(24,24,36,0.72)";
const GLASS_BORDER = "rgba(255,255,255,0.08)";
const ACCENT = "rgba(99,102,241,0.85)";    // Indigo-500
const RADIUS = 12;

const S: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: GLASS,
    backdropFilter: "blur(20px) saturate(1.6)",
    WebkitBackdropFilter: "blur(20px) saturate(1.6)",
    borderRadius: RADIUS,
    padding: "6px 10px",
    border: `1px solid ${GLASS_BORDER}`,
    boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
  },
  segment: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  iconBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.82)",
    cursor: "pointer",
    transition: "all 0.15s ease",
    flexShrink: 0,
  },
  iconBtnActive: {
    background: ACCENT,
    color: "#fff",
    boxShadow: `0 0 12px rgba(99,102,241,0.4)`,
  },
  dangerBtn: {
    color: "rgba(255,100,100,0.82)",
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
    flexShrink: 0,
  },
  customColorWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  hiddenColorInput: {
    position: "absolute" as const,
    width: 0,
    height: 0,
    opacity: 0,
    overflow: "hidden",
  },
  customColorRing: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: "50%",
    border: "1.5px dashed rgba(255,255,255,0.3)",
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    lineHeight: 1,
  },
  sep: {
    width: 1,
    height: 24,
    background: "rgba(255,255,255,0.1)",
    margin: "0 4px",
    flexShrink: 0,
  },
};
