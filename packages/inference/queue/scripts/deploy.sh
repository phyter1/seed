#!/bin/bash
# Deploy queue across a fleet of machines
#
# Configure via environment variables:
#   QUEUE_HOST_SSH  — SSH command for the queue server host
#   WORKER1_SSH     — SSH command for a worker host
#   REPO_URL        — Git repo URL to clone/pull
#
# Usage: ./scripts/deploy.sh
set -e

REPO_URL="${REPO_URL:-https://github.com/your-org/seed.git}"
REPO_DIR="\$HOME/code/seed/packages/inference/queue"

# --- Configure your fleet here ---
QUEUE_HOST_SSH="${QUEUE_HOST_SSH:?Set QUEUE_HOST_SSH (e.g. ssh user@queue-host)}"
WORKER_HOSTS_SSH=(
  "${WORKER1_SSH:-}"
)

echo "=== Deploying queue fleet ==="

# --- Helper: generate a macOS launchd plist for a worker ---
generate_plist() {
  local name=$1
  local script=$2
  local repo=$3
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.seed.queue.worker.${name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${repo}/scripts/${script}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${repo}/logs/worker-${name}.log</string>
    <key>StandardErrorPath</key>
    <string>${repo}/logs/worker-${name}.err</string>
    <key>WorkingDirectory</key>
    <string>${repo}</string>
</dict>
</plist>
PLIST
}

# --- Helper: set up a machine ---
setup_machine() {
  local ssh_cmd=$1
  local label=$2

  echo ""
  echo "--- Setting up ${label} ---"
  $ssh_cmd "bash -s" <<SETUP
export PATH="\$HOME/.bun/bin:\$PATH"
REPO="\$HOME/code/seed"

if [ -d "\$REPO" ]; then
  cd "\$REPO" && git pull --ff-only 2>&1 | tail -1
else
  mkdir -p "\$HOME/code"
  git clone ${REPO_URL} "\$REPO" 2>&1 | tail -1
fi

cd "\$REPO/packages/inference/queue"
mkdir -p logs
bun install 2>&1 | tail -1
echo "${label}: ready"
SETUP
}

# --- Deploy ---
setup_machine "$QUEUE_HOST_SSH" "queue-host"

for ssh_cmd in "${WORKER_HOSTS_SSH[@]}"; do
  [ -n "$ssh_cmd" ] && setup_machine "$ssh_cmd" "worker-host"
done

echo ""
echo "=== Machines updated. Load services with launchctl as needed. ==="
echo "See scripts/ for worker configs."
