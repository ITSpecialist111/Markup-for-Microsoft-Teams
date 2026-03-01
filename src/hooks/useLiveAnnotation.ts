// src/hooks/useLiveAnnotation.ts
//
// Core hook for the MarkUp annotation app.
//
// Live Share SDK features used:
//   - LiveCanvas:     real-time collaborative inking
//   - LivePresence:   user awareness & cursor tracking
//   - LiveEvent:      fire-and-forget notifications (clicks, attention requests)
//   - LiveState:      typed shared state for pins (role-gated)
//   - LiveTimer:      synchronised countdown timer
//   - LiveFollowMode: presenter / follower focus-zone control
//
// Architecture decisions (learned from debugging in Teams):
//   1. Do NOT pass allowedRoles to any DDS .initialize().
//      Role verification uses audience data that arrives late in Teams iframes,
//      silently blocking all input.
//   2. Role-gate at the UI layer instead.
//   3. All new DDS initialisation is wrapped in try/catch so the app still
//      works if a particular feature fails (graceful degradation).

import { useEffect, useRef, useState, useCallback } from "react";
import { app, LiveShareHost } from "@microsoft/teams-js";
import {
  LiveShareClient,
  UserMeetingRole,
  LivePresence,
  LiveEvent,
  LiveState,
  LiveTimer,
  LiveFollowMode,
} from "@microsoft/live-share";
import { InkingManager, InkingTool, LiveCanvas } from "@microsoft/live-share-canvas";
import { SharedMap } from "fluid-framework";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AnnotationRole = "annotator" | "presenter" | "viewer";

/** A numbered breadcrumb pin placed on the canvas */
export interface BreadcrumbPin {
  id: number;
  xPct: number;
  yPct: number;
  label?: string;
}

/** A ghost-click ripple event */
export interface ClickRipple {
  xPct: number;
  yPct: number;
  ts: number;
  senderName?: string;
  senderColor?: string;
}

/** A focus-zone crop rectangle */
export interface FocusZone {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  active: boolean;
}

