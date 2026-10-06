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


# renpy.audio.webaudio replaces renpysound's functions when it is imported,
# which Ren'Py does from audio.init() once the game has loaded. Watch for that
# import, patch on top of it, then step out of the way.
real_import = builtins.__import__


def watching_import(name, *args, **kwargs):
    module = real_import(name, *args, **kwargs)
    if name == "renpy.audio.webaudio":
        webaudio = sys.modules.get(name)
        if webaudio is not None and hasattr(webaudio, "can_play_types"):
            builtins.__import__ = real_import
            try:
                patch_webaudio()
            except Exception as error:
                print("noberu: web audio patch failed: %r" % (error,))
    return module


builtins.__import__ = watching_import
