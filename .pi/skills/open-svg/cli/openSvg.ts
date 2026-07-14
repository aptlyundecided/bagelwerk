import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run open-svg <file.svg>");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);

  // 1. Check extension
  if (!absPath.toLowerCase().endsWith(".svg")) {
    console.error("Error: Target must have an .svg extension");
    process.exit(1);
  }

  // 2. Validate it exists and contains <svg
  try {
    const stats = await fs.stat(absPath);
    if (!stats.isFile()) throw new Error("Not a file");
    
    // Read up to 1024 bytes
    const fh = await fs.open(absPath, 'r');
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(buffer, 0, 1024, 0);
    await fh.close();
    
    const content = buffer.toString('utf8', 0, bytesRead);
    if (!content.includes("<svg")) {
      console.error("Error: File does not appear to contain an <svg> tag. Execution aborted for security.");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: Could not validate file at ${absPath}.`, err);
    process.exit(1);
  }

  // 3. Open it on the host OS
  console.log(`Validation passed. Opening ${absPath} on host...`);
  const platform = os.platform();
  
  if (platform === "win32") {
    // Using cmd /c start is the most reliable way to invoke the Windows shell default handler
    exec(`cmd.exe /c start "" "${absPath}"`, (error) => {
      if (error) {
        console.error("Failed to open:", error);
        process.exit(1);
      }
    });
  } else if (platform === "darwin") {
    exec(`open "${absPath}"`, (error) => {
      if (error) {
        console.error("Failed to open:", error);
        process.exit(1);
      }
    });
  } else {
    exec(`xdg-open "${absPath}"`, (error) => {
      if (error) {
        console.error("Failed to open:", error);
        process.exit(1);
      }
    });
  }
}

main().catch(console.error);
