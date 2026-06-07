import { spawn } from "node:child_process";

const url = process.argv[2] ?? "http://127.0.0.1:1420/";
const timeoutMs = Number(process.argv[3] ?? 45_000);
const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  if (await isReady(url)) {
    openUrl(url);
    process.exit(0);
  }

  await sleep(500);
}

console.error(`DogeEdge did not answer within ${Math.round(timeoutMs / 1000)}s: ${url}`);
process.exit(1);

async function isReady(targetUrl) {
  try {
    const response = await fetch(targetUrl, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function openUrl(targetUrl) {
  if (process.env.DOGEEDGE_SKIP_OPEN === "1") {
    console.log(`DogeEdge is ready: ${targetUrl}`);
    return;
  }

  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", targetUrl] }
      : process.platform === "darwin"
        ? { file: "open", args: [targetUrl] }
        : { file: "xdg-open", args: [targetUrl] };

  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
