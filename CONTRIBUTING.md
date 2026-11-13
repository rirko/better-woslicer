# Contributing

## Branches and pull requests

| Work | Start from | Merge route |
| --- | --- | --- |
| Hotfix | `main` | `hotfix/*` → `main` → `dev` |
| Feature | `dev` | `feature/*` → `dev` → `main` |

For a hotfix, open a PR against `main`. After that PR merges, merge `main` into `dev` through a separate PR.
Use this route for CI and release maintenance that must reach `main` before the next feature release.

For a feature, open a PR against `dev`. Merge `dev` into `main` through a release PR when the changes are ready.

## External contributions

Start external contributions from `dev`. Open the PR against this repository's `dev` branch, including when an agent prepares the contribution.
External contributors can use any source branch name. Check the PR base explicitly because GitHub can select the default branch, `main`.

Maintainers manually change existing external PRs to target `dev` when necessary. No workflow automatically changes their target branches.

## Checks and review

Follow the compatibility and product constraints in [AGENTS.md](AGENTS.md).
Use the [development guide](docs/DEVELOPMENT.md) for setup and validation.
Describe the observable change and the checks you ran in the PR.
Agents need explicit authorization before pushing, merging or publishing.
