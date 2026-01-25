import sharp from "sharp";
export class PngNormalizer {
    async normalize(inputPath, outputPath, opts = {}) {
        // === フォントメトリクス ===
        const canvasSize = opts.canvasSize ?? 1024;
        const padding = opts.padding ?? 64;
        const baselineRatio = opts.baselineRatio ?? 0.82;
        const ascentRatio = opts.ascentRatio ?? 0.8;
        const lumaThreshold = opts.lumaThreshold ?? 240;
        // === 読み込み ===
        const img = sharp(inputPath);
        const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        // === インク領域検出 ===
        let minX = info.width;
        let minY = info.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < info.height; y++) {
            for (let x = 0; x < info.width; x++) {
                const i = (y * info.width + x) * 4;
                const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
                // 白背景判定
                if (luma < lumaThreshold && data[i + 3] > 0) {
                    if (x < minX)
                        minX = x;
                    if (y < minY)
                        minY = y;
                    if (x > maxX)
                        maxX = x;
                    if (y > maxY)
                        maxY = y;
                }
            }
        }
        // 空画像対策
        if (maxX < minX || maxY < minY) {
            throw new Error("インク領域が検出できませんでした");
        }
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const baselineY = canvasSize * baselineRatio;
        const scale = Math.min((baselineY - padding) / (cropH * ascentRatio), (canvasSize - padding * 2) / cropW);
        const resizedW = Math.max(1, Math.round(cropW * scale));
        const resizedH = Math.max(1, Math.round(cropH * scale));
        // プロポーショナル出力 (余白なし、文字幅のみ)
        const buffer = await img.extract({ left: minX, top: minY, width: cropW, height: cropH }).resize(resizedW, resizedH).png().toBuffer();
        await sharp({
            create: {
                width: resizedW,
                height: canvasSize,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 0 },
            },
        })
            .composite([{ input: buffer, left: 0, top: Math.round(baselineY - resizedH * ascentRatio) }])
            .png()
            .toFile(outputPath);
        // カーニング用プロファイルを再抽出
        return this.extractProfile(resizedW, canvasSize, outputPath, lumaThreshold);
    }
    async extractProfile(width, height, path, threshold) {
        const { data } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const left = new Array(height).fill(width);
        const right = new Array(height).fill(width);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
                if (data[i + 3] > 0 && luma < threshold) {
                    if (x < left[y])
                        left[y] = x;
                    if (width - 1 - x < right[y])
                        right[y] = width - 1 - x;
                }
            }
        }
        return { left, right, width, height };
    }
}