/** Remote (or local) user presence record */
export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  cursor?: { xPct: number; yPct: number };
  role: AnnotationRole;
  isLocal: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESENCE_COLORS = [
  "#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#a855f7",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/** Format milliseconds as m:ss */
export function formatTimer(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Return type ─────────────────────────────────────────────────────────────

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
  // Power-user features
  pins: BreadcrumbPin[];
  dropPin: (xPct: number, yPct: number) => void;
  clearPins: () => void;
  clickRipples: ClickRipple[];
  sendClick: (xPct: number, yPct: number) => void;
  focusZone: FocusZone | null;
  setFocusZone: (zone: FocusZone | null) => void;
  canvasHostRef: React.RefObject<HTMLDivElement>;
  // ── Feature 1: LivePresence ──────────────────────────────────────────
  presenceUsers: PresenceUser[];
  updateCursor: (xPct: number, yPct: number) => void;
  localUserName: string;
  localUserColor: string;
  // ── Feature 2: LiveEvent — attention request ─────────────────────────
  sendAttentionRequest: () => void;
  lastAttentionRequest: { senderName: string; ts: number } | null;
  // ── Feature 3: LiveFollowMode ────────────────────────────────────────
  isPresenting: boolean;
  presenterName: string | null;
  isSuspended: boolean;
  startPresenting: () => void;
  stopPresenting: () => void;
  toggleSuspend: () => void;
  // ── Feature 5: LiveTimer ─────────────────────────────────────────────
  timerMilliRemaining: number;
  timerIsRunning: boolean;
  startTimer: (durationMs: number) => void;
  pauseTimer: () => void;
  playTimer: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLiveAnnotation(
  canvasHostRef: React.RefObject<HTMLDivElement>
): LiveAnnotationState {
  // ── Existing state ──────────────────────────────────────────────────────
  const [inkingManager, setInkingManager] = useState<InkingManager | null>(null);
  const [liveCanvas, setLiveCanvas] = useState<LiveCanvas | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<AnnotationRole>("viewer");
  const [isConnected, setIsConnected] = useState(false);
  const [pins, setPins] = useState<BreadcrumbPin[]>([]);
  const [clickRipples, setClickRipples] = useState<ClickRipple[]>([]);
  const [focusZone, setFocusZoneState] = useState<FocusZone | null>(null);

  // ── Feature 1: LivePresence state ───────────────────────────────────────
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [localUserName, setLocalUserName] = useState("Anonymous");
  const [localUserColor, setLocalUserColor] = useState(PRESENCE_COLORS[0]);

  // ── Feature 2: LiveEvent state ──────────────────────────────────────────
  const [lastAttentionRequest, setLastAttentionRequest] =
    useState<{ senderName: string; ts: number } | null>(null);

  // ── Feature 3: LiveFollowMode state ─────────────────────────────────────
  const [isPresenting, setIsPresenting] = useState(false);
  const [presenterName, setPresenterName] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);

  // ── Feature 5: Timer state (SharedMap-based) ───────────────────────────
  const [timerMilliRemaining, setTimerMilliRemaining] = useState(0);
  const [timerIsRunning, setTimerIsRunning] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────
  const inkingManagerRef = useRef<InkingManager | null>(null);
  const appStateRef = useRef<SharedMap | null>(null);
  const valueChangedHandlerRef = useRef<((changed: any) => void) | null>(null);

  const presenceRef = useRef<LivePresence | null>(null);
  const presenceMapRef = useRef(new Map<string, PresenceUser>());
  const liveEventRef = useRef<LiveEvent | null>(null);
  const pinStateRef = useRef<LiveState | null>(null);
  const followModeRef = useRef<LiveFollowMode | null>(null);

  // Timer refs (SharedMap-driven, not LiveTimer)
  const timerEndAtRef = useRef(0);   // epoch ms when timer expires
  const timerPausedRef = useRef(0);  // ms remaining when paused

  const localUserNameRef = useRef("Anonymous");
  const localUserColorRef = useRef(PRESENCE_COLORS[0]);
  const currentRoleRef = useRef<AnnotationRole>("viewer");

  // ── Main initialisation effect ──────────────────────────────────────────
  useEffect(() => {
    if (!canvasHostRef.current) return;
    let cancelled = false;

    async function init() {
      try {
        // ── 1. Determine host & user name ─────────────────────────────────
        let host: any;
        let userName = "Anonymous";

        try {
          await app.initialize();
          host = LiveShareHost.create();
          try {
            const ctx: any = await app.getContext();
            userName =
              ctx?.user?.displayName ||
              ctx?.userPrincipalName ||
              "Teams User";
          } catch { /* keep default */ }
          console.log("[Markup] Teams SDK initialised — LiveShareHost");
        } catch {
          const { TestLiveShareHost } = await import("@microsoft/live-share");
          host = TestLiveShareHost.create();
          userName = "Local User";
          console.log("[Markup] Outside Teams — TestLiveShareHost");
        }

        const colorIdx = Math.abs(hashCode(userName)) % PRESENCE_COLORS.length;
        const userColor = PRESENCE_COLORS[colorIdx];
        localUserNameRef.current = userName;
        localUserColorRef.current = userColor;
        if (!cancelled) {
          setLocalUserName(userName);
          setLocalUserColor(userColor);
        }

        // ── 2. Join the Fluid container ───────────────────────────────────
        const client = new LiveShareClient(host);

        const schema = {
          initialObjects: {
            liveCanvas: LiveCanvas,
            appState: SharedMap,
            presence: LivePresence,
            notifications: LiveEvent,
            pinState: LiveState,
            timer: LiveTimer,
            followMode: LiveFollowMode,
          },
        };

        console.log("[Markup] Joining container…");
        const { container, services } = await client.joinContainer(schema);
        if (cancelled) return;
        console.log("[Markup] Container joined");

        const {
          liveCanvas: lc,
          appState,
          presence,
          notifications,
          pinState,
          timer,
          followMode,
        } = container.initialObjects as {
          liveCanvas: LiveCanvas;
          appState: SharedMap;
          presence: LivePresence;
          notifications: LiveEvent;
          pinState: LiveState;
          timer: LiveTimer;
          followMode: LiveFollowMode;
        };

        // ── 3. InkingManager + LiveCanvas ─────────────────────────────────
        const hostEl = canvasHostRef.current!;
        const manager = new InkingManager(hostEl);
        await lc.initialize(manager);
        manager.activate();

        // ── 4. LivePresence ───────────────────────────────────────────────
        try {
          await (presence as any).initialize();
          presenceRef.current = presence;

          const refreshPresence = () => {
            if (cancelled) return;
            try {
              const all: PresenceUser[] = [];
              const users = (presence as any).getUsers
                ? (presence as any).getUsers()
                : [];
              for (const u of users) {
                const d = u.data || {};
                all.push({
                  userId: u.userId ?? "",
                  name: d.name || u.displayName || "Anonymous",
                  color: d.color || PRESENCE_COLORS[Math.abs(hashCode(u.userId || "")) % PRESENCE_COLORS.length],
                  cursor: d.cursor,
                  role: d.role || "viewer",
                  isLocal: !!u.isLocalUser,
                });
              }
              setPresenceUsers(all);
            } catch (err) {
              console.warn("[Markup] refreshPresence error:", err);
            }
          };

          // Attach listener BEFORE update() so we don't miss the first event
          (presence as any).on("presenceChanged", () => refreshPresence());

          // Publish local user presence
          await (presence as any).update({
            name: userName,
            color: userColor,
            role: "viewer", // updated after role resolution
          });

          // Populate roster immediately (catches anyone already in session)
          refreshPresence();

          console.log("[Markup] ✓ LivePresence initialised");
        } catch (err) {
          console.warn("[Markup] ✗ LivePresence:", err);
        }

        // ── 5. LiveEvent — clicks & attention ─────────────────────────────
        try {
          await (notifications as any).initialize();
          liveEventRef.current = notifications;

          (notifications as any).on(
            "received",
            (event: any, local: boolean) => {
              if (cancelled) return;
              if (event.type === "click") {
                const ripple: ClickRipple = {
                  xPct: event.xPct,
                  yPct: event.yPct,
                  ts: event.ts,
                  senderName: event.senderName,
                  senderColor: event.senderColor,
                };
                setClickRipples((p) => [...p, ripple]);
                setTimeout(() => {
                  setClickRipples((p) =>
                    p.filter((r) => r.ts !== ripple.ts)
                  );
                }, 2000);
              } else if (event.type === "attention") {
                setLastAttentionRequest({
                  senderName: event.senderName,
                  ts: event.ts,
                });
                setTimeout(() => {
                  setLastAttentionRequest((prev) =>
                    prev?.ts === event.ts ? null : prev
                  );
                }, 4000);
              }
            }
          );

          console.log("[Markup] ✓ LiveEvent initialised");
        } catch (err) {
          console.warn("[Markup] ✗ LiveEvent:", err);
        }

        // ── 6. LiveState (pins) ───────────────────────────────────────────
        try {
          await (pinState as any).initialize(JSON.stringify([]));
          pinStateRef.current = pinState;

          (pinState as any).on(
            "stateChanged",
            (value: any, _local: boolean) => {
              if (cancelled) return;
              try {
                const v = typeof value === "string" ? value : JSON.stringify(value);
                setPins(JSON.parse(v));
              } catch {
                setPins([]);
              }
            }
          );

          // Load existing
          try {
            const raw = (pinState as any).state;
            if (raw) {
              const parsed =
                typeof raw === "string" ? JSON.parse(raw) : raw;
              if (Array.isArray(parsed)) setPins(parsed);
            }
          } catch { /* empty */ }

          console.log("[Markup] ✓ LiveState (pins) initialised");
        } catch (err) {
          console.warn("[Markup] ✗ LiveState:", err);
        }

        // ── 7. Timer is SharedMap-based (see valueChanged handler below) ─
        //    LiveTimer is kept in the schema for container compat but not used.
        //    Timer keys: timer_endAt, timer_paused
        const existingEndAt = Number(appState.get<string>("timer_endAt") || "0");
        const existingPaused = Number(appState.get<string>("timer_paused") || "0");
        timerEndAtRef.current = existingEndAt;
        timerPausedRef.current = existingPaused;
        console.log("[Markup] ✓ Timer (SharedMap-based) ready");

        // ── 8. LiveFollowMode (focus zone) ────────────────────────────────
        try {
          await (followMode as any).initialize();
          followModeRef.current = followMode;

          (followMode as any).on(
            "stateChanged",
            (state: any, _local: boolean) => {
              if (cancelled) return;
              try {
                const val = state?.value ?? state;
                if (!val || val === "") {
                  setFocusZoneState(null);
                } else {
                  const zone =
                    typeof val === "string" ? JSON.parse(val) : val;
                  if (zone && typeof zone.xPct === "number") {
                    setFocusZoneState(zone as FocusZone);
                  } else {
                    setFocusZoneState(null);
                  }
                }
              } catch {
                setFocusZoneState(null);
              }
            }
          );

          (followMode as any).on(
            "presenterChanged",
            (presenter: any, _local: boolean) => {
              if (cancelled) return;
              if (presenter) {
                setPresenterName(
                  presenter.displayName ||
                  presenter.data?.name ||
                  presenter.userId ||
                  "Someone"
                );
                setIsPresenting(!!presenter.isLocalUser);
              } else {
                setPresenterName(null);
                setIsPresenting(false);
                setFocusZoneState(null);
              }
            }
          );

          console.log("[Markup] ✓ LiveFollowMode initialised");
        } catch (err) {
          console.warn("[Markup] ✗ LiveFollowMode:", err);
        }

        // ── 9. SharedMap: background + fallbacks ──────────────────────────
        const onValueChanged = (changed: any) => {
          if (cancelled) return;
          if (changed.key === "backgroundImage") {
            const img = appState.get<string>("backgroundImage");
            setBackgroundImage(img || null);
          }
          // Timer keys (SharedMap-based timer)
          if (changed.key === "timer_endAt") {
            timerEndAtRef.current = Number(appState.get<string>("timer_endAt") || "0");
          }
          if (changed.key === "timer_paused") {
            timerPausedRef.current = Number(appState.get<string>("timer_paused") || "0");
          }
          // Fallbacks when SDK DDS not available
          if (!followModeRef.current && changed.key === "focusZone") {
            const raw = appState.get<string>("focusZone");
            setFocusZoneState(raw ? JSON.parse(raw) : null);
          }
          if (!pinStateRef.current && changed.key === "pins") {
            const raw = appState.get<string>("pins");
            setPins(raw ? JSON.parse(raw) : []);
          }
          if (!liveEventRef.current && changed.key === "lastClick") {
            const raw = appState.get<string>("lastClick");
            if (raw) {
              const c: ClickRipple = JSON.parse(raw);
              setClickRipples((p) => [...p, c]);
              setTimeout(() => {
                setClickRipples((p) => p.filter((r) => r.ts !== c.ts));
              }, 2000);
            }
          }
        };
        appState.on("valueChanged", onValueChanged);
        valueChangedHandlerRef.current = onValueChanged;

        // Load existing background
        const existingImg = appState.get<string>("backgroundImage");
        if (existingImg) setBackgroundImage(existingImg);

        // Load existing pins (SharedMap fallback)
        if (!pinStateRef.current) {
          const existingPins = appState.get<string>("pins");
          if (existingPins) setPins(JSON.parse(existingPins));
        }

        // Load existing focus zone (SharedMap fallback)
        if (!followModeRef.current) {
          const existingFocus = appState.get<string>("focusZone");
          if (existingFocus) setFocusZoneState(JSON.parse(existingFocus));
        }

        // ── 10. Determine role ────────────────────────────────────────────
        const resolveRole = async (): Promise<AnnotationRole> => {
          try {
            let myself = services.audience.getMyself();
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
            console.warn("[Markup] Role check failed, defaulting to annotator:", err);
            return "annotator";
          }
        };

        const role = await resolveRole();
        if (cancelled) return;
        console.log("[Markup] Resolved role:", role);
        setCurrentRole(role);
        currentRoleRef.current = role;

        if (role === "viewer") {
          manager.deactivate();
          console.log("[Markup] InkingManager deactivated (viewer)");
        }

        // Update presence with resolved role
        try {
          presenceRef.current &&
            (presenceRef.current as any).update({
              name: userName,
              color: userColor,
              role,
            });
        } catch { /* ignore */ }

        // Re-check role on audience change
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
              const newRole: AnnotationRole = canAnnotate
                ? "annotator"
                : "viewer";
              if (!cancelled) {
                setCurrentRole(newRole);
                currentRoleRef.current = newRole;
                if (newRole === "annotator") {
                  manager.activate();
                } else {
                  manager.deactivate();
                }
                // Update presence with new role
                try {
                  presenceRef.current &&
                    (presenceRef.current as any).update({
                      name: userName,
                      color: userColor,
                      role: newRole,
                    });
                } catch { /* ignore */ }
              }
            }
          } catch { /* keep current role */ }
        });

        // ── 11. Store refs & mark connected ───────────────────────────────
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

  // ── Timer tick effect (SharedMap-based) ──────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const endAt = timerEndAtRef.current;
      const paused = timerPausedRef.current;
      if (endAt > 0) {
        const remaining = Math.max(0, endAt - Date.now());
        setTimerMilliRemaining(remaining);
        setTimerIsRunning(true);
        if (remaining === 0) {
          // Timer finished
          setTimerIsRunning(false);
          timerEndAtRef.current = 0;
        }
      } else if (paused > 0) {
        setTimerMilliRemaining(paused);
        setTimerIsRunning(false);
      } else {
        if (timerMilliRemaining !== 0) setTimerMilliRemaining(0);
        if (timerIsRunning) setTimerIsRunning(false);
      }
    }, 250);
    return () => clearInterval(id);
  });

  // ── Actions — existing ──────────────────────────────────────────────────

  const setTool = useCallback((tool: InkingTool) => {
    if (inkingManagerRef.current) inkingManagerRef.current.tool = tool;
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
    const s = appStateRef.current;
    if (!s) {
      console.warn("[Markup] pushScreenshot: not connected");
      return;
    }
    s.set("backgroundImage", base64);
  }, []);

  const clearBackground = useCallback(() => {
    const s = appStateRef.current;
    if (!s) return;
    s.set("backgroundImage", "");
    setBackgroundImage(null);
    inkingManagerRef.current?.clear();
  }, []);

  // ── Actions — pins (via LiveState with SharedMap fallback) ──────────────

  const dropPin = useCallback((xPct: number, yPct: number) => {
    let current: BreadcrumbPin[] = [];

    if (pinStateRef.current) {
      try {
        const raw = (pinStateRef.current as any).state;
        current = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
      } catch { current = []; }
    } else {
      const raw = appStateRef.current?.get<string>("pins");
      current = raw ? JSON.parse(raw) : [];
    }

    const next: BreadcrumbPin[] = [
      ...current,
      { id: current.length + 1, xPct, yPct },
    ];

    if (pinStateRef.current) {
      (pinStateRef.current as any).set(JSON.stringify(next));
    } else {
      appStateRef.current?.set("pins", JSON.stringify(next));
    }
    setPins(next);
  }, []);

  const clearPins = useCallback(() => {
    if (pinStateRef.current) {
      (pinStateRef.current as any).set(JSON.stringify([]));
    } else {
      appStateRef.current?.set("pins", JSON.stringify([]));
    }
    setPins([]);
  }, []);

  // ── Actions — ghost click (via LiveEvent with SharedMap fallback) ───────

  const sendClick = useCallback((xPct: number, yPct: number) => {
    const click: ClickRipple = {
      xPct,
      yPct,
      ts: Date.now(),
      senderName: localUserNameRef.current,
      senderColor: localUserColorRef.current,
    };

    if (liveEventRef.current) {
      (liveEventRef.current as any).send({ type: "click", ...click });
    } else {
      appStateRef.current?.set("lastClick", JSON.stringify(click));
    }

    // Local immediate add
    setClickRipples((p) => [...p, click]);
    setTimeout(() => {
      setClickRipples((p) => p.filter((r) => r.ts !== click.ts));
    }, 2000);
  }, []);

  // ── Actions — focus zone (via LiveFollowMode with SharedMap fallback) ───

  const setFocusZone = useCallback((zone: FocusZone | null) => {
    if (followModeRef.current) {
      try {
        if (zone) {
          (followModeRef.current as any).update(JSON.stringify(zone));
          (followModeRef.current as any).startPresenting();
        } else {
          (followModeRef.current as any).stopPresenting();
        }
      } catch (err) {
        console.warn("[Markup] LiveFollowMode update failed:", err);
        // Fallback
        appStateRef.current?.set(
          "focusZone",
          zone ? JSON.stringify(zone) : ""
        );
      }
    } else {
      appStateRef.current?.set(
        "focusZone",
        zone ? JSON.stringify(zone) : ""
      );
    }
    setFocusZoneState(zone);
  }, []);

  // ── Feature 1: cursor presence ──────────────────────────────────────────

  const updateCursor = useCallback((xPct: number, yPct: number) => {
    const p = presenceRef.current;
    if (!p) return;
    try {
      (p as any).update({
        name: localUserNameRef.current,
        color: localUserColorRef.current,
        role: currentRoleRef.current,
        cursor: xPct >= 0 ? { xPct, yPct } : undefined,
      });
    } catch { /* ignore */ }
  }, []);

  // ── Feature 2: attention request ────────────────────────────────────────

  const sendAttentionRequest = useCallback(() => {
    if (!liveEventRef.current) return;
    try {
      (liveEventRef.current as any).send({
        type: "attention",
        senderName: localUserNameRef.current,
        ts: Date.now(),
      });
    } catch { /* ignore */ }
  }, []);

  // ── Feature 3: follow-mode controls ─────────────────────────────────────

  const startPresenting = useCallback(() => {
    if (!followModeRef.current) return;
    try {
      (followModeRef.current as any).startPresenting();
      setIsPresenting(true);
    } catch (err) {
      console.warn("[Markup] startPresenting:", err);
    }
  }, []);

  const stopPresenting = useCallback(() => {
    if (!followModeRef.current) return;
    try {
      (followModeRef.current as any).stopPresenting();
      setIsPresenting(false);
      setFocusZoneState(null);
    } catch (err) {
      console.warn("[Markup] stopPresenting:", err);
    }
  }, []);

  const toggleSuspend = useCallback(() => {
    if (!followModeRef.current) return;
    try {
      if (isSuspended) {
        (followModeRef.current as any).endSuspension();
        setIsSuspended(false);
      } else {
        (followModeRef.current as any).beginSuspension();
        setIsSuspended(true);
      }
    } catch (err) {
      console.warn("[Markup] toggleSuspend:", err);
    }
  }, [isSuspended]);

  // ── Feature 5: timer controls (SharedMap-based) ────────────────────────

  const startTimer = useCallback((durationMs: number) => {
    const s = appStateRef.current;
    if (!s) return;
    const endAt = Date.now() + durationMs;
    s.set("timer_endAt", String(endAt));
    s.set("timer_paused", "");
    timerEndAtRef.current = endAt;
    timerPausedRef.current = 0;
    console.log("[Markup] Timer started:", durationMs, "ms");
  }, []);

  const pauseTimer = useCallback(() => {
    const s = appStateRef.current;
    if (!s) return;
    const endAt = timerEndAtRef.current;
    if (endAt <= 0) return;
    const remaining = Math.max(0, endAt - Date.now());
    s.set("timer_paused", String(remaining));
    s.set("timer_endAt", "");
    timerEndAtRef.current = 0;
    timerPausedRef.current = remaining;
    console.log("[Markup] Timer paused:", remaining, "ms remaining");
  }, []);

  const playTimer = useCallback(() => {
    const s = appStateRef.current;
    if (!s) return;
    const remaining = timerPausedRef.current;
    if (remaining <= 0) return;
    const endAt = Date.now() + remaining;
    s.set("timer_endAt", String(endAt));
    s.set("timer_paused", "");
    timerEndAtRef.current = endAt;
    timerPausedRef.current = 0;
    console.log("[Markup] Timer resumed:", remaining, "ms remaining");
  }, []);

  // ── Return ──────────────────────────────────────────────────────────────

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
    pins,
    dropPin,
    clearPins,
    clickRipples,
    sendClick,
    focusZone,
    setFocusZone,
    canvasHostRef,
    // Feature 1
    presenceUsers,
    updateCursor,
    localUserName,
    localUserColor,
    // Feature 2
    sendAttentionRequest,
    lastAttentionRequest,
    // Feature 3
    isPresenting,
    presenterName,
    isSuspended,
    startPresenting,
    stopPresenting,
    toggleSuspend,
    // Feature 5
    timerMilliRemaining,
    timerIsRunning,
    startTimer,
    pauseTimer,
    playTimer,
  };
}
