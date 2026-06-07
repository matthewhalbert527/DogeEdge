import { mkdir, writeFile } from "node:fs/promises";

const builtAt = new Date().toISOString();
const version = process.env.DOGEEDGE_BUILD_ID || builtAt;

await mkdir("public", { recursive: true });
await writeFile("public/version.json", `${JSON.stringify({ version, builtAt }, null, 2)}\n`);
