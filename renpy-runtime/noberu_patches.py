# noberu: fixes for running shipped desktop games on Ren'Py's web build.
#
# Added to both engine zips beside main.py, which imports it before Ren'Py
# starts (patch-engine.sh does both). Runs on Python 2 (the 7.x runtime) and
# Python 3 (the 8.x runtime), so it sticks to what both have.

import os
import sys

# __builtin__ first: on Python 2, Ren'Py ships the `future` package, whose
# `builtins` is a stand-in without __import__.
try:
    import __builtin__ as builtins  # Python 2
except ImportError:
    import builtins

try:
    string_types = (basestring,)  # noqa: F821 - Python 2
except NameError:
    string_types = (str,)


# Web audio: Ren'Py hands the browser a path in the emscripten filesystem,
# taken from file.raw.name. A sound inside an .rpa archive is a SubFile with
# no path of its own, so webaudio.play() and queue() fail on that lookup and
# return without a word - every archived sound is silent. Ren'Py's own web
# export never hits this, because it ships sounds as loose files; shipped
# desktop games (DDLC, Katawa Shoujo) keep them in audio.rpa.
#
# So an archived sound is copied out to a file of its own first. The browser
# reads the file the moment it is queued, so the copy is removed straight
# after. Each sound keeps one path, because Ren'Py's JS side reuses the
# decoded buffer when the same path is queued again (a looping track).

AUDIO_DIR = "/tmp/noberu-audio"


def has_path(sound):
    if isinstance(sound, string_types):
        return True
    try:
        return bool(sound.raw.name)
    except Exception:
        return False


def patch_webaudio():
    import renpy.audio.renpysound as renpysound

    paths = {}

    def extract(sound, name):
        key = repr(name)
        path = paths.get(key)
        if path is None:
            path = "%s/%d" % (AUDIO_DIR, len(paths))
            paths[key] = path
        if not os.path.isdir(AUDIO_DIR):
            os.makedirs(AUDIO_DIR)
        with open(path, "wb") as out:
            out.write(sound.read())
        return path

    def wrap(original):
        def hook(channel, sound, name, *args, **kwargs):
            if sound is None or has_path(sound):
                return original(channel, sound, name, *args, **kwargs)
            path = extract(sound, name)
            try:
                return original(channel, path, name, *args, **kwargs)
            finally:
                try:
                    os.remove(path)
                except OSError:
                    pass
        return hook

    renpysound.play = wrap(renpysound.play)
    renpysound.queue = wrap(renpysound.queue)


# Web video frames: webaudio.read_video makes a new GL texture for every
# frame and has the browser upload the <video> into it, and those textures are
# never deleted. A 1080p movie leaked 8 MB of GPU memory a frame: Cinderella
# Phenomenon's animated title grew the GPU process by ~240 MB a second, to
# gigabytes within a minute. Each channel now keeps one texture and the
# browser re-uploads into it; a new one is made only when the video's size or
# Ren'Py's texture loader (a GL restart) changes.

def patch_video():
    import renpy
    import renpy.audio.renpysound as renpysound
    import renpy.audio.webaudio as webaudio
    import renpy.gl2.gl2texture as gl2texture

    if not hasattr(webaudio, "read_video") or not hasattr(webaudio, "channel_size"):
        return

    textures = {}  # channel -> (size, loader, Texture)
    original = renpysound.read_video

    def read_video(channel, retried=False):
        if not webaudio.video_supported():
            return None

        size = webaudio.channel_size.get(channel)
        if size is None:
            info = webaudio.call_str("get_video_size", channel)
            if len(info) == 0:
                return None
            size = [int(s) for s in info.split("x")]
            webaudio.channel_size[channel] = size

        loader = renpy.display.draw.texture_loader
        held = textures.get(channel)
        if held is None or held[0] != size or held[1] is not loader:
            held = (size, loader, gl2texture.Texture(size, loader, generate=True))
            textures[channel] = held

        res = webaudio.call_int("read_video", channel, held[2].get_number(), *size)
        if res == 0:
            return held[2]
        if res == -1:
            # The video's size changed: fetch it again.
            del webaudio.channel_size[channel]
            return read_video(channel, retried)
        if res == -2 and not retried:
            # Our texture is gone (the GL context was rebuilt): make another.
            textures.pop(channel, None)
            return read_video(channel, True)
        return None

    def hook(channel, *args, **kwargs):
        # webaudio's own proxy hands audio-only channels back to renpysound.
        if webaudio.video_only and channel in webaudio.audio_channels:
            return original(channel, *args, **kwargs)
        return read_video(channel)

    renpysound.read_video = hook


