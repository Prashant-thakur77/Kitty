# Contact sheet per chapter from the captured frames.
import sys, glob, os
from PIL import Image, ImageDraw
out, ch = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(f'{out}/ch{ch}-*.png'))
cols = 4; w, h = 640, 360
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * (h + 22)), (11, 16, 14))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).resize((w, h))
    x, y = (i % cols) * w, (i // cols) * (h + 22)
    sheet.paste(im, (x, y + 22)); d.text((x + 6, y + 4), os.path.basename(f), fill=(200, 210, 204))
sheet.save(f'{out}/sheet-ch{ch}.png'); print(f'{out}/sheet-ch{ch}.png', len(files))
