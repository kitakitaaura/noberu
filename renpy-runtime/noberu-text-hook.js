// Ren'Py's dialogue and menus for noberu's reading tools (assets/text.js)
// and its walkthrough (assets/walkthrough.js).
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
// For the walkthrough, each menu is also sent to NoberuChoiceB64 (below) as
// {seen, line, pos, options}: seen is the label the menu statement sits
// under, line the menu's number among that label's menus (depth first, from
// 0), pos its file:line, and options every item of the statement in order,
// so an option's index is the value the menu returns (a caption is an item
// that is never shown). The pick comes back through window.noberuSelect: a
// periodic callback takes it from the page and ends the menu's interaction
// with that value, as a click on the option would.
//
// Everything lives inside one function: renpy_exec runs code with separate
// globals and locals, so a function defined at the top level could not see
// its neighbours. Closures can.
window.NOBERU_RENPY_TEXT_HOOK = [
  "def _noberu_text_hook():",
  "    import renpy, re, json, base64",
  // renpy_exec runs in the game's store, where list and dict are Ren'Py's
  // revertable ones; the script's own blocks are plain lists. (On Python 2,
  // `builtins` may be the future package's, whose list is another class.)
  "    try:",
  "        import __builtin__ as builtins",
  "    except ImportError:",
  "        import builtins",
  "    list, tuple, dict = builtins.list, builtins.tuple, builtins.dict",
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
  "    def report(name, data):",
  "        try:",
  "            data = json.dumps(data, ensure_ascii=True)",
  "            if not isinstance(data, bytes):",
  "                data = data.encode('ascii')",
  "            b64 = base64.b64encode(data)",
  "            if not isinstance(b64, str):",
  "                b64 = b64.decode('ascii')",
  "            em.run_script(\"window.%s && window.%s('%s')\" % (name, name, b64))",
  "        except Exception:",
  "            pass",
  // The label each menu statement sits under and its number there, found
  // once by walking every label's statements (the same walk as
  // tools/walkthrough/renpy_script.py).
  "    places = {}",
  "    def place(node):",
  "        if not places:",
  "            ast = renpy.ast",
  "            def walk(block, label, count):",
  "                for n in block or ():",
  "                    if isinstance(n, ast.Label):",
  "                        continue",
  "                    kids = []",
  "                    if isinstance(n, ast.Menu):",
  "                        places[n.name] = (label, count[0])",
  "                        count[0] += 1",
  "                        kids = [e[-1] for e in n.items if isinstance(e[-1], list)]",
  "                    if isinstance(getattr(n, 'block', None), list):",
  "                        kids.append(n.block)",
  "                    for e in getattr(n, 'entries', None) or ():",
  "                        if isinstance(e, (tuple, list)) and isinstance(e[-1], list):",
  "                            kids.append(e[-1])",
  "                    for k in kids:",
  "                        walk(k, label, count)",
  "            for n in list(renpy.game.script.namemap.values()):",
  "                if isinstance(n, ast.Label) and isinstance(n.name, string):",
  "                    walk(n.block, n.name, [0])",
  "            places[None] = None",
  "        return places.get(node.name)",
  "    menu = {'values': None, 'actions': None, 'depth': None}",
  "    def periodic():",
  "        values = menu['values']",
  "        if values is None or len(renpy.game.contexts) != menu['depth']:",
  "            return",
  "        try:",
  "            i = em.run_script_int('window.noberuTakePick ? window.noberuTakePick() : -1')",
  "        except Exception:",
  "            return",
  "        if i < 0 or i >= len(values) or values[i] is None:",
  "            return",
  "        action = menu['actions'].get(i)",
  "        if action is not None:",
  "            action()",
  "        raise renpy.display.core.EndInteraction(values[i])",
  "    renpy.config.periodic_callbacks.append(periodic)",
  "    def where(items):",
  "        given = {}",
  "        for item in items:",
  "            if isinstance(item, (tuple, list)) and len(item) > 1 and item[1] is not None:",
  "                given[getattr(item[1], 'value', item[1])] = item[1]",
  "        node = renpy.game.script.lookup(renpy.game.context().current)",
  "        at = place(node) if isinstance(node, renpy.ast.Menu) else None",
  "        if at is not None:",
  "            values = [i if i in given else None for i in range(len(node.items))]",
  "            labels = [e[0] for e in node.items]",
  "        else:",
  "            at = ('', -1)",
  "            values = [getattr(item[1], 'value', item[1]) if isinstance(item, (tuple, list)) and len(item) > 1 else None for item in items]",
  "            labels = [item[0] if isinstance(item, (tuple, list)) else '' for item in items]",
  "        options = [{'text': text(l), 'shown': v is not None} for l, v in zip(labels, values)]",
  "        actions = dict((i, given[v]) for i, v in enumerate(values) if v is not None and callable(given.get(v)))",
  "        report('NoberuChoiceB64', {'seen': at[0], 'line': at[1], 'pos': '%s:%d' % (node.filename, node.linenumber), 'options': options})",
  "        return {'values': values, 'actions': actions, 'depth': len(renpy.game.contexts)}",
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
  "        if kwargs.get('interact', True) is False or kwargs.get('predict_only'):",
  "            return original_menu(items, *args, **kwargs)",
  "        try:",
  "            choice = where(items)",
  "        except Exception:",
  "            return original_menu(items, *args, **kwargs)",
  "        outer = dict(menu)",
  "        menu.update(choice)",
  "        made = -1",
  "        try:",
  "            rv = original_menu(items, *args, **kwargs)",
  "            if rv is not None and rv in choice['values']:",
  "                made = choice['values'].index(rv)",
  "            return rv",
  "        finally:",
  "            menu.update(outer)",
  "            report('NoberuChoiceMadeB64', made)",
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
  // store.menu, and any other name a game kept the original under (KSRE's
  // menu shuffles the items, then calls `renpy_menu`, saved at init).
  "    try:",
  "        for name, value in list(vars(renpy.store).items()):",
  "            if value is original_menu:",
  "                setattr(renpy.store, name, display_menu)",
  "    except Exception:",
  "        pass",
  "    return True",
  "result = _noberu_text_hook()",
].join("\n") + "\n";

// The walkthrough's side of the menus (assets/walkthrough.js): the choice on
// screen, the pick that closed it, and a pick waiting for the periodic
// callback above.
(function () {
  "use strict";
  let onScreen = false;
  let pick = -1;
  const host = () => { try { return window.top.NoberuWalkthrough || null; } catch (error) { return null; } };
  const decode = (b64) => JSON.parse(new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  window.NoberuChoiceB64 = (b64) => {
    onScreen = true;
    pick = -1;
    const h = host();
    if (h) h.choice(window, decode(b64));
  };
  window.NoberuChoiceMadeB64 = (b64) => {
    onScreen = false;
    pick = -1;
    const h = host();
    if (h) h.made(window, decode(b64));
  };
  // True if a menu is on screen to take it.
  window.noberuSelect = (index) => {
    if (!onScreen) return false;
    pick = index;
    return true;
  };
  window.noberuTakePick = () => {
    const p = pick;
    pick = -1;
    return p;
  };
})();
