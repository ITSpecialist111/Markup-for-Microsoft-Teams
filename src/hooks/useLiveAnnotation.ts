// src/hooks/useLiveAnnotation.ts
//
// Core hook for the MarkUp annotation app.
//
// Follows the official Live Share Canvas SDK pattern:
//   https://github.com/microsoft/live-share-sdk/tree/main/packages/live-share-canvas
//
// Key architecture decisions (learned from debugging in Teams):
//
//   1. Do NOT pass allowedRoles to LiveCanvas.initialize().
//      The SDK wraps InkingManager's inputProvider with a role-verifying
//      LivePointerInputProvider. If role verification fails (common due to
//      audience-sync timing in Teams iframe), ALL pointer events are silently
//      blocked — the pens stop working entirely.
//
//   2. Role-gate at the UI layer instead:
//      - Hide toolbar for viewers (MeetingStage already does this)
//      - Deactivate InkingManager for viewers (stops local input)
//      - Activate InkingManager for annotators
//
//   3. Background images are stored in a Fluid SharedMap and synced to all
//      participants via "valueChanged" events.
//
//   4. Power-user features (pins, clicks, focus zone) are also stored in
//      the SharedMap for real-time sync across all participants.

import { useEffect, useRef, useState, useCallback } from "react";
import { app, LiveShareHost } from "@microsoft/teams-js";
import { LiveShareClient, UserMeetingRole } from "@microsoft/live-share";
import { InkingManager, InkingTool, LiveCanvas } from "@microsoft/live-share-canvas";
import { SharedMap } from "fluid-framework";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AnnotationRole = "annotator" | "presenter" | "viewer";

/** A numbered breadcrumb pin placed on the canvas */
export interface BreadcrumbPin {
  id: number;          // sequential 1, 2, 3…
  xPct: number;        // 0–1 percentage of container width
  yPct: number;        // 0–1 percentage of container height
  label?: string;      // optional text
}

/** A ghost click ripple event */
export interface ClickRipple {
  xPct: number;
  yPct: number;
  ts: number;          // Date.now() — used for key & expiry
}

/** A focus zone crop rectangle */
export interface FocusZone {
  xPct: number;        // top-left X as 0–1
  yPct: number;        // top-left Y as 0–1
  wPct: number;        // width as 0–1
  hPct: number;        // height as 0–1
  active: boolean;
}

