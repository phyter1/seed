/**
 * Machine detection output — what detect.sh discovers about the hardware.
 *
 * This matches the JSON schema written by setup/detect.sh to seed.machine.json.
 * detect.sh generates this via Python's json.dumps; keep the two in sync.
 */

/** Complete output of setup/detect.sh. */
export interface SeedMachineDetection {
  machine: SeedMachineHardware;
  tools: Record<string, boolean>;
  hosts: SeedHostDetection;
  inference: SeedInferenceDetection;
  fleet: SeedFleetDetection;
}

/** Hardware specs discovered about the current machine. */
export interface SeedMachineHardware {
  hostname: string;
  os: string;
  arch: string;
  cores: number;
  ram_gb: number;
  chip: string;
  gpu: string;
  can_mlx: boolean;
}

/** Host runtime detection results. */
export interface SeedHostDetection {
  default: string | null;
  heartbeat: string | null;
  installed: Record<string, boolean>;
  status: Record<string, string>;
  versions: Record<string, string>;
  reasons: Record<string, string>;
}

/** Local inference runtime detection. */
export interface SeedInferenceDetection {
  ollama_running: boolean;
  ollama_models: number;
}

/** Fleet discovery results. */
export interface SeedFleetDetection {
  machines: string[];
  role: string;
}
