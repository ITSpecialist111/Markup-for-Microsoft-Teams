// src/App.tsx
// Entry point — initialises Teams JS SDK, detects frame context,
// then routes to the correct view (side panel vs meeting stage)

import { useEffect, useState } from "react";
import { app, FrameContexts } from "@microsoft/teams-js";
import { SidePanel } from "./components/SidePanel";
import { MeetingStage } from "./components/MeetingStage";
import { ConfigPage } from "./components/ConfigPage";

type AppView = "loading" | "config" | "sidePanel" | "meetingStage" | "unsupported";

export default function App() {
  const [view, setView] = useState<AppView>("loading");

  useEffect(() => {
    // Initialize the Teams JS SDK — MUST be called before any other SDK calls
    app.initialize().then(() => {
      // Notify Teams the app has loaded (required by desktop client)
      app.notifyAppLoaded();
      app.notifySuccess();
      app.getContext().then((ctx) => {
        switch (ctx.page?.frameContext) {
          case FrameContexts.sidePanel:
            setView("sidePanel");
            break;
          case FrameContexts.meetingStage:
            setView("meetingStage");
            break;
          case FrameContexts.settings:
            setView("config");
            break;
          default:
            setView("unsupported");
        }
      });
    }).catch(() => {
      // Running locally outside Teams — use test host
      setView("meetingStage");
    });
  }, []);

  if (view === "loading") return <div className="loading">Connecting to meeting…</div>;
  if (view === "config") return <ConfigPage />;
  if (view === "sidePanel") return <SidePanel />;
  if (view === "meetingStage") return <MeetingStage />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'rgba(255,255,255,0.5)', fontSize: 14, fontFamily: "'Segoe UI', sans-serif" }}>
      This app only runs inside a Teams meeting.
    </div>
  );
}