interface LiveAnnotationState {
  inkingManager: InkingManager | null;
  liveCanvas: LiveCanvas | null;
  backgroundImage: string | null;
  currentRole: AnnotationRole;
  isConnected: boolean;
  setTool: (tool: InkingTool) => void;
  setColor: (hex: string) => void;
  clearCanvas: () => void;
  clearBackground: () => void;
  pushScreenshot: (base64: string) => void;
  // ── Power-user features ──────────────────────────────────────────────
  pins: BreadcrumbPin[];
  dropPin: (xPct: number, yPct: number) => void;
  clearPins: () => void;
  clickRipples: ClickRipple[];
  sendClick: (xPct: number, yPct: number) => void;
  focusZone: FocusZone | null;
  setFocusZone: (zone: FocusZone | null) => void;
  canvasHostRef: React.RefObject<HTMLDivElement>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLiveAnnotation(
  canvasHostRef: React.RefObject<HTMLDivElement>
): LiveAnnotationState {
  const [inkingManager, setInkingManager] = useState<InkingManager | null>(null);
  const [liveCanvas, setLiveCanvas] = useState<LiveCanvas | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<AnnotationRole>("viewer");
  const [isConnected, setIsConnected] = useState(false);

  // ── Power-user feature state ────────────────────────────────────────────
  const [pins, setPins] = useState<BreadcrumbPin[]>([]);
  const [clickRipples, setClickRipples] = useState<ClickRipple[]>([]);
  const [focusZone, setFocusZoneState] = useState<FocusZone | null>(null);

  const inkingManagerRef = useRef<InkingManager | null>(null);
  const appStateRef = useRef<SharedMap | null>(null);
  const valueChangedHandlerRef = useRef<((changed: any) => void) | null>(null);

  // ── Main initialisation effect ──────────────────────────────────────────
  useEffect(() => {
    if (!canvasHostRef.current) return;

    let cancelled = false;

    async function init() {
      try {
        // ── 1. Determine host ─────────────────────────────────────────────
        let host;
        try {
          await app.initialize();
          host = LiveShareHost.create();
          console.log("[Markup] Teams SDK initialised — using LiveShareHost");
        } catch {
          const { TestLiveShareHost } = await import("@microsoft/live-share");
          host = TestLiveShareHost.create();
          console.log("[Markup] Running outside Teams — using TestLiveShareHost");
        }

        // ── 2. Join the Live Share Fluid container ────────────────────────
        const client = new LiveShareClient(host);

        const schema = {
          initialObjects: {
            liveCanvas: LiveCanvas,
            appState: SharedMap,
          },
        };

        console.log("[Markup] Joining container…");
        const { container, services } = await client.joinContainer(schema);
        if (cancelled) return;
        console.log("[Markup] Container joined");

        const { liveCanvas: lc, appState } = container.initialObjects as {
          liveCanvas: LiveCanvas;
          appState: SharedMap;
        };

        // ── 3. Create InkingManager ───────────────────────────────────────
        // The host div must already be in the DOM and have dimensions.
        const hostEl = canvasHostRef.current!;
        console.log(
          "[Markup] Canvas host dimensions:",
          hostEl.clientWidth,
          "×",
          hostEl.clientHeight
        );

        const manager = new InkingManager(hostEl);

        // ── 4. Initialize LiveCanvas — NO allowedRoles ────────────────────
        // IMPORTANT: Do NOT pass allowedRoles here.
        // The SDK's LivePointerInputProvider role gate silently blocks ALL
        // pointer events when role verification fails — which happens
        // frequently in Teams meetings due to audience sync timing.
        // We handle role-gating at the UI level instead.
        await lc.initialize(manager);
        console.log("[Markup] LiveCanvas initialised (no role restriction)");

        // ── 5. Activate InkingManager immediately ─────────────────────────
        // We'll deactivate for viewers once role is resolved (step 6).
        // Activating now ensures the canvas renders and is ready.
        manager.activate();
        console.log("[Markup] InkingManager activated");

        // ── 6. Determine current user's role ──────────────────────────────
        const resolveRole = async (): Promise<AnnotationRole> => {
          try {
            let myself = services.audience.getMyself();

            // getMyself() returns undefined before audience sync completes.
            // Wait for the membersChanged event with a timeout.
            if (!myself) {
              console.log("[Markup] Waiting for audience sync…");
              myself = await new Promise<any>((resolve) => {
                const handler = () => {
                  const me = services.audience.getMyself();
                  if (me) {
                    services.audience.off("membersChanged", handler);
                    resolve(me);
                  }
                };
                services.audience.on("membersChanged", handler);
                setTimeout(() => {
                  services.audience.off("membersChanged", handler);
                  resolve(null);
                }, 10_000);
              });
            }

            if (myself && myself.connections.length > 0) {
              const clientId = myself.connections[0].id;
              const roles = await host.getClientRoles(clientId);
              console.log("[Markup] User roles:", roles);

              const canAnnotate = roles?.some(
                (r: any) =>
                  r === UserMeetingRole.organizer ||
                  r === UserMeetingRole.presenter
              );

              return canAnnotate ? "annotator" : "viewer";
            }

            return "viewer";
          } catch (err) {
            // TestLiveShareHost (local dev) doesn't have getClientRoles
            console.warn("[Markup] Role check failed, defaulting to annotator:", err);
            return "annotator";
          }
        };

        const role = await resolveRole();
        if (cancelled) return;
        console.log("[Markup] Resolved role:", role);
        setCurrentRole(role);

        // Deactivate InkingManager for viewers (stops local pointer input;
        // they still see remote strokes rendered by LiveCanvas sync).
        if (role === "viewer") {
          manager.deactivate();
          console.log("[Markup] InkingManager deactivated (viewer)");
        }

        // Re-check role when audience changes (e.g. promoted mid-meeting)
        services.audience.on("membersChanged", async () => {
          if (cancelled) return;
          try {
            const myself = services.audience.getMyself();
            if (myself && myself.connections.length > 0) {
              const clientId = myself.connections[0].id;
              const roles = await host.getClientRoles(clientId);
              const canAnnotate = roles?.some(
                (r: any) =>
                  r === UserMeetingRole.organizer ||
                  r === UserMeetingRole.presenter
              );
              const newRole = canAnnotate ? "annotator" : "viewer";
              if (!cancelled) {
                setCurrentRole(newRole);
                // Activate/deactivate InkingManager based on new role
                if (newRole === "annotator") {
                  manager.activate();
                } else {
                  manager.deactivate();
                }
              }
            }
          } catch {
            /* keep current role */
          }
        });

        // ── 7. Shared state sync via SharedMap ─────────────────────────
        const onValueChanged = (changed: any) => {
          if (cancelled) return;
          if (changed.key === "backgroundImage") {
            const img = appState.get<string>("backgroundImage");
            setBackgroundImage(img || null);
          } else if (changed.key === "pins") {
            const raw = appState.get<string>("pins");
            setPins(raw ? JSON.parse(raw) : []);
          } else if (changed.key === "lastClick") {
            const raw = appState.get<string>("lastClick");
            if (raw) {
              const click: ClickRipple = JSON.parse(raw);
              setClickRipples((prev) => [...prev, click]);
              // Auto-remove after 2 seconds
              setTimeout(() => {
                setClickRipples((prev) => prev.filter((r) => r.ts !== click.ts));
              }, 2000);
            }
          } else if (changed.key === "focusZone") {
            const raw = appState.get<string>("focusZone");
            setFocusZoneState(raw ? JSON.parse(raw) : null);
          }
        };
        appState.on("valueChanged", onValueChanged);
        valueChangedHandlerRef.current = onValueChanged;

        // Load any existing state
        const existingImg = appState.get<string>("backgroundImage");
        if (existingImg) setBackgroundImage(existingImg);

        const existingPins = appState.get<string>("pins");
        if (existingPins) setPins(JSON.parse(existingPins));

        const existingFocus = appState.get<string>("focusZone");
        if (existingFocus) setFocusZoneState(JSON.parse(existingFocus));

        // ── 8. Store refs and mark connected ──────────────────────────────
        appStateRef.current = appState;
        inkingManagerRef.current = manager;
        setInkingManager(manager);
        setLiveCanvas(lc);
        setIsConnected(true);
        console.log("[Markup] Fully connected and ready");
      } catch (err) {
        console.error("[Markup] Live Share connection failed:", err);
      }
    }

    init();

    return () => {
      cancelled = true;
      inkingManagerRef.current?.deactivate();
      if (appStateRef.current && valueChangedHandlerRef.current) {
        appStateRef.current.off("valueChanged", valueChangedHandlerRef.current);
      }
    };
  }, []); // Run once on mount

  // ── Actions ─────────────────────────────────────────────────────────────────

  const setTool = useCallback((tool: InkingTool) => {
    if (inkingManagerRef.current) {
      inkingManagerRef.current.tool = tool;
    }
  }, []);

  const setColor = useCallback((hex: string) => {
    if (!inkingManagerRef.current) return;
    const mgr = inkingManagerRef.current;
    const color = {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 1,
    };
    mgr.penBrush.color = color;
    mgr.highlighterBrush.color = color;
    mgr.laserPointerBrush.color = color;
    mgr.lineBrush.color = color;
  }, []);

  const clearCanvas = useCallback(() => {
    inkingManagerRef.current?.clear();
  }, []);

  const pushScreenshot = useCallback((base64: string) => {
    const appState = appStateRef.current;
    if (!appState) {
      console.warn("[Markup] pushScreenshot: not connected yet");
      return;
    }
    appState.set("backgroundImage", base64);
    console.log("[Markup] Screenshot pushed to SharedMap");
  }, []);

  const clearBackground = useCallback(() => {
    const appState = appStateRef.current;
    if (!appState) return;
    appState.set("backgroundImage", "");
    setBackgroundImage(null);
    inkingManagerRef.current?.clear();
    console.log("[Markup] Background image and annotations cleared");
  }, []);

  // ── Power-user actions ─────────────────────────────────────────────────

  /** Drop a numbered breadcrumb pin at (xPct, yPct) position */
  const dropPin = useCallback((xPct: number, yPct: number) => {
    const appState = appStateRef.current;
    if (!appState) return;
    const current: BreadcrumbPin[] = (() => {
      const raw = appState.get<string>("pins");
      return raw ? JSON.parse(raw) : [];
    })();
    const next: BreadcrumbPin[] = [...current, { id: current.length + 1, xPct, yPct }];
    appState.set("pins", JSON.stringify(next));
    setPins(next);
    console.log("[Markup] Pin dropped:", next.length);
  }, []);

  /** Clear all breadcrumb pins */
  const clearPins = useCallback(() => {
    const appState = appStateRef.current;
    if (!appState) return;
    appState.set("pins", JSON.stringify([]));
    setPins([]);
    console.log("[Markup] Pins cleared");
  }, []);

  /** Send a ghost click ripple at (xPct, yPct) */
  const sendClick = useCallback((xPct: number, yPct: number) => {
    const appState = appStateRef.current;
    if (!appState) return;
    const click: ClickRipple = { xPct, yPct, ts: Date.now() };
    appState.set("lastClick", JSON.stringify(click));
    // Also add locally immediately
    setClickRipples((prev) => [...prev, click]);
    setTimeout(() => {
      setClickRipples((prev) => prev.filter((r) => r.ts !== click.ts));
    }, 2000);
  }, []);

  /** Set or clear the focus zone (synced to all participants) */
  const setFocusZone = useCallback((zone: FocusZone | null) => {
    const appState = appStateRef.current;
    if (!appState) return;
    appState.set("focusZone", zone ? JSON.stringify(zone) : "");
    setFocusZoneState(zone);
    console.log("[Markup] Focus zone:", zone ? "set" : "cleared");
  }, []);

  return {
    inkingManager,
    liveCanvas,
    backgroundImage,
    currentRole,
    isConnected,
    setTool,
    setColor,
    clearCanvas,
    clearBackground,
    pushScreenshot,
    // ── Power-user features ──────────────────────────────────────────
    pins,
    dropPin,
    clearPins,
    clickRipples,
    sendClick,
    focusZone,
    setFocusZone,
    canvasHostRef,
  };
}
