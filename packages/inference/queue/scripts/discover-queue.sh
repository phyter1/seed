#!/bin/bash
# Discover the queue server via mDNS (Bonjour)
# Outputs the URL (e.g., http://YOUR_QUEUE_HOST_IP:7654)
# Uses macOS dns-sd which works under launchd

MAX_ATTEMPTS=${1:-30}
DELAY=${2:-5}

for i in $(seq 1 $MAX_ATTEMPTS); do
  # Browse for the service (dns-sd outputs to stderr)
  BROWSE=$(dns-sd -B _ren-queue._tcp . 2>&1 &
    PID=$!; sleep 3; kill $PID 2>/dev/null; wait $PID 2>/dev/null)

  if echo "$BROWSE" | grep -q "ren-queue-server"; then
    # Resolve to get host and port
    # Output format: "... can be reached at host.:7654 (interface 14)"
    RESOLVE=$(dns-sd -L "ren-queue-server" _ren-queue._tcp . 2>&1 &
      PID=$!; sleep 3; kill $PID 2>/dev/null; wait $PID 2>/dev/null)

    LINE=$(echo "$RESOLVE" | grep "can be reached at")
    if [ -n "$LINE" ]; then
      # Extract "host:port" after "at " and before " ("
      HOST_PORT=$(echo "$LINE" | sed 's/.*can be reached at //' | sed 's/ (.*//')
      HOST=$(echo "$HOST_PORT" | rev | cut -d: -f2- | rev | sed 's/\.$//')
      PORT=$(echo "$HOST_PORT" | rev | cut -d: -f1 | rev)

      if [ -n "$HOST" ] && [ -n "$PORT" ]; then
        # Resolve hostname to IP via dscacheutil (macOS mDNS-aware)
        IP=$(dscacheutil -q host -a name "${HOST}.local" 2>/dev/null | grep "^ip_address:" | head -1 | awk '{print $2}')
        [ -z "$IP" ] && IP=$(dscacheutil -q host -a name "${HOST}" 2>/dev/null | grep "^ip_address:" | head -1 | awk '{print $2}')
        [ -z "$IP" ] && IP="$HOST"
        echo "http://${IP}:${PORT}"
        exit 0
      fi
    fi
  fi

  >&2 echo "[discover] Attempt $i/$MAX_ATTEMPTS — not found, retrying in ${DELAY}s..."
  sleep $DELAY
done

>&2 echo "[discover] Failed to find queue server after $MAX_ATTEMPTS attempts"
exit 1
