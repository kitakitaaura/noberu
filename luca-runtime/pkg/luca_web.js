/* @ts-self-types="./luca_web.d.ts" */

/**
 * A decoded image. Sprites are placed by their anchor: the script's (x, y)
 * is where the point (anchor_x, anchor_y) of the full `bounds` box goes,
 * and the pixels sit at (offset_x, offset_y) inside that box.
 */
export class Image {
    static __wrap(ptr) {
        const obj = Object.create(Image.prototype);
        obj.__wbg_ptr = ptr;
        ImageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_image_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get anchor_x() {
        const ret = wasm.__wbg_get_image_anchor_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get anchor_y() {
        const ret = wasm.__wbg_get_image_anchor_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get height() {
        const ret = wasm.__wbg_get_image_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get offset_x() {
        const ret = wasm.__wbg_get_image_offset_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get offset_y() {
        const ret = wasm.__wbg_get_image_offset_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.__wbg_get_image_width(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * RGBA pixels, row by row (moves them out: call once).
     * @returns {Uint8Array}
     */
    take_rgba() {
        const ret = wasm.image_take_rgba(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} arg0
     */
    set anchor_x(arg0) {
        wasm.__wbg_set_image_anchor_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set anchor_y(arg0) {
        wasm.__wbg_set_image_anchor_y(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set height(arg0) {
        wasm.__wbg_set_image_height(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set offset_x(arg0) {
        wasm.__wbg_set_image_offset_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set offset_y(arg0) {
        wasm.__wbg_set_image_offset_y(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set width(arg0) {
        wasm.__wbg_set_image_width(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Image.prototype[Symbol.dispose] = Image.prototype.free;

/**
 * An archive's index: where each entry is.
 */
export class PakIndex {
    static __wrap(ptr) {
        const obj = Object.create(PakIndex.prototype);
        obj.__wbg_ptr = ptr;
        PakIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PakIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pakindex_free(ptr, 0);
    }
    /**
     * Base image per entry (CHARCG: the body a face is drawn on; 0 = none).
     * Empty when the archive has no such table.
     * @returns {Uint32Array}
     */
    bases() {
        const ret = wasm.pakindex_bases(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get count() {
        const ret = wasm.pakindex_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get id_start() {
        const ret = wasm.pakindex_id_start(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint32Array}
     */
    lengths() {
        const ret = wasm.pakindex_lengths(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} i
     * @returns {string | undefined}
     */
    name(i) {
        const ret = wasm.pakindex_name(this.__wbg_ptr, i);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Byte offsets of every entry (index i = id - id_start).
     * @returns {Float64Array}
     */
    offsets() {
        const ret = wasm.pakindex_offsets(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) PakIndex.prototype[Symbol.dispose] = PakIndex.prototype.free;

/**
 * The script VM for one game.
 */
export class Player {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PlayerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_player_free(ptr, 0);
    }
    /**
     * Answer the pending choice (0-based).
     * @param {number} i
     */
    choose(i) {
        wasm.player_choose(this.__wbg_ptr, i);
    }
    /**
     * @param {number} v
     * @returns {number}
     */
    get_var(v) {
        const ret = wasm.player_get_var(this.__wbg_ptr, v);
        return ret;
    }
    /**
     * Where the script is, for debugging: "SEEN0514 @1234".
     * @returns {string}
     */
    location() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.player_location(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Compile the game from the whole SCRIPT.PAK.
     * @param {Uint8Array} script_pak
     * @param {number} seed
     */
    constructor(script_pak, seed) {
        const ptr0 = passArray8ToWasm0(script_pak, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.player_new(ptr0, len0, seed);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        PlayerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} v
     * @param {number} x
     */
    set_var(v, x) {
        wasm.player_set_var(this.__wbg_ptr, v, x);
    }
    /**
     * Restart at a scene (by name, e.g. "SEEN0513"), keeping variables.
     * @param {string} scene
     */
    start(scene) {
        const ptr0 = passStringToWasm0(scene, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.player_start(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Run until the page has to act. Returns a JSON array of events.
     * @returns {string}
     */
    step() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.player_step(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Player.prototype[Symbol.dispose] = Player.prototype.free;

/**
 * @param {Uint8Array} bytes
 * @returns {Image}
 */
export function decode_cz(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decode_cz(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Image.__wrap(ret[0]);
}

/**
 * Bytes to skip at the start of a MUSIC/SE/VOICE entry to get plain Ogg
 * ("OGGPAK\0", u32 sample rate, u32 length).
 * @param {Uint8Array} head
 * @returns {number}
 */
export function oggpak_skip(head) {
    const ptr0 = passArray8ToWasm0(head, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.oggpak_skip(ptr0, len0);
    return ret >>> 0;
}

/**
 * Parse the index bytes of an archive `total` bytes long.
 * @param {Uint8Array} index
 * @param {number} total
 * @returns {PakIndex}
 */
export function pak_index(index, total) {
    const ptr0 = passArray8ToWasm0(index, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pak_index(ptr0, len0, total);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PakIndex.__wrap(ret[0]);
}

/**
 * How many bytes from the start of an archive hold its index (from its first 36).
 * @param {Uint8Array} head
 * @returns {number}
 */
export function pak_index_len(head) {
    const ptr0 = passArray8ToWasm0(head, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pak_index_len(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./luca_web_bg.js": import0,
    };
}

const ImageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_image_free(ptr, 1));
const PakIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pakindex_free(ptr, 1));
const PlayerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_player_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('luca_web_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
