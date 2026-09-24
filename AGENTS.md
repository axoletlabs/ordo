# Ordo agent rules

## Auto commit and push

If you're confident in a change, commit it. Always commit changes in small pieces whenever it makes sense. Always push to remote after committing.

Parallel agents may share this worktree. Only ever commit your own work from this session:
- Track the exact files you edited. Stage them by explicit path (`git add path/to/file`). Never use `git add -A`, `git add .`, or `git commit -a`.
- Before committing, run `git status --short` and `git diff --cached --name-only`. If anything is staged that you did not edit yourself, unstage it (`git restore --staged <path>`) and leave it alone.
- Never commit, stash, checkout, reset, revert, or clean changes you didn't make, including untracked files created by other agents.
- If a file contains both your changes and another agent's, commit only your own hunks (partial staging):
  - `git add -p <file>` and answer `y` only for your hunks (non-interactive shells can pipe answers: `printf 'y\nn\nq\n' | git add -p <file>`), or write a patch containing only your hunks and apply it to the index with `git apply --cached <patch>`.
  - Verify with `git diff --cached -- <file>` that the staged content is exactly your changes, then commit as usual. The other agent's hunks stay unstaged in the worktree, untouched.
  - Only skip the file if your hunks overlap or interleave with theirs and can't be separated cleanly; then leave it uncommitted and mention it in your final message instead.
- If push is rejected because the remote moved ahead, `git pull --rebase`, resolve only conflicts in files you touched, then push. Never force-push.

## UI screenshots

When a change can be seen on screen (layout, chrome, overlay, type, color, spacing, hover), do not finish with prose only. Capture the changed UI and **embed both shots in the reply** with markdown image syntax and absolute paths (`![portrait](/tmp/....png)`).

**Layouts** — ordo switches chrome at these sizes (`useResponsiveLayout`: side rail when landscape or web width ≥ 768):

- **Vertical** (portrait): `390×844` — bottom tabs
- **Horizontal** (landscape / wide): `1280×800` — side rail

Shoot **dark mode** (`themeMode: "dark"`, not system). Switch Appearance → Theme → Dark if the session is on light or system. Open the same state in both layouts (same screen, same overlay, same hover if that was the point). Wait until the UI has settled (menus fade in from opacity 0). Then screenshot.

Capture with `ui-shot` (never launch google-chrome directly — see `.cursor/rules/ui-screenshots.mdc`):

- `ui-shot http://localhost:8081 /tmp/ordo-portrait.png 390 844 --wait 2500`
- `ui-shot http://localhost:8081 /tmp/ordo-landscape.png 1280 800 --wait 2500`

Lightweight playwright headless-shell wrapper: single short-lived process that exits by itself. Prefer `preview_snapshot` (with `save: true`) when the tool is available in-session. If you cannot capture, say so and what you used instead.

A single portrait frame is not enough. Add a light-mode shot only when the change is specifically light-theme chrome.
