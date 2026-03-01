// src/components/MeetingStage.tsx
//
// This is what appears in the meeting stage (full-screen shared view).
// - Everyone sees the background image (presenter's screenshot) + annotations
// - Only annotators (Organiser / Presenter role) can draw
// - Attendees see a live view but their drawing tools are hidden/disabled
//
// Power-user features:
//   - Breadcrumb Pins: numbered markers dropped on the canvas
//   - Ghost Click Ripples: visual ripple on click synced to all
//   - Focus Zone: annotator selects a region to zoom for everyone
//   - Snapshot Export: composite background + canvas + pins → PNG download

import React, { useRef, useEffect, useCallback, useState } from "react";
import { InkingTool } from "@microsoft/live-share-canvas";
import {
  useLiveAnnotation,
  BreadcrumbPin,
  ClickRipple,
  FocusZone,
  PresenceUser,
  formatTimer,
} from "../hooks/useLiveAnnotation";
import { AnnotationToolbar } from "./AnnotationToolbar";
import { ScreenCaptureButton } from "./ScreenCaptureButton";

// ── Design tokens (shared language) ─────────────────────────────────────────
const GLASS = "rgba(24,24,36,0.72)";
const GLASS_BORDER = "rgba(255,255,255,0.08)";
const ACCENT = "rgba(99,102,241,0.85)";
const RADIUS = 12;

