# Development workflow

## Start a task

Treat `main` as the integration branch. Use a dedicated branch and worktree for each task, including documentation and configuration changes. Keep worktrees in this repository under `.worktrees/`; the primary checkout stays on `main`. Before starting, inspect `git status`, `git worktree list`, and the branch you intend to use. Preserve any pre-existing edits: if the primary checkout is dirty, leave those files alone and ask the user how to handle them if the task requires touching them. Update `main` from the remote with `git pull --ff-only` only when its checkout is clean. Never reset or stash another person's work to prepare a task.

From the primary checkout, create a short, task-specific branch from the current `main`:

```sh
git worktree add .worktrees/<task-name> -b <task-branch> main
```

For an existing task branch that is not already checked out, attach it with `git worktree add .worktrees/<task-name> <task-branch>` instead. Resume an existing worktree only for its own task. Do implementation, verification, and commits from that task's worktree. Keep unrelated work out of its commits.

## Deliver

Run the applicable checks from `package.json` locally, review the diff against the request, and commit the task's changes on its branch. All applicable checks must pass before merging into `main`. Pull requests are optional; local merges and pushes to `main` are allowed.

From the clean primary checkout, update `main` with `git pull --ff-only`, then merge the task branch locally and push:

```sh
git merge --ff-only <task-branch>
git push origin main
```

If the task branch has diverged from `main`, merge the updated `main` into the task branch from its worktree, resolve any conflicts, and rerun the applicable checks locally before retrying delivery. Keep task changes on their task branch until verification passes.

Report the purpose, verification results, and any remaining risks to the user. If the work is not merged and pushed yet, leave its branch and worktree intact for continuation, and tell the user where it lives. If a push is rejected by remote protection, report the blocker rather than bypassing it or force-pushing.

## Clean up after merge

Once the task is merged into `main` and pushed, check that the task worktree contains no uncommitted changes. Preserve unexpected edits and ask before removing anything. Then, from the primary checkout:

```sh
git worktree remove .worktrees/<task-name>
git worktree prune
git branch -d <task-branch>
```

Remove task-generated artifacts when delivery and review are complete, including screenshots, recordings, comparison galleries, throwaway scripts, logs, test databases, and temporary build or test output, whether inside the repository or elsewhere such as `/tmp`. Stop task-owned preview servers and other temporary processes. Limit cleanup to artifacts and processes known to belong to the task; preserve shared resources, other agents' work, committed fixtures, and intended deliverables. Retain artifacts still needed for review or explicitly requested by the user, report their locations and why they remain, and remove them once that need ends. User-provided files, including uploaded recordings, require explicit permission before deletion. Before declaring cleanup complete, verify that no task-owned temporary processes or unneeded generated artifacts remain.

Delete the remote task branch if one was published. With a clean primary checkout, fast-forward `main` from the remote before starting the next task. Confirm `git worktree list`, `git branch`, and `git status` show no leftover task worktree, branch, or uncommitted task files. Never force-remove a worktree or force-delete an unmerged branch as routine cleanup.
