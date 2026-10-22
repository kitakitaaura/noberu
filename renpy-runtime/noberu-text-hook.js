// Ren'Py's dialogue and menus for noberu's reading tools (assets/text.js).
//
// Both runtime pages (renpy.html for 8.x, renpy7.html for 7.x) run this
// Python once the game's first frame is up: through renpy_exec on 8.x and
// PyRun_SimpleString on 7.x. It wraps two things, keeping the originals:
//
//   ADVCharacter.__call__   every say statement (NVL characters included),
//                           after [variable] substitution, minus {text tags}
//   display_menu            every menu's choices
//
// and sends each line out through the `emscripten` module as base64 JSON to
// NoberuSayB64 (assets/runtime.js). Written for Python 2 and 3 alike.
//
// Everything lives inside one function: renpy_exec runs code with separate
// globals and locals, so a function defined at the top level could not see
// its neighbours. Closures can.
window.NOBERU_RENPY_TEXT_HOOK = [
  "def _noberu_text_hook():",
  "    import renpy, re, json, base64",
  "    try:",
  "        import emscripten as em",
  "    except ImportError:",
  "        return False",
  "    try:",
  "        string = basestring",
  "    except NameError:",
  "        string = str",
  "    tags = re.compile(r'\\{[^{}]*\\}')",
  "    def text(s):",
  "        if s is None:",
  "            return ''",
  "        try:",
  "            r = renpy.substitutions.substitute(s)",
  "            s = r[0] if isinstance(r, tuple) else r",
  "        except Exception:",
  "            pass",
  "        if not isinstance(s, string):",
  "            return ''",
  "        return tags.sub('', s).replace('{{', '{').replace('[[', '[')",
  "    def send(kind, who, what):",
  "        if not what:",
  "            return",
  "        try:",
  "            data = json.dumps({'kind': kind, 'name': who or '', 'text': what}, ensure_ascii=True)",
  "            if not isinstance(data, bytes):",
  "                data = data.encode('ascii')",
  "            b64 = base64.b64encode(data)",
  "            if not isinstance(b64, str):",
  "                b64 = b64.decode('ascii')",
  "            em.run_script(\"window.NoberuSayB64 && window.NoberuSayB64('%s')\" % b64)",
  "        except Exception:",
  "            pass",
  "    cls = renpy.character.ADVCharacter",
  "    if getattr(cls, '_noberu', False):",
  "        return True",
  "    original_call = cls.__call__",
  "    def character_call(self, what, *args, **kwargs):",
  "        try:",
  "            who = self.name",
  "            if who is not None and getattr(self, 'dynamic', False):",
  "                who = renpy.python.py_eval(who)",
  "            who = text(who) if isinstance(who, string) else ''",
  "            send('line', who, text(what))",
  "        except Exception:",
  "            pass",
  "        return original_call(self, what, *args, **kwargs)",
  "    cls.__call__ = character_call",
  "    cls._noberu = True",
  "    original_menu = renpy.exports.display_menu",
  "    def display_menu(items, *args, **kwargs):",
  "        try:",
  "            labels = []",
  "            for item in items:",
  "                label = item[0] if isinstance(item, (tuple, list)) else getattr(item, 'caption', None)",
  "                value = item[1] if isinstance(item, (tuple, list)) and len(item) > 1 else True",
  "                if isinstance(label, string) and value is not None:",
  "                    labels.append(text(label))",
  "            if labels:",
  "                send('choice', '', '\\n'.join(labels))",
  "        except Exception:",
  "            pass",
  "        return original_menu(items, *args, **kwargs)",
  // store.menu is saved with the game once it changes, and pickle writes a
  // function as the name it can import it by. A closure has none, so every
  // save failed ("Can't pickle <type 'function'>"). Named as the function it
  // replaces, it is saved as renpy.exports.display_menu - which it now is.
  "    display_menu.__module__ = 'renpy.exports'",
  "    display_menu.__name__ = 'display_menu'",
  "    try:",
  "        display_menu.__qualname__ = 'display_menu'",
  "    except Exception:",
  "        pass",
  "    renpy.exports.display_menu = display_menu",
  "    try:",
  "        if renpy.store.menu is original_menu:",
  "            renpy.store.menu = display_menu",
  "    except Exception:",
  "        pass",
  "    return True",
  "result = _noberu_text_hook()",
].join("\n") + "\n";
