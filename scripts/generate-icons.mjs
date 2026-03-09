import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");
const sourceSvg = path.join(buildDir, "bee-icon.svg");
const sourceWallpaper = path.join(buildDir, "oatc-wallpaper.png");
const pngPath = path.join(buildDir, "icon-1024.png");
const iconsetDir = path.join(buildDir, "icon.iconset");
const icnsPath = path.join(buildDir, "icon.icns");

fs.mkdirSync(buildDir, { recursive: true });
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

if (fs.existsSync(sourceWallpaper)) {
  execFileSync("sips", ["-c", "1024", "1024", sourceWallpaper, "--out", pngPath], {
    stdio: "ignore",
  });
} else {
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", buildDir, sourceSvg], {
    stdio: "ignore",
  });

  const generatedPreview = path.join(buildDir, "bee-icon.svg.png");
  if (fs.existsSync(generatedPreview)) {
    fs.renameSync(generatedPreview, pngPath);
  }
}

const iconSizes = [
  16,
  32,
  64,
  128,
  256,
  512,
  1024,
];

for (const size of iconSizes) {
  const baseName = `icon_${size}x${size}.png`;
  execFileSync("sips", ["-z", String(size), String(size), pngPath, "--out", path.join(iconsetDir, baseName)], {
    stdio: "ignore",
  });

  if (size <= 512) {
    const retinaSize = size * 2;
    const retinaName = `icon_${size}x${size}@2x.png`;
    execFileSync(
      "sips",
      ["-z", String(retinaSize), String(retinaSize), pngPath, "--out", path.join(iconsetDir, retinaName)],
      { stdio: "ignore" },
    );
  }
}

execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], {
  stdio: "ignore",
});

console.log(icnsPath);
