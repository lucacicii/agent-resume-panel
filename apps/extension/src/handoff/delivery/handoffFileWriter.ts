import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function writeHandoffFile(
  panelHome: string,
  sourceProvider: string,
  sessionId: string,
  content: string
): Promise<string> {
  const handoffsDir = path.join(panelHome, "handoffs");
  await fs.mkdir(handoffsDir, { recursive: true });

  const safeId = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 48);
  const fileName = `${Date.now()}-${sourceProvider}-${safeId}.md`;
  const filePath = path.join(handoffsDir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}