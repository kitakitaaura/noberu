#!/usr/bin/env python3
"""noberu's edits to the Emscripten glue of the Ren'Py web builds.

renpy.js (8.x) and v7/index.js (7.x) are the stock Emscripten output from
Ren'Py's web packages. Two things in them cost a lot in a browser:

1. GPU stalls on vertex uploads. Ren'Py's renderer draws from client-side
   vertex and index arrays (pointers into the wasm heap). WebGL has no such
   thing, so the glue copies each draw's data into one of 64 small "temp"
   buffers with bufferSubData. Those buffers come round again while the GPU
   may still be drawing from them, and Chrome's ANGLE (Metal on Macs and
   iPhones) then waits or copies before it can overwrite one. Every draw call
   paid for that: KSRE's snow scene (~50 draws a frame) ran at 2-4 browser
   frames a second with 2-second stalls, the GPU process busy 4 of every 5
   seconds. bufferData gives each upload fresh storage instead, and the same
   scene runs at a steady 60.

2. Clamped yields while loading. Ren'Py yields to the browser often while it
   loads (emscripten_sleep(0), which unwinds the stack with Asyncify and
   resumes from setTimeout). Browsers clamp nested zero-delay timeouts to
   4 ms, and KSRE yields ~780 times before its first frame: about 3 of its
   9 seconds of loading were spent waiting on nothing. While the page sets
   Module.noberuFastYield, a zero-delay sleep resumes from a MessageChannel
   message instead, which is not clamped. The pages clear it once the game has
   drawn its first frame, so in-game frame pacing is Ren'Py's own.

It has to be run again whenever those files are replaced:

    python3 patch-glue.py renpy.js v7/index.js

Safe to run twice.
"""
import sys

YIELD = ("var noberuYield=(function(){var c=new MessageChannel,q=[];"
         "c.port1.onmessage=function(){var f=q.shift();if(f)f()};"
         "return function(f){q.push(f);c.port2.postMessage(0)}})();")

EDITS = [
    # 1. vertex attributes (preDrawHandleClientVertexAttribBindings)
    ("GLctx.bufferSubData(34962,0,HEAPU8.subarray(cb.ptr,cb.ptr+size))",
     "GLctx.bufferData(34962,HEAPU8.subarray(cb.ptr,cb.ptr+size),35040)"),
    # 1. indices (glDrawElements with no element buffer bound)
    ("GLctx.bufferSubData(34963,0,HEAPU8.subarray(indices,indices+size))",
     "GLctx.bufferData(34963,HEAPU8.subarray(indices,indices+size),35040)"),
    # 2. 8.x
    ("var _emscripten_sleep=ms=>Asyncify.handleSleep(wakeUp=>safeSetTimeout(wakeUp,ms));",
     YIELD + "var _emscripten_sleep=ms=>Asyncify.handleSleep(wakeUp=>ms<=0&&Module.noberuFastYield"
     "?noberuYield(()=>callUserCallback(wakeUp)):safeSetTimeout(wakeUp,ms));"),
    # 2. 7.x
    ("function _emscripten_sleep(ms){Asyncify.handleSleep(function(wakeUp){Browser.safeSetTimeout(wakeUp,ms)})}",
     YIELD + "function _emscripten_sleep(ms){Asyncify.handleSleep(function(wakeUp){"
     "if(ms<=0&&Module.noberuFastYield)noberuYield(function(){callUserCallback(wakeUp)});"
     "else Browser.safeSetTimeout(wakeUp,ms)})}"),
]

for path in sys.argv[1:]:
    source = open(path, encoding="utf-8").read()
    changed = 0
    applied = 0
    for old, new in EDITS:
        if new in source:
            applied += 1
        elif old in source:
            changed += source.count(old)
            applied += 1
            source = source.replace(old, new)
    # Each build has both GL uploads and one of the two sleeps.
    if applied < 3:
        sys.exit(f"{path}: the Emscripten glue has changed; only {applied} of 3 edits found")
    open(path, "w", encoding="utf-8").write(source)
    print(f"{path}: {changed} edit(s) made" if changed else f"{path}: already patched")
