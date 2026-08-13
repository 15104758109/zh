import { execFileSync } from "node:child_process";

const DOCKER_COMMAND_TIMEOUT_MS = 8_000;
const DOCKER_LONG_COMMAND_TIMEOUT_MS = 120_000;

export function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: DOCKER_COMMAND_TIMEOUT_MS,
    killSignal: "SIGKILL",
    windowsHide: true,
    ...options,
  });
}

export function dockerLong(args, options = {}) {
  return docker(args, {
    timeout: DOCKER_LONG_COMMAND_TIMEOUT_MS,
    ...options,
  });
}

export function isDockerUnavailable(error) {
  const message = `${error?.message ?? ""} ${error?.stderr ?? ""}`;
  return error?.code === "ETIMEDOUT"
    || error?.code === "ENOENT"
    || /cannot connect|is not running|pipe|timed out|runtime unavailable|POSTGRES_USER missing/i.test(message);
}

export function runtimeUnavailableMessage(error, runtime = "Docker") {
  return `${runtime} runtime unavailable: ${String(error?.message || `${runtime} did not respond`).split("\n", 1)[0]}`;
}
