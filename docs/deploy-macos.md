# macOS Deployment

## One-off local run

```bash
cd /Users/apple/Documents/New\ project
npm install
npm run build
npm start
```

Open `http://localhost:4317`.

By default the console uses `OPENCLAW_CLUSTER_SOURCE=auto`:

- If local `openclaw` CLI and Gateway are available, it shows real data from this Mac.
- If not, it falls back to mock data so the UI still opens.

## Install as a LaunchAgent

```bash
cd /Users/apple/Documents/New\ project
chmod +x scripts/install_launch_agent.sh
./scripts/install_launch_agent.sh
```

Useful commands:

```bash
openclaw gateway status
openclaw gateway start
OPENCLAW_CLUSTER_SOURCE=mock npm start
OPENCLAW_CLUSTER_SOURCE=real npm start
launchctl list | grep ai.openclaw.cluster-console
launchctl unload ~/Library/LaunchAgents/ai.openclaw.cluster-console.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.cluster-console.plist
tail -f /Users/apple/Documents/New\ project/runtime/cluster-console.stdout.log
tail -f /Users/apple/Documents/New\ project/runtime/cluster-console.stderr.log
```

## Production notes

- The service listens on `PORT`, default `4317`.
- `npm start` serves the built frontend from `dist/` and the backend from `server/server.mjs`.
- The backend prefers real OpenClaw data via CLI/RPC polling and falls back to mock state when unavailable.
- Rebuild after frontend changes with `npm run build`.
