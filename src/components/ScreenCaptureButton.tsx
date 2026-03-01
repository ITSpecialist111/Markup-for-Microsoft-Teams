// src/components/ScreenCaptureButton.tsx
//
// Content-sharing toolbar for the annotation canvas.
//
// STRATEGY:
//   1. Try getDisplayMedia() DIRECTLY first — works if the browser/iframe allows it
//   2. If blocked (Teams iframe permissions-policy), open a POPUP helper window
//      at /capture.html. That window runs outside the iframe and can call
//      getDisplayMedia() freely. It sends captured frames back via postMessage
//      (BroadcastChannel is partitioned by top-level site in Chrome).
//   3. Upload Image — always works (file picker)
//   4. Ctrl+V Paste — handled by the global paste listener in MeetingStage.tsx
//
// The popup approach is the key innovation: getDisplayMedia() only fails because
// Teams' iframe lacks the `display-capture` permissions-policy. A standalone
// window at the same origin has no such restriction.

import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  onCapture: (base64DataUrl: string) => void;
  autoRefreshSeconds?: number;
}

export function ScreenCaptureButton({ onCapture, autoRefreshSeconds = 5 }: Props) {
  const [showPasteHint, setShowPasteHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── postMessage listener: receive frames from popup capture window ──────
  // BroadcastChannel is partitioned by top-level site in Chrome, so the
  // popup (top-level at SWA domain) can't talk to this iframe (under
  // teams.microsoft.com). postMessage via window.opener works instead.
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Only accept messages from our own origin
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "markup-capture" && e.data.dataUrl) {
        console.log("[Markup] Received frame from capture popup");
        onCapture(e.data.dataUrl);
        setIsLive(true);
      } else if (e.data?.type === "markup-closed") {
        setIsLive(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onCapture]);

  // Clean up hint timer on unmount
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function resizeImage(
    dataUrl: string,
    maxWidth = 1920,
    maxHeight = 1080
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = dataUrl;
    });
  }

  // ── Direct screen capture (works outside Teams iframe) ────────────────────
  async function tryDirectCapture(): Promise<boolean> {
    if (!navigator.mediaDevices?.getDisplayMedia) return false;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 300));

    let w = video.videoWidth || 1920;
    let h = video.videoHeight || 1080;
    if (w > 1920 || h > 1080) {
      const r = Math.min(1920 / w, 1080 / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;

    onCapture(dataUrl);
    return true;
  }

  // ── Open popup capture window (fallback when iframe blocks capture) ───────
  function openCapturePopup() {
    const origin = window.location.origin;
    const url = `${origin}/capture.html?interval=${autoRefreshSeconds}&origin=${encodeURIComponent(origin)}`;
    const popup = window.open(
      url,
      "markup-capture",
      "width=520,height=420,menubar=no,toolbar=no,location=no,status=no"
    );

    if (!popup) {
      setError(
        "Pop-up was blocked. Please allow pop-ups for this site, then try again."
      );
    }
  }

  // ── Handle "Share My Screen" click ────────────────────────────────────────
  async function handleCaptureClick() {
    setError(null);
    try {
      // Try direct capture first — works if not in a restricted iframe
      const ok = await tryDirectCapture();
      if (ok) return;
    } catch {
      // Direct capture failed (expected in Teams iframe) — fall back to popup
    }
    openCapturePopup();
  }

  // ── File upload handler ───────────────────────────────────────────────────
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setError(null);
      try {
        const dataUrl = await fileToDataUrl(file);
        const resized = await resizeImage(dataUrl);
        onCapture(resized);
      } catch {
        setError("Failed to read the image file.");
      }
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [onCapture]
  );

  // ── Paste hint toggle ────────────────────────────────────────────────────
  const togglePasteHint = useCallback(() => {
    setShowPasteHint((prev) => {
      if (!prev) {
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        hintTimerRef.current = setTimeout(() => setShowPasteHint(false), 8000);
      }
      return !prev;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={S.bar}>
      {/* ── Share My Screen ───────────────────────────────────────────── */}
      <button
        style={{ ...S.btn, ...S.btnAccent }}
        onClick={handleCaptureClick}
        title="Capture your screen and share it to the annotation canvas"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8 M12 17v4" />
        </svg>
        <span>Share Screen</span>
      </button>

      {/* ── Live indicator ────────────────────────────────────────────── */}
      {isLive && <span style={S.livePill}>LIVE</span>}

      <div style={S.sep} />

      {/* ── Upload Image ──────────────────────────────────────────────── */}
      <button
        style={S.btn}
        onClick={() => fileInputRef.current?.click()}
        title="Upload an image or screenshot from your device"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>Upload</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileUpload}
      />

      {/* ── Paste guide ───────────────────────────────────────────────── */}
      <button
        style={{
          ...S.btn,
          ...(showPasteHint ? S.btnActive : {}),
        }}
        onClick={togglePasteHint}
        title="Show instructions for pasting a screenshot"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </svg>
        <span>Paste</span>
      </button>

      {/* ── Paste-hint tooltip ────────────────────────────────────────── */}
      {showPasteHint && (
        <div style={S.tooltip}>
          <div style={S.tooltipSteps}>
            <span>
              <strong>1.</strong>{" "}
              <kbd style={S.kbd}>Win</kbd> + <kbd style={S.kbd}>Shift</kbd> + <kbd style={S.kbd}>S</kbd>
            </span>
            <span><strong>2.</strong> Select area</span>
            <span>
              <strong>3.</strong> Click canvas, then{" "}
              <kbd style={S.kbd}>Ctrl</kbd> + <kbd style={S.kbd}>V</kbd>
            </span>
          </div>
          <button style={S.closeToast} onClick={() => setShowPasteHint(false)}>×</button>
        </div>
      )}

      {/* ── Error toast ──────────────────────────────────────────────── */}
      {error && (
        <div style={S.errorToast}>
          {error}
          <button style={S.closeToast} onClick={() => setError(null)}>×</button>
        </div>
      )}
    </div>
  );
}

// ── Design tokens (shared with AnnotationToolbar) ───────────────────────────

const GLASS = "rgba(24,24,36,0.72)";
const GLASS_BORDER = "rgba(255,255,255,0.08)";
const ACCENT = "rgba(99,102,241,0.85)";
const RADIUS = 12;

const S: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: GLASS,
    backdropFilter: "blur(20px) saturate(1.6)",
    WebkitBackdropFilter: "blur(20px) saturate(1.6)",
    borderRadius: RADIUS,
    padding: "6px 10px",
    border: `1px solid ${GLASS_BORDER}`,
    boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
    position: "relative" as const,
  },
  btn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.82)",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
    whiteSpace: "nowrap" as const,
    transition: "all 0.15s ease",
    letterSpacing: "0.01em",
  },
  btnAccent: {
    background: ACCENT,
    color: "#fff",
    boxShadow: "0 0 12px rgba(99,102,241,0.3)",
  },
  btnActive: {
    background: "rgba(255,255,255,0.1)",
  },
  livePill: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "#fff",
    background: "#ef4444",
    borderRadius: 6,
    padding: "2px 8px",
    lineHeight: "18px",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  sep: {
    width: 1,
    height: 24,
    background: "rgba(255,255,255,0.1)",
    margin: "0 4px",
    flexShrink: 0,
  },
  tooltip: {
    position: "absolute" as const,
    bottom: "calc(100% + 10px)",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(24,24,36,0.95)",
    backdropFilter: "blur(16px)" as any,
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 10,
    fontSize: 13,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    border: `1px solid ${GLASS_BORDER}`,
    maxWidth: "90vw",
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  },
  tooltipSteps: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    lineHeight: 1.6,
  },
  kbd: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 4,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.18)",
    fontSize: 11,
    fontFamily: "'Segoe UI Variable', monospace",
    verticalAlign: "middle",
  },
  errorToast: {
    position: "absolute" as const,
    bottom: "calc(100% + 10px)",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(220,38,38,0.92)",
    backdropFilter: "blur(16px)" as any,
    color: "#fff",
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: 12,
    whiteSpace: "nowrap" as const,
    display: "flex",
    gap: 8,
    alignItems: "center",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    maxWidth: "90vw",
    fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  },
  closeToast: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
    fontSize: 16,
    padding: "0 2px",
    lineHeight: 1,
  },
};
