import { execFileSync } from "node:child_process";
import { createMockProvider } from "./providers/mock-provider.mjs";
import { createRealProvider } from "./providers/real-provider.mjs";

function canUseOpenClaw() {
  try {
    execFileSync("openclaw", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function createControlPlane() {
  const requestedMode = process.env.OPENCLAW_CLUSTER_SOURCE ?? "auto";

  if (requestedMode === "mock") {
    const provider = createMockProvider();
    await provider.init();
    return provider;
  }

  if (requestedMode === "real" || (requestedMode === "auto" && canUseOpenClaw())) {
    try {
      const provider = createRealProvider();
      await provider.init();
      return provider;
    } catch (error) {
      console.error("[control-plane] failed to initialize real provider, falling back to mock");
      console.error(error instanceof Error ? error.message : error);
    }
  }

  const provider = createMockProvider();
  await provider.init();
  return provider;
}
