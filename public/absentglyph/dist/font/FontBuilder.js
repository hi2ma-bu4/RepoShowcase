import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { SVGPathData } from "svg-pathdata";
export class FontBuilder {
    fontName;
    outDir;
    constructor(fontName, outDir) {
        this.fontName = fontName;
        this.outDir = outDir;
    }
    async build(glyphsMap, useKerning) {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
        const glyphs = [];
        // .notdef
        glyphs.push(new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 500, path: new opentype.Path() }));
        // 2. グリフ作成
        for (const [char, data] of glyphsMap) {
            const svg = fs.readFileSync(data.svgPath, "utf-8");
            const d = svg.match(/d="([^"]+)"/i)?.[1] || "";
            const pathData = new SVGPathData(d).toAbs();
            const otPath = new opentype.Path();
            pathData.commands.forEach((cmd) => {
                const y = 840 - cmd.y; // SVG(y↓) から TTF(y↑) への反転
                if (cmd.type === SVGPathData.MOVE_TO)
                    otPath.moveTo(cmd.x, y);
                else if (cmd.type === SVGPathData.LINE_TO)
                    otPath.lineTo(cmd.x, y);
                else if (cmd.type === SVGPathData.CURVE_TO)
                    otPath.bezierCurveTo(cmd.x1, 840 - cmd.y1, cmd.x2, 840 - cmd.y2, cmd.x, y);
                else if (cmd.type === SVGPathData.CLOSE_PATH)
                    otPath.close();
            });
            glyphs.push(new opentype.Glyph({
                name: char,
                unicode: char.charCodeAt(0),
                advanceWidth: data.profile.width,
                path: otPath,
            }));
        }
        // 3. フォント生成
        const font = new opentype.Font({
            familyName: this.fontName,
            styleName: "Regular",
            unitsPerEm: 1024,
            ascender: 840,
            descender: -184,
            glyphs: glyphs,
        });
        font.kerningPairs = {};
        font.names.copyright = { en: pkg.copyright || `Copyright (c) ${new Date().getFullYear()} ${pkg.author || ""}` };
        font.names.fontFamily = { en: this.fontName };
        font.names.fontSubfamily = { en: "Regular" };
        font.names.fullName = { en: this.fontName };
        font.names.version = { en: `Version ${pkg.version || "1.0.0"}` };
        font.names.postScriptName = { en: this.fontName.replace(/\s+/g, "-") };
        if (pkg.description)
            font.names.description = { en: pkg.description };
        if (pkg.author)
            font.names.manufacturer = { en: pkg.author };
        if (pkg.homepage)
            font.names.manufacturerURL = { en: pkg.homepage };
        if (pkg.license)
            font.names.license = { en: pkg.license };
        // 4. 全自動カーニング計算
        if (useKerning) {
            console.log("Calculating kerning pairs...");
            const chars = Array.from(glyphsMap.keys());
            for (const leftChar of chars) {
                for (const rightChar of chars) {
                    const adj = this.getKerningValue(glyphsMap.get(leftChar).profile, glyphsMap.get(rightChar).profile);
                    if (adj < -2) {
                        const leftGlyph = font.charToGlyph(leftChar);
                        const rightGlyph = font.charToGlyph(rightChar);
                        font.kerningPairs[leftGlyph.index + "," + rightGlyph.index] = adj;
                    }
                }
            }
        }
        const ttfPath = path.join(this.outDir, `${this.fontName}.ttf`);
        fs.writeFileSync(ttfPath, Buffer.from(font.toArrayBuffer()));
    }
    getKerningValue(pA, pB) {
        let maxOverlap = -Infinity;
        const minGap = 15; // 文字間の最小隙間
        for (let y = 0; y < pA.height; y++) {
            const gap = pA.right[y] + pB.left[y];
            const overlap = gap - minGap;
            if (y === 0 || overlap < maxOverlap)
                maxOverlap = overlap;
        }
        // 詰められる距離が正ならマイナス（左へ寄せる）を返す
        return maxOverlap > 0 ? -maxOverlap : 0;
    }
}
