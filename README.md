# chaos-board

An infinite canvas workspace for building with AI agents — forked from [Collaborator](https://github.com/collaborator-ai/collab-public) and extended with spatial organization, drawing tools, and Miro-inspired canvas features.

> **Origin:** This project is an enhanced fork of [Collaborator](https://github.com/collaborator-ai/collab-public) (`@collaborator/electron`). Collaborator provides the core architecture — Electron shell, multi-webview terminal system, file tree navigator, and canvas tile engine. chaos-board builds on top of that foundation with zone-based spatial organization, shape/connector tools, pen drawing, and workflow features described below.

Terminals, context files, browsers, shapes, and drawings — all arranged on an infinite canvas. No context switching, no tab hunting. Just your agents and your work, side by side.

The app is early-stage and in active development. macOS only for now.

## What chaos-board adds to Collaborator

### Spatial Organization
- **7 canvas zones** — STIMULUS / WILL / SUPPLY (work), REFLECT (shared), PLAY / LEARN / LIFE (life) — color-coded areas that give spatial meaning to where you place tiles
- **Zone summaries** — each zone displays a live count of contained tiles by type
- **REFLECT date lines** — horizontal time markers in the center zone for temporal awareness
- **Tile temperature** — recently active tiles glow subtly, giving visual pulse to your workspace
- **Jump to zone** (Cmd+J) — quick navigation with auto-zoom to fit the zone in view
- **Search tiles** (Cmd+K / right-click) — find and jump to any tile by name

### Miro-style Canvas Tools
- **Shape tiles** (S key / right-click) — rectangle, circle, diamond, triangle, arrow, line with inline text editing, color picker, and resize
- **Connectors** — drag from tile edge handles to create bezier curves with arrowheads between any tiles; right-click to delete or toggle straight/bezier
- **Sticky notes** (N key) — text tiles with font size controls
- **Image paste** — Cmd+V to paste clipboard images directly onto the canvas
- **Pen/draw mode** (P key) — freehand drawing overlay with pressure-sensitive brush and eraser
- **Marquee select + delete** — Shift+drag in eraser mode to select and delete pen strokes

### Workflow & Navigation
- **Bottom dock toolbar** — always-visible Miro-style toolbar for quick tool switching (V/T/N/W/S/P/E)
- **Copy/paste tiles** (Cmd+C / Cmd+V) — with offset stacking; terminal tiles paste as new sessions
- **Auto-layout** (Cmd+Shift+A) — batch tile arrangement
- **Tile groups** (Cmd+G / Cmd+Shift+G) — group and ungroup tiles
- **Zoom shortcuts** — Cmd+=/- to zoom, Cmd+0 to reset, pinch-to-zoom on trackpad
- **Zone keys** (1-7) — jump directly to any zone
- **Terminal naming** — double-click title to rename terminal sessions
- **Keyboard shortcuts modal** (?) — full shortcut reference

### Technical
- **Tile content API** — programmatic access to tile content for AI agent use via canvas skill
- **Connection persistence** — connectors, groups, pen strokes all saved/restored with canvas state

## Install

Clone and run locally:

```sh
git clone https://github.com/onoz1169/chaos-board.git
cd chaos-board/collab-electron
bun install
bun run dev
```

## Stack

Built on Collaborator's architecture:

- **Electron 40** — desktop shell with multi-webview architecture
- **React 19** — UI framework (navigator, components)
- **Tailwind CSS 4** — styling
- **electron-vite** — build tooling with hot reload
- **xterm.js** — terminal emulation, backed by tmux sessions for persistence
- **Monaco Editor** — code editing with syntax highlighting
- **BlockNote / TipTap** — rich text markdown editing
- **D3** — force-directed graph visualization
- **sharp** — image processing
- **KaTeX** — math rendering in markdown

All data is stored locally on disk (`~/.collaborator/`). No accounts required.

## Quickstart

1. Open chaos-board
2. Add a workspace — click the workspace dropdown or press Cmd+Shift+O
3. Double-click the canvas to create a terminal, and start an agent
4. Right-click the canvas to add shapes, sticky notes, browsers, or more terminals
5. Drag from tile edges to connect tiles with arrows
6. Press P to draw, S to add shapes, 1-7 to jump between zones

## Tile Types

| Type | Key | Description |
|------|-----|-------------|
| Terminal | T / double-click | Interactive terminal session (tmux-backed) |
| Sticky Note | N | Text tile with font controls |
| Browser | W | Embedded web browser |
| Shape | S / right-click | Geometric shapes with text (rect, circle, diamond, triangle, arrow, line) |
| Note | drag .md file | Rich markdown editor |
| Code | drag file | Syntax-highlighted code editor |
| Image | drag image / Cmd+V | Image display |

## Canvas Zones

```
┌──────────┐ ┌──────────┐ ┌──────────┐
│ STIMULUS │ │   WILL   │ │  SUPPLY  │   Work
│  (blue)  │ │ (green)  │ │  (red)   │
└──────────┘ └──────────┘ └──────────┘
             ┌──────────┐
             │ REFLECT  │              Shared
             │  (gold)  │
             └──────────┘
┌──────────┐ ┌──────────┐ ┌──────────┐
│   PLAY   │ │  LEARN   │ │   LIFE   │   Life
│ (orange) │ │ (purple) │ │  (pink)  │
└──────────┘ └──────────┘ └──────────┘
```

Zones provide spatial meaning without imposing structure. Place tiles freely — the zones are guides, not containers.

## Credits

- **Collaborator** ([collaborator-ai/collab-public](https://github.com/collaborator-ai/collab-public)) — the original Electron canvas workspace that provides the core architecture for this project
- Built with [Claude Code](https://claude.ai/claude-code)

## License

FSL-1.1-ALv2 (inherited from Collaborator)
