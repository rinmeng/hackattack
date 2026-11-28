# GitHub setup

One-time settings for CI, the agent reviewer and the coding agent. A repo admin does these.

## Workflows

| Workflow       | Starts on                                | Does                                                                               |
| -------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `CI`           | every PR and push to `main`              | format, lint, typecheck; build and `db-types` only when the change can affect them |
| `agent-review` | ready PRs, `/review`, `review:request`   | Claude approves the PR or requests changes                                         |
| `agent-build`  | `agent-queue` label, manual run, nightly | Claude builds an `agent-ready:<username>` issue and opens a draft PR for them      |
| `pr-hygiene`   | PR opened or edited                      | branch prefix and Conventional Commit title                                        |
| `labels`       | `.github/labels.json` changes on `main`  | creates and updates the labels                                                     |

## Secrets and variables

Settings → Secrets and variables → Actions.

| Name                      | Kind     | What it is                                                                                                        |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret   | From `claude setup-token`. Runs count against that subscription's usage limits.                                   |
| `GH_PAT`                  | secret   | Fine-grained token for this repo only: Contents, Pull requests, Issues = read and write. Lets agent PRs start CI. |
| `ENABLE_AGENTS`           | variable | `true` turns both agents on. Anything else: they stay off and the review gate passes without them.                |
| `ENABLE_NIGHTLY`          | variable | `true` lets `agent-build` pick one ready issue each night (10:17 UTC).                                            |

## Settings

1. **Actions → General → Workflow permissions**: "Read repository contents" (each job asks for
   more itself), and tick **Allow GitHub Actions to create and approve pull requests**. Without
   that tick the reviewer can only comment, not approve.
2. **Actions → General → Fork pull request workflows**: require approval for all outside
   collaborators.
3. **Rules → Rulesets → main**:
   - Require a pull request, 1 approval, and dismiss stale approvals on new commits.
   - Require review from Code Owners (`.github/CODEOWNERS`: workflow changes need the owner).
   - Required status checks: `ci` and `agent-review`.
   - Block force pushes.

## Labels

Run the `labels` workflow once (Actions → labels → Run workflow). When someone joins the team, add
an `agent-ready:<their username>` entry to `.github/labels.json`.

- `agent-ready:<username>`: the issue is ready for the agent, and that person owns it. They get the
  PR assigned and a review request. Adding it starts nothing.
- `agent-queue`: build it now (adding the label starts the run). The issue needs exactly one
  `agent-ready:<username>` label, must be opened by someone with write access, and the label must
  be added by someone with write access. A manual run with no issue number takes the lowest
  `agent-queue` issue.
- `agent-night`: only the nightly run picks it up (needs `ENABLE_NIGHTLY=true`).
- Queue labels stay on the issue until its PR opens, then are removed. To retry, remove
  `agent-queue` and add it again.
- `agent`: set on PRs the agent opened.
- `needs-human`, `blocked`: the agent skips the issue.
- `review:pass`, `review:changes`: set by the reviewer. `review:request`, `review:rerequest`: ask
  for a (re-)review; removed when the run starts.

## How a PR moves

1. Someone, or the agent, opens a PR. Agent PRs start as drafts assigned to their owner.
2. When the PR is ready for review, `agent-review` runs. Claude reads the PR as plain files
   (no write token, no shell) and posts an **Approve** or **Request changes** review.
3. After fixing, comment `/rereview`. A new approval replaces the earlier request for changes.
4. A person merges once `ci` and `agent-review` are green and the approvals are in.
