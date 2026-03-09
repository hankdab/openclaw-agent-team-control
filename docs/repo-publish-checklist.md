# Repository Publish Checklist

Use this before making the repository public.

## Metadata

- Confirm [README.md](./../README.md) is up to date
- Confirm [LICENSE](./../LICENSE) matches your intended open-source terms
- Confirm [CHANGELOG.md](./../CHANGELOG.md) includes the release version
- Confirm package version in [package.json](./../package.json)

## Security and local data

- Do not commit `.runtime/`
- Do not commit `release/`
- Do not commit `dist/`
- Do not commit private OpenClaw config or secrets
- Check screenshots or docs for machine-specific paths you do not want public

## Release assets

- Rebuild with `npm run dist:mac`
- Verify `.dmg` launches
- Verify `.zip` expands cleanly
- Verify the app opens on macOS via right click -> `Open`

## Repo hygiene

- Keep generated scratch directories out of version control
- Keep local experiments in ignored directories
- Update screenshots after major UI changes
- Keep docs in `docs/` and release notes versioned
