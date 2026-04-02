/**
 * mDNS service discovery for ren-queue
 *
 * Server publishes itself as _ren-queue._tcp on the local network.
 * Workers browse for _ren-queue._tcp to find the server automatically.
 * No hardcoded IPs or hostnames needed.
 */

import Bonjour from "bonjour-service";

const SERVICE_TYPE = "ren-queue";

let instance: InstanceType<typeof Bonjour> | null = null;

function getBonjour() {
  if (!instance) instance = new Bonjour();
  return instance;
}

/**
 * Publish the queue server on the network.
 * Call this when the server starts.
 */
export function publishServer(port: number): void {
  const bonjour = getBonjour();
  bonjour.publish({
    name: "ren-queue-server",
    type: SERVICE_TYPE,
    port,
    txt: { version: "1" },
  });
  console.log(`[discovery] Publishing _${SERVICE_TYPE}._tcp on port ${port}`);
}

/**
 * Discover the queue server on the network.
 * Returns the URL (e.g., "http://YOUR_QUEUE_HOST_IP:7654") or null if not found.
 */
export function discoverServer(timeoutMs: number = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    const bonjour = getBonjour();
    let resolved = false;

    const browser = bonjour.find({ type: SERVICE_TYPE }, (service) => {
      if (resolved) return;
      resolved = true;

      // Get the first IPv4 address
      const ipv4 = service.addresses?.find(
        (addr) => addr.includes(".") && !addr.startsWith("169.254")
      );

      if (ipv4) {
        const url = `http://${ipv4}:${service.port}`;
        console.log(
          `[discovery] Found queue server: ${service.name} at ${url}`
        );
        browser.stop();
        resolve(url);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        browser.stop();
        console.warn(`[discovery] No queue server found within ${timeoutMs}ms`);
        resolve(null);
      }
    }, timeoutMs);
  });
}

/**
 * Discover the queue server with retries.
 * Keeps trying until found or max attempts reached.
 */
export async function discoverServerWithRetry(
  maxAttempts: number = 12,
  timeoutPerAttemptMs: number = 10_000,
  delayBetweenMs: number = 5_000
): Promise<string> {
  for (let i = 1; i <= maxAttempts; i++) {
    console.log(`[discovery] Searching for queue server (attempt ${i}/${maxAttempts})...`);
    const url = await discoverServer(timeoutPerAttemptMs);
    if (url) return url;
    if (i < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayBetweenMs));
    }
  }
  throw new Error(
    `Queue server not found after ${maxAttempts} attempts. Is the server running?`
  );
}

export function shutdown(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
