# Project skills and submodules

The project loads eight skills from seven upstream repositories.
Git records each repository at a specific commit. It does not follow the upstream branch automatically.

The files in [`.agents/skills/`](../.agents/skills/README.md) are short entry points.
The upstream instructions, references, scripts and licenses remain in `.agents/upstream/`.
This layout uses no symbolic links and works on Windows.
Both Rust skills share one submodule. The TypeScript submodule also contains its required principle skills.

## Initialize submodules

For a new checkout, clone the repository with submodules:

```sh
git clone --recurse-submodules https://github.com/rirko/better-woslicer.git
cd better-woslicer
```

For an existing checkout, run these commands from the repository root:

```sh
git submodule sync --recursive
git submodule update --init --recursive
```

Run the same commands after switching to a branch or commit that changes the submodule references.
Git checks out the commits recorded by the parent repository. Do not add `--remote` during normal setup.
Initialization can require network access. The application and its build do not load these skills.
A source ZIP from GitHub does not contain the submodule contents. Use a Git checkout to load the skills.

## Check the pinned versions

```sh
git submodule status --recursive
git diff --submodule=log
git submodule foreach --recursive 'git status --short'
```

The first command shows each recorded checkout:

- A leading space means the checkout matches the recorded commit.
- `-` means the submodule is not initialized.
- `+` means the checkout differs from the recorded commit.
- `U` means Git reports a merge conflict.

The final command shows local edits inside submodules.
A submodule does not prevent file edits. These checks make changes visible.
Do not edit upstream files for project-specific rules. Put those rules in the root [AGENTS.md](../AGENTS.md).

## Update one upstream skill

Update a submodule only as a deliberate maintenance change.
Check local edits before changing its commit. Preserve or resolve those edits first.

For example, update the English writing skill:

```sh
git -C .agents/upstream/asd-ste100 status --short
git -C .agents/upstream/asd-ste100 fetch origin
git -C .agents/upstream/asd-ste100 log --oneline --max-count=10 origin/HEAD
```

Inspect the candidate skill instructions and their references before choosing a commit.
Replace `<reviewed-commit>` below with its full commit ID:

```sh
git -C .agents/upstream/asd-ste100 checkout --detach <reviewed-commit>
git -C .agents/upstream/asd-ste100 submodule update --init --recursive
git diff --submodule=log -- .agents/upstream/asd-ste100
git add .agents/upstream/asd-ste100
```

Review the staged submodule change before committing it in the parent repository.
Keep the upstream content unchanged. Preserve the upstream license and notices.
Check the project entry point if the upstream moves its skill or reference files.

## Upstream sources

| Submodule | Repository | Skill location |
| --- | --- | --- |
| `maintainability-review` | [sgqy/maintainability-review](https://github.com/sgqy/maintainability-review) | `SKILL.md` |
| `asd-ste100` | [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill) | `SKILL.md` |
| `zh-tech-writing` | [leter/zh-tech-writing](https://github.com/leter/zh-tech-writing) | `skills/zh-tech-writing/SKILL.md` |
| `cursor-plugins` | [cursor/plugins](https://github.com/cursor/plugins) | `pstack/skills/typescript-best-practices/SKILL.md` |
| `vue-skills` | [vuejs-ai/skills](https://github.com/vuejs-ai/skills) | `skills/vue-best-practices/SKILL.md` |
| `beautiful-rust` | [morganlinton/BeautifulRust](https://github.com/morganlinton/BeautifulRust) | `skills/rust-best-practices/SKILL.md` and `skills/rust-review/SKILL.md` |
| `smell-check` | [Zhen-Bo/smell-check](https://github.com/Zhen-Bo/smell-check) | `SKILL.md` |

Use `git submodule status` for exact commit IDs. The Git index records these pins without a second version list.
