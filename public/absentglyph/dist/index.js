import fs from "node:fs";
import path from "node:path";
import { FontBuilder } from "./font/FontBuilder.js";
import { PngNormalizer } from "./image/PngNormalizer.js";
import { PngToSvg } from "./image/PngToSvg.js";
/**
 * potrace設定
 */
const param = {
    threshold: 128,
    blackOnWhite: true,
    turdSize: 20, // 10~50
    optCurve: true,
    optTolerance: 0.2, // 0.1~0.3
    turdPolicy: "minority", // "black" / "minority"
    background: "transparent",
};
const config = {
    useKerning: true,
    concurrency: 5,
};
(async () => {
    const pngDir = "assets/png";
    const normalizedDir = "assets/normalized";
    const svgDir = "assets/svg";
    const outDir = "fonts";
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir);
    const normalizer = new PngNormalizer();
    const pngToSvg = new PngToSvg(normalizedDir, svgDir);
    const files = fs.readdirSync(pngDir).filter((f) => f.endsWith(".png"));
    console.log(`Processing ${files.length} files...`);
    const glyphsData = new Map();
    for (let i = 0; i < files.length; i += config.concurrency) {
        const chunk = files.slice(i, i + config.concurrency);
        await Promise.all(chunk.map(async (file) => {
            const char = path.basename(file, ".png").replace(/u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            const normalizedPath = path.join(normalizedDir, file);
            const profile = await normalizer.normalize(path.join(pngDir, file), normalizedPath);
            const svgPath = await pngToSvg.convert(file, param, true);
            glyphsData.set(char, { svgPath, profile });
        }));
        console.log(`Progress: ${Math.min(i + config.concurrency, files.length)} / ${files.length}`);
    }
    const builder = new FontBuilder("absentglyph", outDir);
    await builder.build(glyphsData, config.useKerning);
    console.log("Font build complete!");
})();
