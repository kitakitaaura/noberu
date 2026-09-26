#!/usr/bin/env python3
"""Build the animated-favicon sprite sheet.

Browsers do not animate GIF or SVG favicons (Chrome, Edge and Safari show only
the first frame), so the favicon is animated from JavaScript instead: frames are
laid out side by side in one PNG, and index.html swaps the icon between them.

    python3 tools/make-favicon-frames.py <animated.gif|webp|apng> [--size 32] [--max-frames 24]

Writes assets/favicon-frames.png and prints the frame count to put in
index.html's FAVICON_FRAMES.
"""
import argparse
import pathlib
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "assets" / "favicon-frames.png"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--size", type=int, default=32)
    ap.add_argument("--max-frames", type=int, default=24)
    args = ap.parse_args()

    im = Image.open(args.source)
    total = getattr(im, "n_frames", 1)
    if total < 2:
        print(f"{args.source}: only {total} frame - that file is not animated.", file=sys.stderr)
        return 1

    # A favicon is tiny and the loop runs at ~5fps, so long sources are
    # sampled rather than kept whole. The picks are spread evenly across the
    # WHOLE source: taking every Nth frame and stopping at the cap would keep
    # only the opening of the animation and the loop would never close.
    count = min(total, args.max_frames)
    picked = [round(i * total / count) for i in range(count)]

    frames = []
    for index in picked:
        im.seek(index)
        frame = im.convert("RGBA").resize((args.size, args.size), Image.LANCZOS)
        frames.append(frame)

    sheet = Image.new("RGBA", (args.size * len(frames), args.size), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.paste(frame, (i * args.size, 0))
    sheet.save(OUT)

    print(f"wrote {OUT} - {len(frames)} frames of {args.size}px (from {total})")
    print(f"set FAVICON_FRAMES = {len(frames)} in index.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
