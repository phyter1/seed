# Fleet SSH

Cross-machine SSH enables your agent to coordinate work across multiple physical machines.

## Setup

### 1. Generate a dedicated key pair

Create a key pair specifically for fleet communication. Do not reuse personal keys.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/fleet_machine -C "fleet-machine-key" -N ""
```

### 2. Distribute the public key

Copy the public key to each machine in your fleet:

```bash
ssh-copy-id -i ~/.ssh/fleet_machine.pub user@machine-1.local
ssh-copy-id -i ~/.ssh/fleet_machine.pub user@machine-2.local
```

### 3. Configure SSH aliases (optional but recommended)

Add entries to `~/.ssh/config` for convenient access:

```
Host machine-1
  HostName machine-1.local
  User your-username
  IdentityFile ~/.ssh/fleet_machine

Host machine-2
  HostName machine-2.local
  User your-username
  IdentityFile ~/.ssh/fleet_machine
```

Then you can connect with just `ssh machine-1`.

### 4. Test connectivity

```bash
ssh -i ~/.ssh/fleet_machine user@machine-1.local 'hostname && uname -a'
ssh -i ~/.ssh/fleet_machine user@machine-2.local 'hostname && uname -a'
```

## Usage Patterns

### Run a command on a remote machine

```bash
ssh machine-1 'cd /path/to/repo && git pull'
```

### Check service status remotely

```bash
ssh machine-1 'curl -s http://localhost:11434/api/tags'  # Ollama models
ssh machine-2 'launchctl list | grep com.seed'           # launchd services
```

### Copy files between machines

```bash
scp -i ~/.ssh/fleet_machine file.txt user@machine-2.local:/path/to/dest/
rsync -avz -e "ssh -i ~/.ssh/fleet_machine" ./dir/ user@machine-2.local:/path/to/dir/
```

### Run heartbeat status from a different machine

```bash
ssh machine-1 'cd /path/to/seed && bash packages/heartbeat/pulse.sh status'
```

## Security Notes

- The fleet key should have no passphrase (required for automated/daemon use).
- Restrict the key to specific commands if possible using `command=` in `authorized_keys`.
- Each machine should have the same username for simplicity, but this is not required.
- Keep the private key (`~/.ssh/fleet_machine`) on machines that need to initiate connections. Not every machine needs it.

## Troubleshooting

- **Connection refused:** Ensure `sshd` is running on the target machine. On macOS, enable "Remote Login" in System Settings > General > Sharing.
- **Permission denied:** Check that the public key is in `~/.ssh/authorized_keys` on the target and file permissions are correct (`chmod 600 ~/.ssh/authorized_keys`).
- **Hostname resolution:** Machines on the same LAN should resolve `.local` hostnames via mDNS. If not, add entries to `/etc/hosts`.
