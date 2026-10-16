#!/usr/bin/env python3
"""Stitch a flow's step screenshots into one GIF.

usage: frames-to-gif.py <frames dir> <out.gif> [--width 960] [--ms 900]

Frames are taken in name order (01.png, 02.png, ...). Needs Pillow (pip install pillow).
Used when ffmpeg is not installed; with ffmpeg, convert the Playwright video instead.
"""
import argparse, pathlib, sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is not installed: pip install pillow (or install ffmpeg and convert the video)")

ap = argparse.ArgumentParser()
ap.add_argument("frames"); ap.add_argument("out")
ap.add_argument("--width", type=int, default=960, help="scale frames down to this width")
ap.add_argument("--ms", type=int, default=900, help="how long each frame shows")
a = ap.parse_args()

paths = sorted(p for p in pathlib.Path(a.frames).iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
if not paths:
    sys.exit(f"no frames in {a.frames}")
frames = []
for p in paths:
    im = Image.open(p).convert("RGB")
    if im.width > a.width:
        im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
    frames.append(im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
# The last frame holds longer so the end state can be read.
durations = [a.ms] * (len(frames) - 1) + [a.ms * 3]
frames[0].save(a.out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f"{a.out}: {len(frames)} frames")
