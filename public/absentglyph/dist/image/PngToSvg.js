import fs from "node:fs";
import path from "node:path";
import potrace from "potrace";
import { SVGPathData } from "svg-pathdata";
import { optimize } from "svgo";
export class PngToSvg {
    inputDir;
    outputDir;
    constructor(inputDir, outputDir) {
        this.inputDir = inputDir;
        this.outputDir = outputDir;
    }
    async convert(fileName, param = {}, preferExistingSvg = true) {
        const inputPath = path.join(this.inputDir, fileName);
        const outputPath = path.join(this.outputDir, fileName.replace(/\.png$/i, ".svg"));
        if (preferExistingSvg && fs.existsSync(outputPath)) {
            return outputPath;
        }
        if (!fs.existsSync(inputPath)) {
            throw new Error(`PNG not found: ${inputPath}`);
        }
        return new Promise((resolve, reject) => {
            potrace.trace(inputPath, param, (err, svg) => {
                if (err)
                    return reject(err);
                try {
                    // SVG文字列からd属性のみを抽出して補正
                    const pathRegex = /d="([^"]+)"/i;
                    const match = svg.match(pathRegex);
                    let fixedSvg;
                    if (match) {
                        const originalPathData = match[1];
                        const fixedPathData = this.fixWinding(originalPathData);
                        // d属性を置換し、fill-ruleを削除
                        fixedSvg = svg.replace(originalPathData, fixedPathData);
                        fixedSvg = fixedSvg.replace(/fill-rule="evenodd"/g, 'fill-rule="nonzero"');
                    }
                    else {
                        // パスが見つからない場合はそのまま出力
                        fixedSvg = svg;
                    }
                    fs.writeFileSync(outputPath, this.compressSvg(fixedSvg));
                    resolve(outputPath);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    }
    compressSvg(svg) {
        return optimize(svg, {
            multipass: true,
            plugins: [
                "preset-default",
                {
                    name: "cleanupNumericValues",
                    params: { floatPrecision: 2 },
                },
                {
                    name: "removeAttrs",
                    params: { attrs: "(data-name|id|class)" },
                },
                "convertStyleToAttrs",
                "removeDimensions",
            ],
        }).data;
    }
    /**
     * パスのワインディングルールを修正するメインロジック
     * nonzeroルールで正しく穴が開くように、包含関係に基づいてパスの向きを反転させる
     */
    fixWinding(d) {
        // 1. パスをパースして絶対座標に変換
        const pathData = new SVGPathData(d).toAbs();
        // 2. M(MoveTo)コマンドでサブパスごとに分割
        const subPathsCommands = [];
        let currentSubPath = [];
        for (const cmd of pathData.commands) {
            if (cmd.type === SVGPathData.MOVE_TO && currentSubPath.length > 0) {
                subPathsCommands.push(currentSubPath);
                currentSubPath = [];
            }
            currentSubPath.push(cmd);
        }
        if (currentSubPath.length > 0)
            subPathsCommands.push(currentSubPath);
        // 3. 各サブパスの情報を計算（ポリゴン近似、面積、バウンディングボックス）
        const infos = subPathsCommands.map((cmds) => {
            const polygon = this.commandsToPolygon(cmds);
            const area = this.calculateSignedArea(polygon);
            const bounds = this.calculateBounds(polygon);
            return {
                commands: cmds,
                polygon,
                area,
                isClockwise: area > 0, // 一般的にSVG座標系(y下向き)では正が時計回り
                bounds,
                parentCount: 0,
            };
        });
        // 4. 包含関係の判定 (レイキャスティング法などで判定)
        // 面積の大きい順に処理することで判定精度を安定させる（親は子より必ず大きい）
        // ここではシンプルに総当りで判定
        for (let i = 0; i < infos.length; i++) {
            for (let j = 0; j < infos.length; j++) {
                if (i === j)
                    continue;
                // A(infos[i]) が B(infos[j]) の中にあるか？
                if (this.isPolygonInside(infos[i], infos[j])) {
                    infos[i].parentCount++;
                }
            }
        }
        // 5. 向きの修正
        // 親の数が偶数 (0, 2...) = 塗りつぶし (時計回りにする)
        // 親の数が奇数 (1, 3...) = 穴 (反時計回りにする)
        // ※ SVG座標系では時計回りが正の面積になることが多いが、
        // 重要なのは「親と子が逆向きであること」です。
        // ここでは Depth 0(Body) -> CW, Depth 1(Hole) -> CCW と統一します。
        const resultCommands = [];
        for (const info of infos) {
            const isHole = info.parentCount % 2 !== 0;
            const shouldBeClockwise = !isHole;
            if (info.isClockwise !== shouldBeClockwise) {
                // 向きが逆なので反転させる
                resultCommands.push(...this.reverseCommands(info.commands));
            }
            else {
                resultCommands.push(...info.commands);
            }
        }
        // 6. 文字列に再構築
        return new SVGPathData(resultCommands).encode();
    }
    // --- 以下、幾何計算ヘルパー ---
    // コマンドを単純なポリゴン（頂点配列）に近似変換
    commandsToPolygon(commands) {
        const points = [];
        let curX = 0;
        let curY = 0;
        // Potraceは主に M, L, C を出力する。簡易的なサンプリングを行う。
        for (const cmd of commands) {
            if (cmd.type === SVGPathData.MOVE_TO || cmd.type === SVGPathData.LINE_TO) {
                points.push({ x: cmd.x, y: cmd.y });
                curX = cmd.x;
                curY = cmd.y;
            }
            else if (cmd.type === SVGPathData.CURVE_TO) {
                // ベジェ曲線をいくつかの中間点に分割して追加（精度向上のため）
                // t=0.5 の1点だけサンプリング（包含判定用にはこれくらいで十分なことが多い）
                // 必要に応じて分割数を増やしてください
                const t = 0.5;
                const x = (1 - t) * (1 - t) * (1 - t) * curX + 3 * (1 - t) * (1 - t) * t * cmd.x1 + 3 * (1 - t) * t * t * cmd.x2 + t * t * t * cmd.x;
                const y = (1 - t) * (1 - t) * (1 - t) * curY + 3 * (1 - t) * (1 - t) * t * cmd.y1 + 3 * (1 - t) * t * t * cmd.y2 + t * t * t * cmd.y;
                points.push({ x, y });
                points.push({ x: cmd.x, y: cmd.y });
                curX = cmd.x;
                curY = cmd.y;
            }
            else if (cmd.type === SVGPathData.CLOSE_PATH) {
                // 何もしない
            }
        }
        return points;
    }
    // 符号付き面積の計算 (Shoelace Formula)
    calculateSignedArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            area += (p2.x - p1.x) * (p2.y + p1.y);
        }
        return area / 2;
    }
    calculateBounds(points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of points) {
            if (p.x < minX)
                minX = p.x;
            if (p.x > maxX)
                maxX = p.x;
            if (p.y < minY)
                minY = p.y;
            if (p.y > maxY)
                maxY = p.y;
        }
        return { minX, maxX, minY, maxY };
    }
    // ポリゴンAがポリゴンBの「完全に内側」にあるか判定
    isPolygonInside(child, parent) {
        // 1. バウンディングボックスによる簡易判定
        if (child.bounds.minX < parent.bounds.minX || child.bounds.maxX > parent.bounds.maxX || child.bounds.minY < parent.bounds.minY || child.bounds.maxY > parent.bounds.maxY) {
            return false;
        }
        // 2. 子の最初の点が親に含まれているか判定 (Ray Casting)
        // Potraceの出力は交差しない前提なので、1点が内側なら全体が内側とみなせる
        const p = child.polygon[0];
        let inside = false;
        const vs = parent.polygon;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
            if (intersect)
                inside = !inside;
        }
        return inside;
    }
    // SVGコマンドの配列を逆順にする
    // M(start) ... Z -> M(start) ... Z (ただし座標の順序を逆にする)
    reverseCommands(commands) {
        if (commands.length === 0)
            return [];
        // 1. 座標とコマンドを抽出してリスト化
        const points = [];
        const cmds = []; // cmds[i] は points[i-1] -> points[i] のセグメント
        const startCmd = commands[0];
        if (startCmd.type !== SVGPathData.MOVE_TO)
            return commands;
        points.push({ x: startCmd.x, y: startCmd.y });
        // 最初のMoveToに対応するダミー
        cmds.push(startCmd);
        for (let i = 1; i < commands.length; i++) {
            const cmd = commands[i];
            if (cmd.type === SVGPathData.CLOSE_PATH) {
                // Zは座標を持たない。ループ外で処理
            }
            else if ("x" in cmd && "y" in cmd) {
                points.push({ x: cmd.x, y: cmd.y });
                cmds.push(cmd);
            }
        }
        // 2. 逆パスの構築
        // 元: P0 -> P1 -> ... -> Pn -> (Z: Pn->P0)
        // 逆: P0 -> Pn -> ... -> P1 -> (Z: P1->P0)
        const reversed = [];
        const p0 = points[0];
        // 新しい始点 (P0)
        reversed.push({
            type: SVGPathData.MOVE_TO,
            relative: false,
            x: p0.x,
            y: p0.y,
        });
        // 最初のセグメント: P0 -> Pn (元の Z の逆)
        // PotraceではZは直線接続とみなせる
        if (points.length > 1) {
            const pn = points[points.length - 1];
            reversed.push({
                type: SVGPathData.LINE_TO,
                relative: false,
                x: pn.x,
                y: pn.y,
            });
        }
        // 残りのセグメント: Pn -> ... -> P1 (元の順序を逆走)
        for (let i = points.length - 1; i > 0; i--) {
            const target = points[i - 1]; // 向かう先
            const originalCmd = cmds[i]; // points[i-1] -> points[i] を作ったコマンド
            if (originalCmd.type === SVGPathData.LINE_TO) {
                reversed.push({
                    type: SVGPathData.LINE_TO,
                    relative: false,
                    x: target.x,
                    y: target.y,
                });
            }
            else if (originalCmd.type === SVGPathData.CURVE_TO) {
                // Cubic Bezier: C x1 y1 x2 y2 x y
                // 逆: 制御点を入れ替えてターゲットへ
                reversed.push({
                    type: SVGPathData.CURVE_TO,
                    relative: false,
                    x1: originalCmd.x2,
                    y1: originalCmd.y2,
                    x2: originalCmd.x1,
                    y2: originalCmd.y1,
                    x: target.x,
                    y: target.y,
                });
            }
        }
        // 最後に閉じる
        reversed.push({ type: SVGPathData.CLOSE_PATH, relative: false });
        return reversed;
    }
}
