# Contributing to MarkUp for Teams

Thanks for your interest in contributing! This document outlines how to get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/<your-org>/markup-for-teams.git
   cd markup-for-teams
   ```

2. **Install dependencies**
   ```bash
   npm install --legacy-peer-deps
   ```

3. **Start the dev server**
   ```bash
   npm start
   ```
   The app runs at `http://localhost:3000`. Outside of Teams, it falls back to `TestLiveShareHost` so you can test the UI locally.

4. **Test in Teams**
   - Create a [dev tunnel](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) for HTTPS
   - Update `manifest/manifest.json` with your tunnel domain
   - Package and sideload (see README for details)

## Project Overview

| File | Purpose |
|---|---|
| `src/hooks/useLiveAnnotation.ts` | Core hook — Live Share connection, SharedMap sync, all actions |
| `src/components/MeetingStage.tsx` | Full-screen stage with canvas, toolbars, pins, focus zone, export |
| `src/components/AnnotationToolbar.tsx` | Drawing tool buttons |
| `src/components/ScreenCaptureButton.tsx` | Screen capture / upload / paste |
| `src/components/SidePanel.tsx` | Side panel with Share to Stage button |
| `public/capture.html` | Popup window for screen capture outside the Teams iframe |

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** — keep commits focused and well-described.

3. **Test in Teams** — the app behaves differently inside the Teams iframe vs localhost. Always test in a real Teams meeting before submitting.

4. **Build and verify**:
   ```bash
   npm run build
   ```
   Ensure the build succeeds with no TypeScript errors.

5. **Submit a pull request** with a clear description of what changed and why.

## Code Style

- **TypeScript** — all source files use TypeScript with strict mode enabled
- **Functional components** — React functional components with hooks, no class components
- **Design tokens** — use the shared `GLASS`, `ACCENT`, `RADIUS` tokens for UI consistency
- **SVG icons** — inline SVG path data, no icon libraries
- **No external CSS** — all styles are inline via React's `style` prop

## Important SDK Notes

Before contributing, read the [Lessons Learned](README.md#lessons-learned) section in the README. Key points:

- Do **not** pass `allowedRoles` to `LiveCanvas.initialize()` — it silently breaks drawing
- `getMyself()` returns `undefined` until audience sync; wait for `membersChanged`
- `getDisplayMedia()` is blocked in the Teams iframe — use the popup helper
- InkingManager canvases swallow pointer events — use the interaction overlay pattern

## Reporting Issues

When opening an issue, please include:

- What you were trying to do
- What happened instead
- Whether it's in Teams or localhost
- Browser and Teams client version (desktop vs web)
- Console log output (filter for `[Markup]` entries)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
