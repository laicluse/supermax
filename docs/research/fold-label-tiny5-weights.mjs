import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fontPath = fileURLToPath(new URL("./fold-label-fonts/Tiny5.ttf", import.meta.url));
const outputPath = fileURLToPath(new URL("./fold-label-tiny5-weights.png", import.meta.url));
const weights = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
font = TTFont(sys.argv[1])
cmap = font.getBestCmap()
result = []
names = ['Thin','ExtraLight','Light','Regular','Medium','SemiBold','Bold','ExtraBold','Black']
for weight, name in zip(range(100, 1000, 100), names):
    glyphs = font.getGlyphSet(location={'wght': weight})
    labels = {}
    for title in ['DOCUMENTS','MESSAGES','NOTES']:
        bounds = BoundsPen(glyphs)
        cursor = 0
        paths = []
        for char in title:
            glyph = glyphs[cmap[ord(char)]]
            glyph.draw(TransformPen(bounds, (1,0,0,1,cursor,0)))
            pen = SVGPathPen(glyphs)
            glyph.draw(pen)
            paths.append({'x':cursor,'d':pen.getCommands()})
            cursor += glyph.width
        labels[title] = {'bounds':bounds.bounds,'paths':paths}
    result.append({'weight':weight,'name':name,'labels':labels})
print(json.dumps(result))
`, fontPath], { encoding: "utf8" }));

const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1250, height: 420 }, deviceScaleFactor: 2 });
	await page.setContent(`<!doctype html><meta charset="utf-8"><style>
	*{box-sizing:border-box}body{margin:0;padding:24px;background:#f3f4f5;color:#25282d;font:13px/1.5 system-ui}h1{font-size:22px;margin:0 0 4px}header p{margin:0 0 20px;color:#606770}main{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:8px}article{padding:12px 8px;background:white;border:1px solid #ddd}h2{font-size:12px;margin:0;text-align:center}article p{font-size:11px;color:#606770;text-align:center;margin:2px 0 14px}.context{position:relative;height:174px;border:1px solid #bbb;background:white;color:#bbb}.v-slot{position:absolute;left:-1px;top:28px}.h-slot{position:absolute;bottom:-1px;left:50%;transform:translateX(-50%)}svg{display:block}.notes{margin-top:16px;display:flex;justify-content:center;color:#999}footer{margin-top:16px;font-size:11px;color:#606770}
	</style><header><h1>Tiny5 · weights at actual size</h1><p>Same 8 px font size · same 14 px handles · genuine variable-font weights · no magnification</p></header><main></main><footer>Thin 100 through Black 900. Heavier weights expand the original outlines; the font size and handle dimensions stay fixed.</footer>`);
	await page.evaluate((weights) => {
		const ns = "http://www.w3.org/2000/svg";
		window.handleSizes = [];
		function handle(label, vertical) {
			const [left, bottom, right, top] = label.bounds.map((value) => value / 128);
			const inkWidth = right - left, inkHeight = top - bottom;
			const padding = (14 - inkHeight) / 2, length = inkWidth + 2 * padding;
			const width = vertical ? 14 : length, height = vertical ? length : 14;
			const svg = document.createElementNS(ns, "svg");
			svg.setAttribute("width", width); svg.setAttribute("height", height); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
			const frame = document.createElementNS(ns, "path");
			frame.setAttribute("d", vertical ? `M.5 .5H${width-2}Q${width-.5} .5 ${width-.5} 2V${height-2}Q${width-.5} ${height-.5} ${width-2} ${height-.5}H.5Z` : `M2 .5H${width-2}Q${width-.5} .5 ${width-.5} 2V${height-.5}H.5V2Q.5 .5 2 .5Z`);
			frame.setAttribute("fill", "white"); frame.setAttribute("stroke", "currentColor"); frame.setAttribute("stroke-width", "1"); svg.append(frame);
			const orient = document.createElementNS(ns, "g");
			orient.setAttribute("transform", vertical ? `translate(${padding} ${padding+inkWidth}) rotate(-90)` : `translate(${padding} ${padding})`);
			const ink = document.createElementNS(ns, "g");
			ink.setAttribute("transform", `translate(${-left} ${top}) scale(${1/128} ${-1/128})`); ink.setAttribute("fill", "currentColor");
			for (const item of label.paths) { const path = document.createElementNS(ns, "path"); path.setAttribute("transform", `translate(${item.x} 0)`); path.setAttribute("d", item.d); ink.append(path); }
			orient.append(ink); svg.append(orient); window.handleSizes.push({ width, height, inkHeight }); return svg;
		}
		for (const item of weights) {
			const article = document.createElement("article");
			article.innerHTML = `<h2>${item.name}</h2><p>${item.weight}</p><div class="context"><div class="v-slot"></div><div class="h-slot"></div></div><div class="notes"></div>`;
			article.querySelector(".v-slot").append(handle(item.labels.DOCUMENTS, true));
			article.querySelector(".h-slot").append(handle(item.labels.MESSAGES, false));
			article.querySelector(".notes").append(handle(item.labels.NOTES, false));
			document.querySelector("main").append(article);
		}
	}, weights);
	const sizes = await page.evaluate(() => window.handleSizes);
	if (sizes.length !== 27 || sizes.some(({ width, height }) => Math.min(width, height) !== 14)) throw new Error("Weight comparison changed handle size");
	await page.screenshot({ path: outputPath });
	execFileSync("sips", ["-s", "dpiWidth", "144", "-s", "dpiHeight", "144", outputPath], { stdio: "pipe" });
	console.log("Tiny5 weights 100–900: 27 handles at 14 CSS px, font size 8 px, PNG at 144 dpi.");
} finally {
	await browser.close();
}
