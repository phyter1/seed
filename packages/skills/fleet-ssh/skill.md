---
name: fleet-ssh
description: Escape hatch for running commands on fleet machines via SSH when the seed CLI doesn't cover the operation.
category: identity
invocable: false
argument-hint: <machine> <command> | all <command>
capabilities:
  - shell
---

# Fleet SSH

> **Prefer `seed fleet` commands over SSH.** This skill is a last-resort escape hatch for operations not covered by the seed CLI. Before using this skill, check if `seed fleet --help` has a command that does what you need.

Execute commands across the fleet via SSH. Use this for arbitrary shell commands that the seed CLI doesn't have a typed command for — things like checking process lists, reading logs, managing launchd services, or running ad-hoc diagnostics.

## Arguments

`$ARGUMENTS` format: `<target> <command>`

- `ren1 <cmd>` — run on ren1
- `ren2 <cmd>` — run on ren2
- `ren3 <cmd>` — run on ren3
- `all <cmd>` — run on ren1, ren2, and ren3 in parallel

## Machine Access

SSH works via ssh-agent with the default key. The connection is the same for all machines:

| Target | SSH Command |
|--------|-------------|
| ren1 | `ssh ryanlowe@ren1.local '<cmd>' 2>&1` |
| ren2 | `ssh ryanlowe@ren2.local '<cmd>' 2>&1` |
| ren3 | `ssh ryanlowe@ren3.local '<cmd>' 2>&1` |

If on the target machine already (check `hostname`), just run the command locally.

## Execution

### Single machine

Parse the target and command from `$ARGUMENTS`. SSH in and run it. Use a 30-second timeout.

### All machines

Run the command on all three machines **in parallel** using separate Bash tool calls. Prefix each output with the machine name.

## Safety

- **Read-only commands** (ls, cat, ps, curl, git status, etc.): run without confirmation
- **Write commands** (rm, git push, service restart, etc.): confirm with the user first
- **Sudo commands**: will fail remotely unless the user's SSH session has passwordless sudo configured. Warn the user.
- Never run destructive commands (rm -rf, reset --hard, etc.) without explicit user confirmation.

## Examples

- `ren1 uptime` — check ren1 uptime
- `all git -C ~/code/existential pull` — pull existential on all machines
- `ren2 launchctl list | grep ren` — check services on ren2
- `all ps -eo %cpu,%mem,comm -r | head -5` — top processes on all machines
