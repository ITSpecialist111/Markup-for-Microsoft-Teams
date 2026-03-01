// src/components/ConfigPage.tsx
//
// Required by Teams for configurable tabs.
// This is shown once when the app is first added to a meeting.
// It immediately marks the configuration as valid and saves.

import { useEffect } from "react";
import { pages } from "@microsoft/teams-js";

export function ConfigPage() {
  useEffect(() => {
    pages.config.registerOnSaveHandler((saveEvent) => {
      pages.config.setConfig({
        suggestedDisplayName: "Markup",
        contentUrl: `${window.location.origin}/?inTeams=1`,
        entityId: "markup-annotation-canvas",
      });
      saveEvent.notifySuccess();
    });

    // Mark configuration as valid immediately — no user input needed
    pages.config.setValidityState(true);
  }, []);

  return (
    <div style={styles.root}>
      <h2>✏️ Markup</h2>
      <p>Click <strong>Save</strong> to add the annotation canvas to this meeting.</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    fontFamily: "'Segoe UI', sans-serif",
    color: "#fff",
    background: "#2d2d2d",
    gap: 12,
    textAlign: "center",
    padding: 24,
  },
};
