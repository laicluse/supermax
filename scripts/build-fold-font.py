"""Freeze Tiny5 at its Regular defaults without removing language coverage."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
source = root / "docs/research/fold-label-fonts"
target = root / "src/fonts"
font = TTFont(source / "Tiny5.ttf")
axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
font = instantiateVariableFont(font, axes, inplace=True, updateFontNames=True)
font["name"].names = [record for record in font["name"].names if record.nameID in {0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17}]
target.mkdir(exist_ok=True)
font.save(target / "Tiny5-Regular.ttf")
(target / "OFL.txt").write_bytes((source / "Tiny5-OFL.txt").read_bytes())
assert "fvar" not in font and "gvar" not in font
assert font["OS/2"].usWeightClass == 400
print(f"Tiny5 Regular: {(target / 'Tiny5-Regular.ttf').stat().st_size} bytes; all variation axes removed.")
