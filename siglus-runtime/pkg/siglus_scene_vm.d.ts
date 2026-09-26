/* tslint:disable */
/* eslint-disable */

export function siglus_wasm_start(canvas_id: string): void;

/**
 * Convenience export for JavaScript-side diagnostics.
 */
export function siglus_wasm_vfs_exists(path: string): boolean;

/**
 * Convenience export for JavaScript-side diagnostics.
 */
export function siglus_wasm_vfs_file_count(): number;

/**
 * Convenience export for JavaScript-side diagnostics.
 */
export function siglus_wasm_vfs_read_len(path: string): number;

export function start_siglus_from_directory(canvas_id: string, files_json: string): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly siglus_game_cover_mime_from_dir: (a: number) => number;
    readonly siglus_game_cover_path_from_dir: (a: number) => number;
    readonly siglus_game_name_from_dir: (a: number) => number;
    readonly siglus_string_free: (a: number) => void;
    readonly siglus_wasm_start: (a: number, b: number, c: number) => void;
    readonly siglus_wasm_vfs_exists: (a: number, b: number) => number;
    readonly siglus_wasm_vfs_read_len: (a: number, b: number, c: number) => void;
    readonly start_siglus_from_directory: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly siglus_wasm_vfs_file_count: () => number;
    readonly wmv2_decoder_create: (a: number, b: number, c: number, d: number) => number;
    readonly wmv2_decoder_decode: (a: number, b: number, c: number, d: number) => number;
    readonly wmv2_decoder_destroy: (a: number) => void;
    readonly wmv2_decoder_get_frame: (a: number, b: number) => number;
    readonly wgpu_render_bundle_draw: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wgpu_render_bundle_draw_indexed: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wgpu_render_bundle_set_pipeline: (a: number, b: bigint) => void;
    readonly wgpu_render_bundle_draw_indirect: (a: number, b: bigint, c: bigint) => void;
    readonly wgpu_render_bundle_set_bind_group: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wgpu_render_bundle_set_vertex_buffer: (a: number, b: number, c: bigint, d: bigint, e: bigint) => void;
    readonly wgpu_render_bundle_set_push_constants: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wgpu_render_bundle_draw_indexed_indirect: (a: number, b: bigint, c: bigint) => void;
    readonly wgpu_render_bundle_insert_debug_marker: (a: number, b: number) => void;
    readonly wgpu_render_bundle_pop_debug_group: (a: number) => void;
    readonly wgpu_render_bundle_set_index_buffer: (a: number, b: bigint, c: number, d: bigint, e: bigint) => void;
    readonly wgpu_render_bundle_push_debug_group: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_8317: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_8926: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_9407: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_4304: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_8480: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_8931: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_8476: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_2: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_3: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_4: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_5: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_6: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_7: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8476_8: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8475: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_4446: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_4446_15: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_8473: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_8488: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_9444: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
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
