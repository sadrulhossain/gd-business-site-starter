# media

Uploaded images of the site. **Never edit this folder by hand.**

The API writes these files: when an admin uploads an image, the Worker commits the original and its variants to this
folder through the GitHub API (branch `MEDIA_GIT_BRANCH`, default `main`). The deploy workflow copies the folder to
`/media/*` of the site, served with a long immutable cache. This file is not published.

- A media commit does not start a build by itself (`deploy.yml` ignores `media/**`); the API dispatches the build after its quiet period.
- To undo an upload, `git revert` the media commit and run the deploy workflow (docs/DEPLOY.md, Rollback).
- Limits: 20,000 files per deployment and 25 MiB per file on Cloudflare Free; `scripts/check-assets.mjs` fails the build at 80 percent and warns when this folder passes 500 MB.