# The image cache on the web. Ren'Py keeps decoded images (in wasm memory) and
# their GL textures in renpy.display.im.cache, and trims it back to its budget
# (config.image_cache_size_mb) in cleanout(). On the desktop a preload thread
# does that; on Emscripten it only happens in the interaction loop's idle-time
# step, which never comes while the game is busy - animation, quick clicks,
# skipping, or a phone with no spare frame time. KSRE asks for 400 MB and held
# 1.5 GB of textures within minutes, and a phone browser kills the tab without
# a word. So the cache is trimmed five times a second from a periodic callback
# (and the textures it lets go of freed then too),
# and the page can lower the budget and how many statements ahead Ren'Py loads
# images for (it does both on touch screens; images it predicts are pinned for
# the current interaction, so a long look-ahead can outgrow a small budget).
#
# The page calls this once the game is running, after the game's own init has
# set its config.

def keep_image_cache(limit_mb=None, predict=None):
    import time
    import renpy

    cache = renpy.display.im.cache

    if limit_mb:
        current_mb = cache.cache_limit * 4 // (1024 * 1024)
        if not current_mb or limit_mb < current_mb:
            # Through config too, so a display restart (cache.init) keeps it.
            renpy.config.image_cache_size = None
            renpy.config.image_cache_size_mb = limit_mb
            cache.cache_limit = int(limit_mb * 1024 * 1024 // 4)

    if predict is not None and predict < renpy.config.predict_statements:
        renpy.config.predict_statements = predict

    if getattr(cache, "_noberu_kept", False):
        return
    cache._noberu_kept = True

    last = [0.0]

    def trim():
        now = time.time()
        if now - last[0] < 0.2:
            return
        last[0] = now
        try:
            with cache.lock:
                cache.cleanout()
            # Textures Python has let go of wait in the loader's free list
            # until a frame is drawn, and skipping or a long load draws few.
            loader = getattr(renpy.display.draw, "texture_loader", None)
            if loader is not None:
                loader.cleanup()
        except Exception as error:
            cache._noberu_error = repr(error)

    renpy.config.periodic_callbacks.append(trim)


# GL textures on Python 2 (the 7.x runtime): Ren'Py frees a texture from
# Texture.__del__, which queues its GL name for TextureLoader.cleanup(). That
# __del__ is written in Cython, where it only works on Python 3, so on the
# 7.x runtime it does not exist and no texture was ever freed: every image the
# cache let go of, every transition's render-to-texture and every video frame
# stayed in GPU memory. Butterfly Soup gained ~400 MB a scene change.
#
# The loader's free list is not reachable from Python, so this deletes the GL
# texture straight from the Emscripten GL table instead. The loader still
# lists the name and may delete it again when GL shuts down; Emscripten skips
# a name it has already freed, and never hands one out twice.

def patch_textures(gl2texture):
    Texture = gl2texture.Texture
    if hasattr(Texture, "__del__") or sys.version_info[0] != 2:
        return

    import emscripten

    def free_texture(self):
        try:
            number = self.number
            if self.loaded and number:
                emscripten.run_script(
                    "(function(n){var t=GL.textures[n];if(t){GLctx.deleteTexture(t);t.name=0;GL.textures[n]=null}})(%d)"
                    % number)
        except Exception:
            pass  # shutting down, or no GL any more

    Texture.__del__ = free_texture


# renpy.audio.webaudio replaces renpysound's functions when it is imported,
# which Ren'Py does from audio.init() once the game has loaded; the GL
# texture module comes in when the display starts. Watch the imports, patch
# each once it is there, then step out of the way.
real_import = builtins.__import__
pending = set(["webaudio", "textures"])


def watching_import(name, *args, **kwargs):
    module = real_import(name, *args, **kwargs)

    # The module is in sys.modules while it is still being imported, before
    # Texture exists.
    gl2texture = sys.modules.get("renpy.gl2.gl2texture")
    if "textures" in pending and getattr(gl2texture, "Texture", None) is not None:
        pending.discard("textures")
        try:
            patch_textures(gl2texture)
        except Exception as error:
            print("noberu: texture patch failed: %r" % (error,))

    if "webaudio" in pending and name == "renpy.audio.webaudio":
        webaudio = sys.modules.get(name)
        if webaudio is not None and hasattr(webaudio, "can_play_types"):
            pending.discard("webaudio")
            try:
                patch_webaudio()
            except Exception as error:
                print("noberu: web audio patch failed: %r" % (error,))
            try:
                patch_video()
            except Exception as error:
                print("noberu: web video patch failed: %r" % (error,))

    if not pending:
        builtins.__import__ = real_import
    return module


builtins.__import__ = watching_import
