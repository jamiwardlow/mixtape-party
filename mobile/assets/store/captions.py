"""Caption the App Store screenshots (#190): python3 captions.py
screenshots/N-name.png -> captioned/N-name.png, resized to 1206x2622 (App Store 6.3").
Mint background, Bagel Fat One caption in Ink, screenshot as a sticker card."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
FONT = HERE / "../../node_modules/@expo-google-fonts/bagel-fat-one/400Regular/BagelFatOne_400Regular.ttf"
BG, INK = "#5EEAD4", "#1A1033"
W, H = 1320, 2868
CAPTIONS = {
    "1-home": "Everyone picks a song.",
    "2-submit": "Pick one that fits the theme.",
    "3-guess": "You guess whose.",
    "4-results": "Find out who knows you best.",
    "5-league": "Keep score all season.",
    "6-final": "Crown a champion.",
    "7-join": "Bring your friends!",
}
SCALE, TOP, BORDER, RADIUS, SHADOW = 0.84, 340, 12, 80, 16

out = HERE / "captioned"
out.mkdir(exist_ok=True)
font = ImageFont.truetype(str(FONT.resolve()), 118)

def wrap(draw, text):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and draw.textlength(trial, font=font) > W - 160:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line]

for name, caption in CAPTIONS.items():
    shot = Image.open(HERE / "screenshots" / f"{name}.png").convert("RGB")
    sw, sh = round(W * SCALE), round(H * SCALE)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x, y = (W - sw) // 2, TOP

    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    box = (x - BORDER, y - BORDER, x + sw + BORDER, y + sh + BORDER)
    d.rounded_rectangle([box[0] + SHADOW, box[1] + SHADOW, box[2] + SHADOW, box[3] + SHADOW], RADIUS + BORDER, fill=INK)
    d.rounded_rectangle(box, RADIUS + BORDER, fill=INK)
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], RADIUS, fill=255)
    canvas.paste(shot, (x, y), mask)

    lines = wrap(d, caption)
    lh = 132
    ty = (TOP - BORDER - lh * len(lines)) // 2 + 20
    for i, line in enumerate(lines):
        d.text((W / 2, ty + i * lh), line, font=font, fill=INK, anchor="mt")
    canvas.resize((1206, 2622), Image.LANCZOS).save(out / f"{name}.png")  # App Store 6.3" size
    print(out / f"{name}.png")
