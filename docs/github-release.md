# GitHub Release Guide

This project is ready for a first public GitHub release.

## 1. Push the repository

```bash
cd /Users/apple/Documents/New\ project
git init
git add .
git commit -m "feat: initial public release"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 2. Create a tag

```bash
cd /Users/apple/Documents/New\ project
git tag v1.0.0
git push origin v1.0.0
```

## 3. Create the GitHub release

In GitHub:

- Open `Releases`
- Click `Draft a new release`
- Choose tag `v1.0.0`
- Title: `OpenClaw Agent Team Control v1.0.0`
- Copy the body from [release-v1.0.0.md](./release-v1.0.0.md)

## 4. Upload assets

Upload these files from [release](/Users/apple/Documents/New%20project/release):

- [OpenClaw Agent Team Control-1.0.0-arm64.dmg](/Users/apple/Documents/New%20project/release/OpenClaw%20Agent%20Team%20Control-1.0.0-arm64.dmg)
- [OpenClaw Agent Team Control-1.0.0-arm64.zip](/Users/apple/Documents/New%20project/release/OpenClaw%20Agent%20Team%20Control-1.0.0-arm64.zip)

Optional:

- blockmap files for updater workflows

## 5. Release notes template

```md
## Highlights

- Native macOS desktop control plane for OpenClaw agent operations
- Direct agent chat with model switching, attachments, history, and context
- Swarm management view for topology, tasks, nodes, and events
- One-click local OpenClaw bootstrap helper

## Notes

- Apple Silicon build
- Unsigned macOS app
- Right click -> Open may be required on first launch
```

## 6. Recommended repo settings

- Add a repository description
  - `Desktop control plane for OpenClaw agent teams on macOS`
- Add topics
  - `electron`
  - `react`
  - `openclaw`
  - `agent`
  - `desktop-app`
  - `macos`
- Set the website field later if you publish docs or a homepage
