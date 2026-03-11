const fs = require("fs");
const path = require("path");

const sourceDir = path.join(__dirname, "prisma", "generated", "types");
const targetDirs = [
  path.join(__dirname, "lambda", "batch-db-push", "types"),
  path.join(__dirname, "lambda", "cleanup-db-cron", "types"),
];

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`Copied ${source} to ${target}`);
}

fs.readdirSync(sourceDir).forEach((file) => {
  const sourcePath = path.join(sourceDir, file);
  targetDirs.forEach((targetDir) => {
    const targetPath = path.join(targetDir, file);
    copyFile(sourcePath, targetPath);
  });
});
