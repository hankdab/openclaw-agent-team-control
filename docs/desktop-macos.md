# Desktop App

## Run as a desktop app

```bash
cd /Users/apple/Documents/New\ project
npm install
npm run desktop
```

This will:

- build the frontend
- start the local backend if needed
- open a native Electron window on macOS

## Development run

```bash
cd /Users/apple/Documents/New\ project
npm run desktop:dev
```

`desktop:dev` assumes the renderer has already been built or a local server is already available on port `4317`.