// ── Inline SVG icon helper ──────────────────────────────────────────────────
function SvgIcon({ d, size = 16, stroke = "currentColor" }: {
  d: string; size?: number; stroke?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function MeetingStage() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const {
    inkingManager,
    backgroundImage,
    currentRole,
    isConnected,
    setTool,
    setColor,
    clearCanvas,
    clearBackground,
    pushScreenshot,
    // Power-user features
    pins,
    dropPin,
    clearPins,
    clickRipples,
    sendClick,
    focusZone,
    setFocusZone,
    // Feature 1: LivePresence
    presenceUsers,
    updateCursor,
    localUserName,
    localUserColor,
    // Feature 2: LiveEvent — attention
    sendAttentionRequest,
    lastAttentionRequest,
    // Feature 3: LiveFollowMode
    isPresenting,
    presenterName,
    isSuspended,
    startPresenting,
    stopPresenting,
    toggleSuspend,
    // Feature 5: LiveTimer
    timerMilliRemaining,
    timerIsRunning,
    startTimer,
    pauseTimer,
    playTimer,
  } = useLiveAnnotation(canvasHostRef);

  const canAnnotate = currentRole === "annotator";

  // ── Active mode state ───────────────────────────────────────────────────
  const [activeMode, setActiveMode] = useState<"none" | "pin" | "focus">("none");
  const [focusDrag, setFocusDrag] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const lastCursorUpdateRef = useRef(0);

  // ── Global paste listener ───────────────────────────────────────────────
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!canAnnotate) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onload = () => {
              let w = img.width, h = img.height;
              const max = 1920;
              if (w > max || h > max) {
                const r = Math.min(max / w, max / h);
                w = Math.round(w * r);
                h = Math.round(h * r);
              }
              const c = document.createElement("canvas");
              c.width = w; c.height = h;
              c.getContext("2d")!.drawImage(img, 0, 0, w, h);
              pushScreenshot(c.toDataURL("image/jpeg", 0.85));
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    },
    [canAnnotate, pushScreenshot]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // ── Convert mouse event to percentage coordinates ─────────────────────
  function toPct(e: React.MouseEvent): { xPct: number; yPct: number } | null {
    const el = canvasContainerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      xPct: (e.clientX - rect.left) / rect.width,
      yPct: (e.clientY - rect.top) / rect.height,
    };
  }

  // ── Canvas click handler (pins / ghost clicks / focus drag) ─────────────
  function handleCanvasClick(e: React.MouseEvent) {
    if (!canAnnotate) return;
    const pct = toPct(e);
    if (!pct) return;

    if (activeMode === "pin") {
      dropPin(pct.xPct, pct.yPct);
      // Stay in pin mode for sequential drops
    } else {
      // Always send ghost click for annotators
      sendClick(pct.xPct, pct.yPct);
    }
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (!canAnnotate || activeMode !== "focus") return;
    const pct = toPct(e);
    if (!pct) return;
    setFocusDrag({ startX: pct.xPct, startY: pct.yPct, curX: pct.xPct, curY: pct.yPct });
  }

  /** Unified mouse-move: cursor presence + focus-drag */
  function handleGlobalMouseMove(e: React.MouseEvent) {
    // Throttled cursor presence update
    const now = Date.now();
    if (now - lastCursorUpdateRef.current >= 50) {
      lastCursorUpdateRef.current = now;
      const pct = toPct(e);
      if (pct && pct.xPct >= 0 && pct.xPct <= 1 && pct.yPct >= 0 && pct.yPct <= 1) {
        updateCursor(pct.xPct, pct.yPct);
      }
    }
    // Focus-drag tracking
    if (focusDrag) {
      const pct = toPct(e);
      if (pct) setFocusDrag({ ...focusDrag, curX: pct.xPct, curY: pct.yPct });
    }
  }

  function handleCanvasMouseLeave() {
    updateCursor(-1, -1); // clear cursor for remote viewers
  }

  function handleCanvasMouseMove(e: React.MouseEvent) {
    if (!focusDrag) return;
    const pct = toPct(e);
    if (!pct) return;
    setFocusDrag({ ...focusDrag, curX: pct.xPct, curY: pct.yPct });
  }

  function handleCanvasMouseUp() {
    if (!focusDrag) return;
    const x = Math.min(focusDrag.startX, focusDrag.curX);
    const y = Math.min(focusDrag.startY, focusDrag.curY);
    const w = Math.abs(focusDrag.curX - focusDrag.startX);
    const h = Math.abs(focusDrag.curY - focusDrag.startY);
    // Only apply if the selection is meaningful (> 5% of screen)
    if (w > 0.05 && h > 0.05) {
      setFocusZone({ xPct: x, yPct: y, wPct: w, hPct: h, active: true });
    }
    setFocusDrag(null);
    setActiveMode("none");
  }

  // ── Snapshot Export ───────────────────────────────────────────────────
  function handleExportSnapshot() {
    const container = canvasContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = rect.width * 2;   // 2x for retina quality
    exportCanvas.height = rect.height * 2;
    const ctx = exportCanvas.getContext("2d")!;
    ctx.scale(2, 2);

    // 1. Draw background (solid colour or image)
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const drawOverlays = () => {
      // 2. Draw InkingManager canvas(es)
      const inkCanvases = container.querySelectorAll("canvas");
      inkCanvases.forEach((c) => {
        const cr = c.getBoundingClientRect();
        ctx.drawImage(
          c,
          cr.left - rect.left,
          cr.top - rect.top,
          cr.width,
          cr.height
        );
      });

      // 3. Draw breadcrumb pins
      pins.forEach((pin) => {
        const px = pin.xPct * rect.width;
        const py = pin.yPct * rect.height;
        // Circle
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(99,102,241,0.9)";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Number
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(pin.id), px, py + 1);
      });

      // 4. Trigger download
      const link = document.createElement("a");
      link.download = `markup-snapshot-${Date.now()}.png`;
      link.href = exportCanvas.toDataURL("image/png");
      link.click();
    };

    if (backgroundImage) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Fit image using contain logic
        const imgRatio = img.width / img.height;
        const containerRatio = rect.width / rect.height;
        let dw: number, dh: number, dx: number, dy: number;
        if (imgRatio > containerRatio) {
          dw = rect.width;
          dh = rect.width / imgRatio;
          dx = 0;
          dy = (rect.height - dh) / 2;
        } else {
          dh = rect.height;
          dw = rect.height * imgRatio;
          dx = (rect.width - dw) / 2;
          dy = 0;
        }
        ctx.drawImage(img, dx, dy, dw, dh);
        drawOverlays();
      };
      img.src = backgroundImage;
    } else {
      drawOverlays();
    }
  }

  // ── Compute focus zone CSS transform ──────────────────────────────────
  const zoomStyle: React.CSSProperties = focusZone?.active
    ? (() => {
        const scale = 1 / Math.max(focusZone.wPct, focusZone.hPct);
        const clampedScale = Math.min(scale, 5); // cap at 5x
        const originX = (focusZone.xPct + focusZone.wPct / 2) * 100;
        const originY = (focusZone.yPct + focusZone.hPct / 2) * 100;
        return {
          transform: `scale(${clampedScale})`,
          transformOrigin: `${originX}% ${originY}%`,
          transition: "transform 0.5s ease, transform-origin 0.5s ease",
        };
      })()
    : { transition: "transform 0.5s ease, transform-origin 0.5s ease" };

  return (
    <div style={styles.root}>
      {/* ── Canvas container: background + ink + overlays ─────────────── */}
      <div
        ref={canvasContainerRef}
        style={{ ...styles.canvasContainer, ...zoomStyle, cursor: activeMode === "focus" ? "crosshair" : activeMode === "pin" ? "copy" : undefined }}
        onMouseMove={handleGlobalMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
      >
        {backgroundImage ? (
          <img
            src={backgroundImage}
            alt="Shared content"
            style={styles.backgroundImage}
            draggable={false}
          />
        ) : (
          <div style={styles.placeholder}>
            <p>Waiting for content…</p>
            <p style={{ fontSize: "14px", opacity: 0.7 }}>
              {currentRole === "annotator"
                ? "Click 'Share Screen' to capture your screen, or upload an image"
                : "The presenter will share their screen here"}
            </p>
          </div>
        )}

        {/* InkingManager host */}
        <div ref={canvasHostRef} style={styles.canvasHost} />

        {/* ── Interaction overlay ──────────────────────────────────────────
            When in pin or focus mode, this transparent div sits ABOVE the
            InkingManager canvas (z-index 2 vs canvas z-index 1) to capture
            mouse events. Without this, InkingManager swallows all pointer
            events before they reach the container's handlers. */}
        {activeMode !== "none" && (
          <div
            style={styles.interactionOverlay}
            onClick={handleCanvasClick}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
          />
        )}

        {/* ── Breadcrumb Pin overlays ──────────────────────────────────── */}
        {pins.map((pin) => (
          <div
            key={pin.id}
            style={{
              ...styles.pinMarker,
              left: `${pin.xPct * 100}%`,
              top: `${pin.yPct * 100}%`,
            }}
          >
            <span style={styles.pinNumber}>{pin.id}</span>
          </div>
        ))}

        {/* ── Connecting line between sequential pins ──────────────────── */}
        {pins.length > 1 && (
          <svg style={styles.pinLinesSvg}>
            <defs>
              <filter id="pinGlow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {pins.slice(1).map((pin, i) => {
              const prev = pins[i];
              return (
                <line
                  key={`line-${i}`}
                  x1={`${prev.xPct * 100}%`}
                  y1={`${prev.yPct * 100}%`}
                  x2={`${pin.xPct * 100}%`}
                  y2={`${pin.yPct * 100}%`}
                  stroke="rgba(165,168,255,0.5)"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  filter="url(#pinGlow)"
                />
              );
            })}
          </svg>
        )}

        {/* ── Ghost Click Ripples ──────────────────────────────────────── */}
        {clickRipples.map((ripple) => (
          <div
            key={ripple.ts}
            style={{
              ...styles.ripple,
              left: `${ripple.xPct * 100}%`,
              top: `${ripple.yPct * 100}%`,
            }}
          >
            <div style={styles.rippleRing1} />
            <div style={styles.rippleRing2} />
            <div style={styles.rippleDot} />
          </div>
        ))}

        {/* ── Focus Zone drag preview ──────────────────────────────────── */}
        {focusDrag && (
          <div
            style={{
              ...styles.focusDragRect,
              left: `${Math.min(focusDrag.startX, focusDrag.curX) * 100}%`,
              top: `${Math.min(focusDrag.startY, focusDrag.curY) * 100}%`,
              width: `${Math.abs(focusDrag.curX - focusDrag.startX) * 100}%`,
              height: `${Math.abs(focusDrag.curY - focusDrag.startY) * 100}%`,
            }}
          />
        )}

        {/* ── Feature 1: Remote user cursors ──────────────────────────── */}
        {presenceUsers
          .filter((u) => !u.isLocal && u.cursor && u.cursor.xPct >= 0 && u.cursor.yPct >= 0)
          .map((u) => (
            <div
              key={u.userId}
              style={{
                position: "absolute" as const,
                left: `${u.cursor!.xPct * 100}%`,
                top: `${u.cursor!.yPct * 100}%`,
                zIndex: 8,
                pointerEvents: "none" as const,
                transition: "left 0.1s linear, top 0.1s linear",
              }}
            >
              <svg width="16" height="20" viewBox="0 0 16 20"
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" }}>
                <path d="M0 0L16 12L8 12L4 20L0 0Z" fill={u.color} stroke="#fff" strokeWidth="1.5" />
              </svg>
              <div style={{
                position: "absolute" as const, left: 14, top: 12,
                background: u.color, color: "#fff",
                padding: "1px 6px", borderRadius: 4,
                fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" as const,
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
              }}>
                {u.name}
              </div>
            </div>
          ))}
      </div>

      {/* ── Connection status ──────────────────────────────────────────── */}
      {!isConnected && (
        <div style={styles.connectingBanner}>Connecting to Live Share…</div>
      )}

      {/* ── Feature 1: Presence roster (top-right) ─────────────────────── */}
      {isConnected && presenceUsers.length > 0 && (
        <div style={styles.presenceRoster}>
          {presenceUsers.map((u) => (
            <div
              key={u.userId}
              style={{
                width: 26, height: 26, borderRadius: "50%",
                background: u.color,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "#fff",
                border: u.isLocal ? "2px solid #fff" : "2px solid transparent",
                marginLeft: -4,
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              }}
              title={`${u.name} (${u.role})`}
            >
              {u.name.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
      )}

      {/* ── Feature 5: Timer display ───────────────────────────────────── */}
      {(timerIsRunning || timerMilliRemaining > 0) && (
        <div style={styles.timerDisplay}>
          <SvgIcon d="M12 2v10l4.5 4.5" size={16} />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatTimer(timerMilliRemaining)}
          </span>
        </div>
      )}

      {/* ── Feature 3: Following presenter banner ──────────────────────── */}
      {presenterName && !isPresenting && (
        <div style={styles.followBanner}>
          <SvgIcon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" size={14} />
          <span>
            Following {presenterName}
            {isSuspended && <span style={{ opacity: 0.6 }}> (paused)</span>}
          </span>
          <button
            style={styles.modeCancel}
            onClick={toggleSuspend}
            title={isSuspended ? "Resume following" : "Pause following"}
          >
            {isSuspended ? "▶" : "⏸"}
          </button>
        </div>
      )}

      {/* ── Feature 2: Attention request toast ─────────────────────────── */}
      {lastAttentionRequest && (
        <div style={styles.attentionToast}>
          <SvgIcon d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0" size={16} stroke="#f59e0b" />
          <span>{lastAttentionRequest.senderName} is requesting attention</span>
        </div>
      )}

      {/* ── Mode indicator ─────────────────────────────────────────────── */}
      {activeMode !== "none" && (
        <div style={styles.modeBanner}>
          <SvgIcon
            d={activeMode === "pin"
              ? "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
              : "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7"}
            size={14}
            stroke="#fff"
          />
          <span>{activeMode === "pin" ? "Click to drop pin" : "Drag to select focus area"}</span>
          <button
            style={styles.modeCancel}
            onClick={() => { setActiveMode("none"); setFocusDrag(null); }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Toolbar: only shown to annotators ──────────────────────────── */}
      {canAnnotate && isConnected && inkingManager && (
        <div style={styles.toolbarWrapper}>
          <AnnotationToolbar
            inkingManager={inkingManager}
            onSetTool={setTool}
            onSetColor={setColor}
            onClear={clearCanvas}
          />
          <ScreenCaptureButton onCapture={pushScreenshot} />

          {/* ── Power-user toolbar ──────────────────────────────────────── */}
          <div style={styles.powerBar}>
            {/* Drop Pin */}
            <button
              style={{
                ...styles.powerBtn,
                ...(activeMode === "pin" ? styles.powerBtnActive : {}),
              }}
              onClick={() => setActiveMode(activeMode === "pin" ? "none" : "pin")}
              title="Drop numbered breadcrumb pin"
            >
              <SvgIcon d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z M12 11.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
              <span>Pin</span>
            </button>

            {/* Clear Pins */}
            {pins.length > 0 && (
              <button
                style={{ ...styles.powerBtn, ...styles.dangerBtn }}
                onClick={clearPins}
                title="Clear all pins"
              >
                <SvgIcon d="M18 6L6 18 M6 6l12 12" />
                <span>{pins.length}</span>
              </button>
            )}

            <div style={styles.powerSep} />

            {/* Focus Zone */}
            <button
              style={{
                ...styles.powerBtn,
                ...(activeMode === "focus" ? styles.powerBtnActive : {}),
              }}
              onClick={() => setActiveMode(activeMode === "focus" ? "none" : "focus")}
              title="Select a region to zoom in for everyone"
            >
              <SvgIcon d="M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7" />
              <span>Focus</span>
            </button>

            {/* Reset Zoom */}
            {focusZone?.active && (
              <button
                style={styles.powerBtn}
                onClick={() => setFocusZone(null)}
                title="Reset zoom to full view"
              >
                <SvgIcon d="M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3" />
                <span>Reset</span>
              </button>
            )}

            <div style={styles.powerSep} />

            {/* Export Snapshot */}
            <button
              style={styles.powerBtn}
              onClick={handleExportSnapshot}
              title="Download annotated snapshot as PNG"
            >
              <SvgIcon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
              <span>Export</span>
            </button>

            <div style={styles.powerSep} />

            {/* ── Feature 5: Timer controls ────────────────────────────── */}
            {!timerIsRunning && timerMilliRemaining === 0 && (
              <>
                <button style={styles.powerBtn} onClick={() => startTimer(60_000)} title="1-minute timer">
                  <SvgIcon d="M12 2v10l4.5 4.5" size={14} />
                  <span>1m</span>
                </button>
                <button style={styles.powerBtn} onClick={() => startTimer(180_000)} title="3-minute timer">
                  <span>3m</span>
                </button>
                <button style={styles.powerBtn} onClick={() => startTimer(300_000)} title="5-minute timer">
                  <span>5m</span>
                </button>
              </>
            )}
            {timerIsRunning && (
              <button style={styles.powerBtn} onClick={pauseTimer} title="Pause timer">
                <SvgIcon d="M6 4h4v16H6z M14 4h4v16h-4z" size={14} />
                <span>Pause</span>
              </button>
            )}
            {!timerIsRunning && timerMilliRemaining > 0 && (
              <button style={styles.powerBtn} onClick={playTimer} title="Resume timer">
                <SvgIcon d="M5 3l14 9-14 9V3z" size={14} />
                <span>Resume</span>
              </button>
            )}

            <div style={styles.powerSep} />

            {/* ── Feature 3: Present toggle ────────────────────────────── */}
            {!isPresenting ? (
              <button style={styles.powerBtn} onClick={startPresenting} title="Start presenting (lock followers' view)">
                <SvgIcon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0" size={14} />
                <span>Present</span>
              </button>
            ) : (
              <button style={{ ...styles.powerBtn, ...styles.powerBtnActive }} onClick={stopPresenting} title="Stop presenting">
                <SvgIcon d="M18 6L6 18 M6 6l12 12" size={14} />
                <span>Stop</span>
              </button>
            )}
          </div>

          {/* Clear All */}
          {backgroundImage && (
            <button
              onClick={clearBackground}
              style={styles.clearImgBtn}
              title="Remove background image and annotations"
            >
              <SvgIcon d="M3 6h18 M8 6V4h8v2 M5 6l1 14h12l1-14 M10 11v6 M14 11v6" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      )}

      {/* ── Viewer badge + controls ──────────────────────────────────── */}
      {currentRole === "viewer" && isConnected && (
        <div style={styles.viewerControls}>
          <div style={styles.viewerBadge}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:5,opacity:0.7}}>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            View only
          </div>

          {/* Feature 2: Attention request button */}
          <button
            style={styles.attentionBtn}
            onClick={sendAttentionRequest}
            title="Request the presenter's attention"
          >
            <SvgIcon d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0" size={14} />
            <span>Attention</span>
          </button>

          {/* Feature 3: Suspend / resume following */}
          {presenterName && (
            <button
              style={styles.attentionBtn}
              onClick={toggleSuspend}
              title={isSuspended ? "Resume following presenter" : "Pause following presenter"}
            >
              <span>{isSuspended ? "▶ Resume" : "⏸ Pause"}</span>
            </button>
          )}
        </div>
      )}

      {/* ── CSS keyframes (injected once) ──────────────────────────────── */}
      <style>{`
        @keyframes rippleExpand1 {
          0%   { transform: translate(-50%,-50%) scale(0); opacity: 0.8; }
          100% { transform: translate(-50%,-50%) scale(3); opacity: 0; }
        }
        @keyframes rippleExpand2 {
          0%   { transform: translate(-50%,-50%) scale(0); opacity: 0.5; }
          100% { transform: translate(-50%,-50%) scale(4); opacity: 0; }
        }
        @keyframes pinPop {
          0%   { transform: translate(-50%,-50%) scale(0); }
          60%  { transform: translate(-50%,-50%) scale(1.15); }
          100% { transform: translate(-50%,-50%) scale(1); }
        }
        @keyframes focusPulse {
          0%, 100% { border-color: rgba(99,102,241,0.5); }
          50%      { border-color: rgba(99,102,241,0.9); }
        }
        @keyframes attentionSlideIn {
          0%   { opacity: 0; transform: translateX(-50%) translateY(-12px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes timerPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "relative" as const,
    width: "100vw",
    height: "100vh",
    background: "#1e1e1e",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    fontFamily: "'Segoe UI', sans-serif",
  },
  canvasContainer: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    zIndex: 0,
  },
  backgroundImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
  },
  canvasHost: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 1,
  },
  interactionOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 2,           // Above InkingManager canvas (z-index 1)
    cursor: "crosshair",
    background: "transparent",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#fff",
    textAlign: "center",
    padding: "2rem",
  },

  // ── Breadcrumb Pins ────────────────────────────────────────────────────
  pinMarker: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1, #818cf8)",
    border: "2.5px solid rgba(255,255,255,0.9)",
    boxShadow: "0 2px 12px rgba(99,102,241,0.5), 0 0 0 4px rgba(99,102,241,0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    pointerEvents: "none",
    animation: "pinPop 0.3s ease-out forwards",
    transform: "translate(-50%, -50%)",
  },
  pinNumber: {
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    userSelect: "none",
  },
  pinLinesSvg: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 4,
    pointerEvents: "none",
    overflow: "visible",
  },

  // ── Ghost Click Ripples ────────────────────────────────────────────────
  ripple: {
    position: "absolute",
    zIndex: 6,
    pointerEvents: "none",
    width: 0,
    height: 0,
  },
  rippleRing1: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: "50%",
    border: "2px solid rgba(99,102,241,0.8)",
    animation: "rippleExpand1 1.2s ease-out forwards",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  },
  rippleRing2: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: "50%",
    border: "1.5px solid rgba(165,168,255,0.5)",
    animation: "rippleExpand2 1.8s ease-out 0.2s forwards",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  },
  rippleDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "rgba(99,102,241,0.9)",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  },

  // ── Focus Zone ─────────────────────────────────────────────────────────
  focusDragRect: {
    position: "absolute",
    border: "2px dashed rgba(99,102,241,0.8)",
    background: "rgba(99,102,241,0.08)",
    borderRadius: 4,
    zIndex: 7,
    pointerEvents: "none",
    animation: "focusPulse 1s ease-in-out infinite",
  },

  // ── Banners ────────────────────────────────────────────────────────────
  connectingBanner: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    background: GLASS,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: `1px solid ${GLASS_BORDER}`,
    color: "rgba(255,255,255,0.8)",
    padding: "7px 18px",
    borderRadius: RADIUS,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    zIndex: 10,
    letterSpacing: 0.3,
  },
  modeBanner: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    background: ACCENT,
    color: "#fff",
    padding: "6px 16px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 4px 16px rgba(99,102,241,0.4)",
    whiteSpace: "nowrap" as const,
  },
  modeCancel: {
    background: "rgba(255,255,255,0.2)",
    border: "none",
    color: "#fff",
    borderRadius: 6,
    width: 22,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    marginLeft: 4,
  },

  // ── Toolbars ───────────────────────────────────────────────────────────
  toolbarWrapper: {
    position: "absolute",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    gap: 10,
    alignItems: "center",
    zIndex: 10,
    pointerEvents: "auto" as const,
  },
  powerBar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    background: GLASS,
    backdropFilter: "blur(20px) saturate(1.6)",
    WebkitBackdropFilter: "blur(20px) saturate(1.6)",
    borderRadius: RADIUS,
    padding: "6px 8px",
    border: `1px solid ${GLASS_BORDER}`,
    boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
  },
  powerBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    height: 34,
    padding: "0 10px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.78)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    whiteSpace: "nowrap" as const,
    transition: "all 0.15s ease",
  },
  powerBtnActive: {
    background: ACCENT,
    color: "#fff",
    boxShadow: "0 0 12px rgba(99,102,241,0.4)",
  },
  dangerBtn: {
    color: "rgba(255,120,120,0.85)",
  },
  powerSep: {
    width: 1,
    height: 20,
    background: "rgba(255,255,255,0.08)",
    margin: "0 2px",
    flexShrink: 0,
  },
  clearImgBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 14px",
    borderRadius: RADIUS,
    border: "1px solid rgba(255,100,100,0.25)",
    background: GLASS,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    color: "rgba(255,120,120,0.88)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    whiteSpace: "nowrap" as const,
    transition: "background 0.15s, border-color 0.15s",
    lineHeight: 1,
  },
  viewerBadge: {
    background: GLASS,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    color: "rgba(255,255,255,0.6)",
    padding: "5px 14px",
    borderRadius: RADIUS,
    border: `1px solid ${GLASS_BORDER}`,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    letterSpacing: 0.3,
    display: "flex",
    alignItems: "center",
  },
  viewerControls: {
    position: "absolute",
    top: 8,
    right: 8,
    display: "flex",
    gap: 6,
    alignItems: "center",
    zIndex: 10,
  },

  // ── Feature 1: Presence roster ──────────────────────────────────────
  presenceRoster: {
    position: "absolute",
    top: 8,
    right: 8,
    display: "flex",
    alignItems: "center",
    zIndex: 10,
    background: GLASS,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    borderRadius: 20,
    padding: "4px 8px 4px 12px",
    border: `1px solid ${GLASS_BORDER}`,
  },

  // ── Feature 2: Attention ────────────────────────────────────────────
  attentionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    borderRadius: RADIUS,
    border: "1px solid rgba(245,158,11,0.35)",
    background: "rgba(245,158,11,0.12)",
    color: "#fbbf24",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    whiteSpace: "nowrap" as const,
  },
  attentionToast: {
    position: "absolute",
    top: 48,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(245,158,11,0.2)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#fde68a",
    padding: "8px 18px",
    borderRadius: RADIUS,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    zIndex: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    animation: "attentionSlideIn 0.3s ease-out forwards",
    boxShadow: "0 4px 16px rgba(245,158,11,0.25)",
    whiteSpace: "nowrap" as const,
  },

  // ── Feature 3: Follow banner ────────────────────────────────────────
  followBanner: {
    position: "absolute",
    top: 48,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(99,102,241,0.2)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: "1px solid rgba(99,102,241,0.35)",
    color: "rgba(255,255,255,0.85)",
    padding: "6px 16px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "'Segoe UI', sans-serif",
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap" as const,
  },

  // ── Feature 5: Timer ────────────────────────────────────────────────
  timerDisplay: {
    position: "absolute",
    top: 12,
    right: 140,
    background: GLASS,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: `1px solid ${GLASS_BORDER}`,
    color: "#fff",
    padding: "6px 14px",
    borderRadius: RADIUS,
    fontSize: 16,
    fontWeight: 600,
    fontFamily: "'Segoe UI', sans-serif",
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    animation: "timerPulse 2s ease-in-out infinite",
    letterSpacing: 1,
  },
};
