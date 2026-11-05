/* tslint:disable */
/* eslint-disable */

/**
 * A decoded image. Sprites are placed by their anchor: the script's (x, y)
 * is where the point (anchor_x, anchor_y) of the full `bounds` box goes,
 * and the pixels sit at (offset_x, offset_y) inside that box.
 */
export class Image {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * RGBA pixels, row by row (moves them out: call once).
     */
    take_rgba(): Uint8Array;
    anchor_x: number;
    anchor_y: number;
    height: number;
    offset_x: number;
    offset_y: number;
    width: number;
}

/**
 * An archive's index: where each entry is.
 */
export class PakIndex {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Base image per entry (CHARCG: the body a face is drawn on; 0 = none).
     * Empty when the archive has no such table.
     */
    bases(): Uint32Array;
    lengths(): Uint32Array;
    name(i: number): string | undefined;
    /**
     * Byte offsets of every entry (index i = id - id_start).
     */
    offsets(): Float64Array;
    readonly count: number;
    readonly id_start: number;
}

/**
 * The script VM for one game.
 */
export class Player {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Answer the pending choice (0-based).
     */
    choose(i: number): void;
    get_var(v: number): number;
    /**
     * Where the script is, for debugging: "SEEN0514 @1234".
     */
    location(): string;
    /**
     * Compile the game from the whole SCRIPT.PAK.
     */
    constructor(script_pak: Uint8Array, seed: number);
    set_var(v: number, x: number): void;
    /**
     * Restart at a scene (by name, e.g. "SEEN0513"), keeping variables.
     */
    start(scene: string): void;
    /**
     * Run until the page has to act. Returns a JSON array of events.
     */
    step(): string;
}

export function decode_cz(bytes: Uint8Array): Image;

/**
 * Bytes to skip at the start of a MUSIC/SE/VOICE entry to get plain Ogg
 * ("OGGPAK\0", u32 sample rate, u32 length).
 */
export function oggpak_skip(head: Uint8Array): number;

/**
 * Parse the index bytes of an archive `total` bytes long.
 */
export function pak_index(index: Uint8Array, total: number): PakIndex;

/**
 * How many bytes from the start of an archive hold its index (from its first 36).
 */
export function pak_index_len(head: Uint8Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_image_anchor_x: (a: number) => number;
    readonly __wbg_get_image_anchor_y: (a: number) => number;
    readonly __wbg_get_image_height: (a: number) => number;
    readonly __wbg_get_image_offset_x: (a: number) => number;
    readonly __wbg_get_image_offset_y: (a: number) => number;
    readonly __wbg_get_image_width: (a: number) => number;
    readonly __wbg_image_free: (a: number, b: number) => void;
    readonly __wbg_pakindex_free: (a: number, b: number) => void;
    readonly __wbg_player_free: (a: number, b: number) => void;
    readonly __wbg_set_image_anchor_x: (a: number, b: number) => void;
    readonly __wbg_set_image_anchor_y: (a: number, b: number) => void;
    readonly __wbg_set_image_height: (a: number, b: number) => void;
    readonly __wbg_set_image_offset_x: (a: number, b: number) => void;
    readonly __wbg_set_image_offset_y: (a: number, b: number) => void;
    readonly __wbg_set_image_width: (a: number, b: number) => void;
    readonly decode_cz: (a: number, b: number) => [number, number, number];
    readonly image_take_rgba: (a: number) => [number, number];
    readonly oggpak_skip: (a: number, b: number) => number;
    readonly pak_index: (a: number, b: number, c: number) => [number, number, number];
    readonly pak_index_len: (a: number, b: number) => [number, number, number];
    readonly pakindex_bases: (a: number) => [number, number];
    readonly pakindex_count: (a: number) => number;
    readonly pakindex_lengths: (a: number) => [number, number];
    readonly pakindex_name: (a: number, b: number) => [number, number];
    readonly pakindex_offsets: (a: number) => [number, number];
    readonly player_choose: (a: number, b: number) => void;
    readonly player_get_var: (a: number, b: number) => number;
    readonly player_location: (a: number) => [number, number];
    readonly player_new: (a: number, b: number, c: number) => [number, number, number];
    readonly player_set_var: (a: number, b: number, c: number) => void;
    readonly player_start: (a: number, b: number, c: number) => [number, number];
    readonly player_step: (a: number) => [number, number];
    readonly pakindex_id_start: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
