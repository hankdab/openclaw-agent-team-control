# Changelog

## 1.0.0 - 2026-03-09

Initial public desktop release of OpenClaw Agent Team Control.

### Added

- Electron-based macOS desktop shell for local OpenClaw operations
- Home workspace for direct agent chat
- Sidebar agent session list with collaboration-oriented layout
- Attachment selection, upload, preview, and in-chat file cards
- Conversation history, auto-scroll, jump-to-bottom, and context panel
- Cluster management view with topology, tasks, workflows, nodes, and events
- Local OpenClaw bootstrap helper with dependency checks
- Real OpenClaw provider with mock fallback mode
- macOS packaging via `.app`, `.dmg`, and `.zip`

### Changed

- Unified product naming to `OpenClaw Agent Team Control`
- Refined desktop UI, sidebar layout, brand area, and translucent background treatment
- Moved composer controls into the chat input area

### Notes

- The macOS build is currently unsigned
- Local OpenClaw runtime availability affects whether the app runs in `real` or `mock` mode
