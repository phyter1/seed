---
name: fleet-ssh
description: Run a command on one or all fleet machines via SSH. Use for remote management, deployments, or distributed tasks.
argument-hint: <machine> <command> | all <command>
allowed-tools: Bash
---

# Fleet SSH

Execute commands across the Ren fleet. Handles SSH key differences between machines automatically.

## Arguments

`$ARGUMENTS` format: `<target> <command>`

- `machine1 <cmd>` — run on machine1
- `machine2 <cmd>` — run on machine2
- `machine3 <cmd>` — run on machine3
- `all <cmd>` — run on machine1, machine2, and machine3 in parallel

## Machine Access

| Target | SSH Command |
|--------|-------------|
| machine1 | `ssh -i ~/.ssh/fleet_key $USER@$MACHINE1 '<cmd>' 2>&1 \|\| ssh $USER@$MACHINE1 '<cmd>' 2>&1` |
| machine2 | `ssh -i ~/.ssh/fleet_key $USER@$MACHINE2 '<cmd>' 2>&1 \|\| ssh $USER@$MACHINE2 '<cmd>' 2>&1` |
| machine3 | `ssh $USER@$MACHINE3 '<cmd>' 2>&1` |

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

- `machine1 uptime` — check machine1 uptime
- `all git -C ~/code/existential pull` — pull existential on all machines
- `machine2 launchctl list | grep ren` — check services on machine2
- `all ps -eo %cpu,%mem,comm -r | head -5` — top processes on all machines
