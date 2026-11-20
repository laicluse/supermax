"""Extract the all-caps specimen repertoire from the original font files."""
import json
import re
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

root = Path(__file__).parent / "fold-label-fonts"
repertoire = set(range(32, 91)) | set(range(192, 224)) | {8230}
fonts = {}
for family, filename in [("Spleen", "Spleen5x8.bdf"), ("TomThumb", "TomThumb.bdf")]:
    glyphs = {}
    for block in (root / filename).read_text().split("STARTCHAR ")[1:]:
        code = int(re.search(r"ENCODING (\d+)", block)[1])
        if code not in repertoire:
            continue
        width, height, x_offset, y_offset = map(int, re.search(r"BBX (.*)", block)[1].split())
        advance = int(re.search(r"DWIDTH (\d+)", block)[1])
        rows = re.search(r"BITMAP\n(.*?)\nENDCHAR", block, re.S)[1].splitlines()
        pixels = []
        for y, row in enumerate(rows):
            bits = bin(int(row, 16))[2:].zfill(len(row) * 4)
            pixels.extend([x + x_offset, -y_offset - height + y] for x in range(width) if bits[x] == "1")
        glyphs[str(code)] = {"advance": advance, "pixels": pixels}
    fonts[family] = glyphs

for family, filename, grid in [("Tiny5", "Tiny5.ttf", 128), ("Micro5", "Micro5.ttf", 150)]:
    font = TTFont(root / filename)
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for code, name in font.getBestCmap().items():
        if code not in repertoire:
            continue
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        glyphs[str(code)] = {"advance": font["hmtx"][name][0] / grid, "path": pen.getCommands(), "grid": grid}
    fonts[family] = glyphs

notice = "// Original glyphs retain their source licenses; see sources.json and adjacent license files.\n"
(root / "bitmap-glyphs.js").write_text(notice + "window.microBitmapFonts = " + json.dumps(fonts, separators=(",", ":")) + ";\n")
