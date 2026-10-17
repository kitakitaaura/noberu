/**
 * noberu's 7z reader, for the library's "add file" and "unzip" (assets/library.js).
 *
 *   NoberuSevenZip.is(firstBytes)   - true when the bytes start a 7z archive
 *   NoberuSevenZip.open(blob)       - resolves to { files, extract(files, sink) }
 *
 * Like the zip reader, nothing is ever held whole: the archive is read in
 * slices straight from the File, decoded a megabyte at a time, and handed to
 * the sink as it comes out, so a 4 GB archive on a phone needs about one
 * dictionary's worth of memory (16-64 MB for usual settings).
 *
 * Most 7z archives are "solid": many files compressed as one stream, which is
 * why extract() takes the whole list and walks it in archive order. Supported
 * methods are the ones 7-Zip actually picks for games - LZMA2, LZMA, the x86
 * BCJ and BCJ2 filters it puts in front of .exe/.dll files, Deflate and Copy.
 * Anything else (PPMd, BZip2, ARM filters, AES encryption) is refused up front
 * with a message that says so, before anything is written.
 */
(function () {
  "use strict";

  const CHUNK = 1024 * 1024;

  const damaged = (what) => new Error(`That 7z is damaged (${what}); download it again.`);

  // --- byte sources ----------------------------------------------------------
  // A source is { read() } resolving to the next Uint8Array, or null at the end.

  function packSource(blob, offset, size) {
    let at = 0;
    return {
      async read() {
        if (at >= size) return null;
        const len = Math.min(CHUNK, size - at);
        const bytes = new Uint8Array(await blob.slice(offset + at, offset + at + len).arrayBuffer());
        if (bytes.length < len) throw new Error("That 7z is cut short; download it again.");
        at += len;
        return bytes;
      },
    };
  }

  // A source buffered so a decoder can look at the next few bytes at once.
  class Input {
    constructor(source) {
      this.source = source;
      this.buf = new Uint8Array(0);
      this.pos = 0;
      this.eof = false;
    }

    get avail() {
      return this.buf.length - this.pos;
    }

    // Buffers at least n bytes, unless the source ends first.
    async fill(n) {
      while (this.avail < n && !this.eof) {
        const chunk = await this.source.read();
        if (!chunk) {
          this.eof = true;
          break;
        }
        const rest = this.buf.subarray(this.pos);
        const next = new Uint8Array(rest.length + chunk.length);
        next.set(rest);
        next.set(chunk, rest.length);
        this.buf = next;
        this.pos = 0;
      }
      return this.avail;
    }
  }

  // --- LZMA ------------------------------------------------------------------
  // After LzmaSpec.cpp in the LZMA SDK. The window is a ring buffer the size of
  // the dictionary (or of the output, when that is smaller), and decode() stops
  // after `limit` bytes so the caller can take them out before they are
  // overwritten. A match cut by that limit carries over in remLen.

  const LIT_SIZE = 0x300;

  class Lzma {
    constructor(size) {
      try {
        this.win = new Uint8Array(size);
      } catch (e) {
        throw new Error(`That 7z needs ${Math.round(size / 1048576)} MB of memory to unpack, more than this ` +
          "browser can give. Re-pack it with a smaller dictionary (64 MB or less).");
      }
      this.size = size;
      this.isMatch = new Uint16Array(192);
      this.isRep = new Uint16Array(12);
      this.isRepG0 = new Uint16Array(12);
      this.isRepG1 = new Uint16Array(12);
      this.isRepG2 = new Uint16Array(12);
      this.isRep0Long = new Uint16Array(192);
      this.posSlot = new Uint16Array(256);
      this.posSpecial = new Uint16Array(115);
      this.align = new Uint16Array(16);
      // choice, choice2, low[16][8], mid[16][8], high[256]
      this.mainLen = new Uint16Array(514);
      this.repLen = new Uint16Array(514);
      this.lit = null;
      this.lc = this.lp = this.pb = 0;
      this.resetDict();
    }

    resetDict() {
      this.pos = 0;
      this.full = false;
      this.total = 0;
    }

    setProps(lc, lp, pb) {
      if (lc > 8 || lp > 4 || pb > 4) throw damaged("bad LZMA settings");
      this.lc = lc;
      this.lp = lp;
      this.pb = pb;
      const n = LIT_SIZE << (lc + lp);
      if (!this.lit || this.lit.length !== n) this.lit = new Uint16Array(n);
    }

    resetState() {
      for (const p of [this.isMatch, this.isRep, this.isRepG0, this.isRepG1, this.isRepG2, this.isRep0Long,
        this.posSlot, this.posSpecial, this.align, this.mainLen, this.repLen, this.lit]) p.fill(1024);
      this.state = 0;
      this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
      this.remLen = 0;
      this.ended = false;
    }

    // Starts the range decoder on the 5 bytes at inp.pos.
    initRc(inp) {
      const b = inp.buf;
      const p = inp.pos;
      if (inp.avail < 5 || b[p] !== 0) throw damaged("bad LZMA stream");
      this.range = 0xffffffff;
      this.code = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0;
      this.inp = inp;
      inp.pos += 5;
    }

    // Stored (uncompressed) LZMA2 chunks go in whole: video and other data
    // that does not compress is all stored, and byte by byte it crawls.
    putBytes(bytes) {
      for (let at = 0; at < bytes.length;) {
        const n = Math.min(bytes.length - at, this.size - this.pos);
        this.win.set(bytes.subarray(at, at + n), this.pos);
        this.pos += n;
        at += n;
        if (this.pos === this.size) {
          this.pos = 0;
          this.full = true;
        }
      }
      this.total = (this.total + bytes.length) & 0x3fffffff;
    }

    // Decodes until `limit` bytes are out, an end marker, or the input passes
    // inEnd (so the caller can refill). Returns how many bytes came out.
    //
    // Everything lives in locals and each range-coder bit is written out where
    // it is used: kept on `this` or behind a call per bit, the 32-bit range
    // and code are re-boxed on every bit and the whole thing runs 2-3x slower.
    // `total` only ever needs its low bits (for pb/lp), so it stays small.
    decode(limit, inEnd) {
      const inp = this.inp;
      const ib = inp.buf;
      const win = this.win;
      const size = this.size;
      const lit = this.lit;
      const isMatch = this.isMatch;
      const isRep = this.isRep;
      const isRepG0 = this.isRepG0;
      const isRepG1 = this.isRepG1;
      const isRepG2 = this.isRepG2;
      const isRep0Long = this.isRep0Long;
      const posSlot = this.posSlot;
      const posSpecial = this.posSpecial;
      const align = this.align;
      const pbMask = (1 << this.pb) - 1;
      const lpMask = (1 << this.lp) - 1;
      const lc = this.lc;
      let ip = inp.pos;
      let range = this.range;
      let code = this.code;
      let pos = this.pos;
      let full = this.full;
      let total = this.total;
      let state = this.state;
      let rep0 = this.rep0;
      let rep1 = this.rep1;
      let rep2 = this.rep2;
      let rep3 = this.rep3;
      let remLen = this.remLen;
      let ended = this.ended;
      let n = 0;
      let prob;
      let bound;
      let b;
      let i;
      let m;

      while (n < limit) {
        let len;
        if (remLen > 0) {
          // A match cut short by the last call's limit.
          len = remLen;
        } else {
          if (ip > inEnd || ended) break;
          const posState = total & pbMask;
          i = (state << 4) + posState;
          prob = isMatch[i];
          bound = (range >>> 11) * prob;
          if (code < bound) {
            range = bound;
            isMatch[i] = prob + ((2048 - prob) >>> 5);
            b = 0;
          } else {
            range -= bound;
            code -= bound;
            isMatch[i] = prob - (prob >>> 5);
            b = 1;
          }
          if (range < 0x1000000) {
            range *= 256;
            code = code * 256 + ib[ip++];
          }
          if (b === 0) {
            const prev = pos > 0 ? win[pos - 1] : full ? win[size - 1] : 0;
            const base = LIT_SIZE * (((total & lpMask) << lc) + (prev >>> (8 - lc)));
            m = 1;
            if (state >= 7) {
              let src = pos - rep0 - 1;
              if (src < 0) src += size;
              let match = win[src];
              do {
                const mb = (match >>> 7) & 1;
                match <<= 1;
                i = base + ((1 + mb) << 8) + m;
                prob = lit[i];
                bound = (range >>> 11) * prob;
                if (code < bound) {
                  range = bound;
                  lit[i] = prob + ((2048 - prob) >>> 5);
                  b = 0;
                } else {
                  range -= bound;
                  code -= bound;
                  lit[i] = prob - (prob >>> 5);
                  b = 1;
                }
                if (range < 0x1000000) {
                  range *= 256;
                  code = code * 256 + ib[ip++];
                }
                m = (m << 1) | b;
                if (mb !== b) break;
              } while (m < 0x100);
            }
            while (m < 0x100) {
              i = base + m;
              prob = lit[i];
              bound = (range >>> 11) * prob;
              if (code < bound) {
                range = bound;
                lit[i] = prob + ((2048 - prob) >>> 5);
                b = 0;
              } else {
                range -= bound;
                code -= bound;
                lit[i] = prob - (prob >>> 5);
                b = 1;
              }
              if (range < 0x1000000) {
                range *= 256;
                code = code * 256 + ib[ip++];
              }
              m = (m << 1) | b;
            }
            win[pos] = m - 0x100;
            if (++pos === size) {
              pos = 0;
              full = true;
            }
            total = (total + 1) & 0x3fffffff;
            state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
            n++;
            continue;
          }

          let lens;
          let isNew = false;
          prob = isRep[state];
          bound = (range >>> 11) * prob;
          if (code < bound) {
            range = bound;
            isRep[state] = prob + ((2048 - prob) >>> 5);
            b = 0;
          } else {
            range -= bound;
            code -= bound;
            isRep[state] = prob - (prob >>> 5);
            b = 1;
          }
          if (range < 0x1000000) {
            range *= 256;
            code = code * 256 + ib[ip++];
          }
          if (b !== 0) {
            if (!full && pos === 0) throw damaged("bad LZMA data");
            prob = isRepG0[state];
            bound = (range >>> 11) * prob;
            if (code < bound) {
              range = bound;
              isRepG0[state] = prob + ((2048 - prob) >>> 5);
              b = 0;
            } else {
              range -= bound;
              code -= bound;
              isRepG0[state] = prob - (prob >>> 5);
              b = 1;
            }
            if (range < 0x1000000) {
              range *= 256;
              code = code * 256 + ib[ip++];
            }
            if (b === 0) {
              i = (state << 4) + posState;
              prob = isRep0Long[i];
              bound = (range >>> 11) * prob;
              if (code < bound) {
                range = bound;
                isRep0Long[i] = prob + ((2048 - prob) >>> 5);
                b = 0;
              } else {
                range -= bound;
                code -= bound;
                isRep0Long[i] = prob - (prob >>> 5);
                b = 1;
              }
              if (range < 0x1000000) {
                range *= 256;
                code = code * 256 + ib[ip++];
              }
              if (b === 0) {
                state = state < 7 ? 9 : 11;
                let src = pos - rep0 - 1;
                if (src < 0) src += size;
                win[pos] = win[src];
                if (++pos === size) {
                  pos = 0;
                  full = true;
                }
                total = (total + 1) & 0x3fffffff;
                n++;
                continue;
              }
            } else {
              let dist;
              prob = isRepG1[state];
              bound = (range >>> 11) * prob;
              if (code < bound) {
                range = bound;
                isRepG1[state] = prob + ((2048 - prob) >>> 5);
                b = 0;
              } else {
                range -= bound;
                code -= bound;
                isRepG1[state] = prob - (prob >>> 5);
                b = 1;
              }
              if (range < 0x1000000) {
                range *= 256;
                code = code * 256 + ib[ip++];
              }
              if (b === 0) {
                dist = rep1;
              } else {
                prob = isRepG2[state];
                bound = (range >>> 11) * prob;
                if (code < bound) {
                  range = bound;
                  isRepG2[state] = prob + ((2048 - prob) >>> 5);
                  b = 0;
                } else {
                  range -= bound;
                  code -= bound;
                  isRepG2[state] = prob - (prob >>> 5);
                  b = 1;
                }
                if (range < 0x1000000) {
                  range *= 256;
                  code = code * 256 + ib[ip++];
                }
                if (b === 0) {
                  dist = rep2;
                } else {
                  dist = rep3;
                  rep3 = rep2;
                }
                rep2 = rep1;
              }
              rep1 = rep0;
              rep0 = dist;
            }
            lens = this.repLen;
            state = state < 7 ? 8 : 11;
          } else {
            rep3 = rep2;
            rep2 = rep1;
            rep1 = rep0;
            lens = this.mainLen;
            state = state < 7 ? 7 : 10;
            isNew = true;
          }

          // Length: choice, choice2, then low[posState], mid[posState] or high.
          let base;
          let bits;
          prob = lens[0];
          bound = (range >>> 11) * prob;
          if (code < bound) {
            range = bound;
            lens[0] = prob + ((2048 - prob) >>> 5);
            b = 0;
          } else {
            range -= bound;
            code -= bound;
            lens[0] = prob - (prob >>> 5);
            b = 1;
          }
          if (range < 0x1000000) {
            range *= 256;
            code = code * 256 + ib[ip++];
          }
          if (b === 0) {
            base = 2 + (posState << 3);
            bits = 3;
            len = 0;
          } else {
            prob = lens[1];
            bound = (range >>> 11) * prob;
            if (code < bound) {
              range = bound;
              lens[1] = prob + ((2048 - prob) >>> 5);
              b = 0;
            } else {
              range -= bound;
              code -= bound;
              lens[1] = prob - (prob >>> 5);
              b = 1;
            }
            if (range < 0x1000000) {
              range *= 256;
              code = code * 256 + ib[ip++];
            }
            if (b === 0) {
              base = 130 + (posState << 3);
              bits = 3;
              len = 8;
            } else {
              base = 258;
              bits = 8;
              len = 16;
            }
          }
          m = 1;
          for (let k = 0; k < bits; k++) {
            i = base + m;
            prob = lens[i];
            bound = (range >>> 11) * prob;
            if (code < bound) {
              range = bound;
              lens[i] = prob + ((2048 - prob) >>> 5);
              b = 0;
            } else {
              range -= bound;
              code -= bound;
              lens[i] = prob - (prob >>> 5);
              b = 1;
            }
            if (range < 0x1000000) {
              range *= 256;
              code = code * 256 + ib[ip++];
            }
            m = (m << 1) + b;
          }
          len += m - (1 << bits);

          if (isNew) {
            const slotBase = (len < 3 ? len : 3) << 6;
            m = 1;
            for (let k = 0; k < 6; k++) {
              i = slotBase + m;
              prob = posSlot[i];
              bound = (range >>> 11) * prob;
              if (code < bound) {
                range = bound;
                posSlot[i] = prob + ((2048 - prob) >>> 5);
                b = 0;
              } else {
                range -= bound;
                code -= bound;
                posSlot[i] = prob - (prob >>> 5);
                b = 1;
              }
              if (range < 0x1000000) {
                range *= 256;
                code = code * 256 + ib[ip++];
              }
              m = (m << 1) + b;
            }
            const slot = m - 64;
            let dist = slot;
            if (slot >= 4) {
              const direct = (slot >>> 1) - 1;
              dist = ((2 | (slot & 1)) << direct) >>> 0;
              if (slot < 14) {
                const specBase = dist - slot;
                m = 1;
                for (let k = 0; k < direct; k++) {
                  i = specBase + m;
                  prob = posSpecial[i];
                  bound = (range >>> 11) * prob;
                  if (code < bound) {
                    range = bound;
                    posSpecial[i] = prob + ((2048 - prob) >>> 5);
                    b = 0;
                  } else {
                    range -= bound;
                    code -= bound;
                    posSpecial[i] = prob - (prob >>> 5);
                    b = 1;
                  }
                  if (range < 0x1000000) {
                    range *= 256;
                    code = code * 256 + ib[ip++];
                  }
                  m = (m << 1) + b;
                  dist += b << k;
                }
              } else {
                let d = 0;
                for (let k = 0; k < direct - 4; k++) {
                  range = range >>> 1;
                  if (code >= range) {
                    code -= range;
                    d = d * 2 + 1;
                  } else {
                    d *= 2;
                  }
                  if (range < 0x1000000) {
                    range *= 256;
                    code = code * 256 + ib[ip++];
                  }
                }
                dist += d * 16;
                m = 1;
                for (let k = 0; k < 4; k++) {
                  prob = align[m];
                  bound = (range >>> 11) * prob;
                  if (code < bound) {
                    range = bound;
                    align[m] = prob + ((2048 - prob) >>> 5);
                    b = 0;
                  } else {
                    range -= bound;
                    code -= bound;
                    align[m] = prob - (prob >>> 5);
                    b = 1;
                  }
                  if (range < 0x1000000) {
                    range *= 256;
                    code = code * 256 + ib[ip++];
                  }
                  m = (m << 1) + b;
                  dist += b << k;
                }
              }
            }
            if (dist === 0xffffffff) {
              ended = true;
              break;
            }
            if (dist >= size || (!full && dist >= pos)) throw damaged("bad LZMA distance");
            rep0 = dist;
          }
          len += 2;
        }

        // Copy the match; it may overlap what it writes, which is how LZ
        // repeats a short pattern.
        const k = Math.min(len, limit - n);
        remLen = len - k;
        n += k;
        let src = pos - rep0 - 1;
        if (src < 0) src += size;
        for (let j = 0; j < k; j++) {
          win[pos] = win[src];
          if (++pos === size) {
            pos = 0;
            full = true;
          }
          if (++src === size) src = 0;
        }
        total = (total + k) & 0x3fffffff;
      }

      inp.pos = ip;
      this.range = range;
      this.code = code;
      this.pos = pos;
      this.full = full;
      this.total = total;
      this.state = state;
      this.rep0 = rep0;
      this.rep1 = rep1;
      this.rep2 = rep2;
      this.rep3 = rep3;
      this.remLen = remLen;
      this.ended = ended;
      if (ip > ib.length) throw damaged("LZMA data runs short");
      return n;
    }

    // A copy of the last n bytes written (n is at most the window size).
    take(n) {
      const out = new Uint8Array(n);
      const pos = this.pos;
      if (n <= pos) {
        out.set(this.win.subarray(pos - n, pos));
      } else {
        const head = n - pos;
        out.set(this.win.subarray(this.size - head));
        out.set(this.win.subarray(0, pos), head);
      }
      return out;
    }
  }

  const windowSize = (dictSize, unpackSize) => Math.max(4096, Math.min(dictSize, unpackSize));

  function lzmaSource(input, props, unpackSize) {
    if (!props || props.length < 5) throw damaged("bad LZMA settings");
    let d = props[0];
    const lc = d % 9;
    d = Math.floor(d / 9);
    const lp = d % 5;
    const pb = Math.floor(d / 5);
    const dictSize = (props[1] | (props[2] << 8) | (props[3] << 16) | (props[4] << 24)) >>> 0;
    const lzma = new Lzma(windowSize(dictSize, unpackSize));
    lzma.setProps(lc, lp, pb);
    lzma.resetState();
    const inp = new Input(input);
    let started = false;
    let out = 0;
    return {
      async read() {
        while (out < unpackSize && !lzma.ended) {
          if (!started) {
            await inp.fill(5);
            lzma.initRc(inp);
            started = true;
          }
          await inp.fill(CHUNK);
          // No symbol reads more than a few dozen bytes, so stopping 300 short
          // of the buffered end can never run past it.
          const inEnd = inp.eof ? inp.buf.length : inp.buf.length - 300;
          const n = lzma.decode(Math.min(CHUNK, lzma.size, unpackSize - out), inEnd);
          if (n > 0) {
            out += n;
            return lzma.take(n);
          }
          if (inp.eof && !lzma.ended) throw damaged("LZMA data runs short");
        }
        return null;
      },
    };
  }

  function lzma2Source(input, props, unpackSize) {
    if (!props || props.length < 1 || props[0] > 40) throw damaged("bad LZMA2 settings");
    const p = props[0];
    const dictSize = p === 40 ? 0xffffffff : (2 | (p & 1)) * 2 ** (Math.floor(p / 2) + 11);
    const lzma = new Lzma(windowSize(dictSize, unpackSize));
    const inp = new Input(input);
    let left = 0; // bytes still to come out of the current chunk
    let copy = false; // the current chunk is stored, not LZMA
    let chunkEnd = 0;
    let haveProps = false;
    let done = false;
    return {
      // Gathers up to a megabyte across chunks (stored ones are at most 64 KB)
      // so storage sees a few large writes rather than many small ones.
      async read() {
        const want = Math.min(CHUNK, lzma.size);
        let produced = 0;
        while (!done && produced < want) {
          if (left === 0) {
            if ((await inp.fill(1)) < 1) throw damaged("LZMA2 data runs short");
            const control = inp.buf[inp.pos];
            if (control === 0) {
              done = true;
              break;
            }
            // A dictionary reset starts the window over, so what is already
            // in it goes out first.
            if (produced > 0 && (control === 1 || control >= 0xe0)) break;
            if (control === 1 || control === 2) {
              if ((await inp.fill(3)) < 3) throw damaged("LZMA2 data runs short");
              left = ((inp.buf[inp.pos + 1] << 8) | inp.buf[inp.pos + 2]) + 1;
              inp.pos += 3;
              if (control === 1) lzma.resetDict();
              copy = true;
            } else if (control >= 0x80) {
              const mode = (control >>> 5) & 3;
              const head = mode >= 2 ? 6 : 5;
              if ((await inp.fill(head)) < head) throw damaged("LZMA2 data runs short");
              const b = inp.buf;
              const at = inp.pos;
              left = (control & 0x1f) * 65536 + ((b[at + 1] << 8) | b[at + 2]) + 1;
              const packed = ((b[at + 3] << 8) | b[at + 4]) + 1;
              if (mode === 3) lzma.resetDict();
              if (mode >= 2) {
                let d = b[at + 5];
                const lc = d % 9;
                d = Math.floor(d / 9);
                lzma.setProps(lc, d % 5, Math.floor(d / 5));
                haveProps = true;
              }
              if (!haveProps) throw damaged("LZMA2 data starts without settings");
              if (mode >= 1) lzma.resetState();
              lzma.remLen = 0;
              // A chunk is at most 64 KB packed, so the whole of it is buffered.
              if ((await inp.fill(head + packed)) < head + packed) throw damaged("LZMA2 data runs short");
              inp.pos += head;
              chunkEnd = inp.pos + packed;
              lzma.initRc(inp);
              copy = false;
            } else {
              throw damaged("bad LZMA2 chunk");
            }
          }

          let n;
          if (copy) {
            n = Math.min(left, want - produced);
            if ((await inp.fill(n)) < n) throw damaged("LZMA2 data runs short");
            lzma.putBytes(inp.buf.subarray(inp.pos, inp.pos + n));
            inp.pos += n;
          } else {
            n = lzma.decode(Math.min(left, want - produced), chunkEnd);
            if (n === 0) throw damaged("bad LZMA2 chunk");
          }
          left -= n;
          produced += n;
          if (left === 0 && !copy) {
            if (lzma.remLen || inp.pos > chunkEnd) throw damaged("bad LZMA2 chunk");
            inp.pos = chunkEnd;
          }
        }
        return produced ? lzma.take(produced) : null;
      },
    };
  }

  // --- filters ---------------------------------------------------------------

  // x86 BCJ, after xz-embedded's bcj_x86(): turns the absolute call/jump
  // addresses the encoder wrote back into relative ones. The last 4 bytes of
  // each chunk wait for the next, since an instruction can straddle the two.
  function bcjSource(input) {
    const allowed = [true, true, true, false, true, false, false, false];
    const bitNum = [0, 1, 2, 2, 3, 3, 3, 3];
    const msb = (b) => b === 0x00 || b === 0xff;
    let prevMask = 0;
    let streamPos = 0;
    let pending = new Uint8Array(0);
    let done = false;

    function filter(buf) {
      if (buf.length <= 4) return 0;
      const size = buf.length - 4;
      let prevPos = -1;
      let i;
      for (i = 0; i < size; i++) {
        if ((buf[i] & 0xfe) !== 0xe8) continue;
        prevPos = i - prevPos;
        if (prevPos > 3) {
          prevMask = 0;
        } else {
          prevMask = (prevMask << (prevPos - 1)) & 7;
          if (prevMask !== 0) {
            const b = buf[i + 4 - bitNum[prevMask]];
            if (!allowed[prevMask] || msb(b)) {
              prevPos = i;
              prevMask = (prevMask << 1) | 1;
              continue;
            }
          }
        }
        prevPos = i;
        if (msb(buf[i + 4])) {
          let src = (buf[i + 1] | (buf[i + 2] << 8) | (buf[i + 3] << 16) | (buf[i + 4] << 24)) >>> 0;
          let dest;
          for (;;) {
            dest = (src - (streamPos + i + 5)) >>> 0;
            if (prevMask === 0) break;
            const j = bitNum[prevMask] * 8;
            if (!msb((dest >>> (24 - j)) & 0xff)) break;
            src = (dest ^ (2 ** (32 - j) - 1)) >>> 0;
          }
          dest &= 0x01ffffff;
          if (dest & 0x01000000) dest |= 0xfe000000;
          buf[i + 1] = dest & 0xff;
          buf[i + 2] = (dest >>> 8) & 0xff;
          buf[i + 3] = (dest >>> 16) & 0xff;
          buf[i + 4] = (dest >>> 24) & 0xff;
          i += 4;
        } else {
          prevMask = (prevMask << 1) | 1;
        }
      }
      prevPos = i - prevPos;
      prevMask = prevPos > 3 ? 0 : prevMask << (prevPos - 1);
      return i;
    }

    return {
      async read() {
        while (!done) {
          const chunk = await input.read();
          if (!chunk) {
            done = true;
            return pending.length ? pending : null;
          }
          const buf = new Uint8Array(pending.length + chunk.length);
          buf.set(pending);
          buf.set(chunk, pending.length);
          const n = filter(buf);
          streamPos += n;
          pending = buf.slice(n);
          if (n) return buf.subarray(0, n);
        }
        return null;
      },
    };
  }

  // x86 BCJ2, after Bcj2_Decode() in the LZMA SDK (9.20; the stream format is
  // unchanged since). Four inputs: the code with its call and jump targets
  // taken out, the call targets, the jump targets, and a range-coded stream
  // saying which E8/E9/Jcc bytes really were calls and jumps.
  function bcj2Source(inputs, unpackSize) {
    if (inputs.length !== 4) throw damaged("bad BCJ2 layout");
    const [main, call, jump, rc] = inputs.map((s) => new Input(s));
    const probs = new Uint16Array(258).fill(1024);
    let range = 0xffffffff;
    let code = 0;
    let started = false;
    let prevByte = 0;
    let outPos = 0;

    return {
      async read() {
        if (outPos >= unpackSize) return null;
        if (!started) {
          if ((await rc.fill(5)) < 5) throw damaged("BCJ2 data runs short");
          for (let i = 0; i < 5; i++) code = code * 256 + rc.buf[rc.pos++];
          started = true;
        }
        // Up to 4 bytes of slack: an address straddling the chunk's end is
        // written whole rather than split across two reads.
        const left = unpackSize - outPos;
        const target = Math.min(CHUNK, left);
        const out = new Uint8Array(Math.min(target + 4, left));
        let n = 0;
        while (n < target) {
          if (main.avail === 0 && (await main.fill(1)) === 0) break;
          const buf = main.buf;
          let p = main.pos;
          let b = -1;
          while (p < buf.length && n < target) {
            const c = buf[p++];
            out[n++] = c;
            if ((c & 0xfe) === 0xe8 || (prevByte === 0x0f && (c & 0xf0) === 0x80)) {
              b = c;
              break;
            }
            prevByte = c;
          }
          main.pos = p;
          if (b < 0) continue;
          if (n === left) break;

          if (rc.avail < 1) await rc.fill(1);
          const i = b === 0xe8 ? prevByte : b === 0xe9 ? 256 : 257;
          const prob = probs[i];
          const bound = (range >>> 11) * prob;
          let taken;
          if (code < bound) {
            range = bound;
            probs[i] = prob + ((2048 - prob) >>> 5);
            taken = false;
          } else {
            range -= bound;
            code -= bound;
            probs[i] = prob - (prob >>> 5);
            taken = true;
          }
          if (range < 0x1000000) {
            range *= 256;
            code = code * 256 + rc.buf[rc.pos++];
          }
          if (!taken) {
            prevByte = b;
            continue;
          }
          const s = b === 0xe8 ? call : jump;
          if ((await s.fill(4)) < 4) throw damaged("BCJ2 data runs short");
          const sb = s.buf;
          const src = ((sb[s.pos] << 24) | (sb[s.pos + 1] << 16) | (sb[s.pos + 2] << 8) | sb[s.pos + 3]) >>> 0;
          s.pos += 4;
          const dest = (src - (outPos + n + 4)) >>> 0;
          for (let k = 0; k < 4 && n < out.length; k++) out[n++] = (dest >>> (8 * k)) & 0xff;
          prevByte = dest >>> 24;
        }
        outPos += n;
        if (n === 0) throw damaged("BCJ2 data runs short");
        return n === out.length ? out : out.slice(0, n);
      },
    };
  }

  function deflateSource(input) {
    const inflate = new fflate.Inflate();
    let out = [];
    let done = false;
    inflate.ondata = (chunk) => out.push(chunk);
    return {
      async read() {
        while (!out.length && !done) {
          const chunk = await input.read();
          if (chunk) {
            inflate.push(chunk);
          } else {
            inflate.push(new Uint8Array(0), true);
            done = true;
          }
        }
        return out.shift() || null;
      },
    };
  }

  // --- methods ---------------------------------------------------------------

  const METHODS = {
    "00": { name: "Copy", make: (inputs) => inputs[0] },
    "21": { name: "LZMA2", make: (inputs, props, size) => lzma2Source(inputs[0], props, size) },
    "030101": { name: "LZMA", make: (inputs, props, size) => lzmaSource(inputs[0], props, size) },
    "03030103": { name: "BCJ", make: (inputs) => bcjSource(inputs[0]) },
    "0303011b": { name: "BCJ2", make: (inputs, props, size) => bcj2Source(inputs, size) },
    "040108": { name: "Deflate", make: (inputs) => deflateSource(inputs[0]) },
  };

  const UNSUPPORTED = {
    "030401": "PPMd",
    "040202": "BZip2",
    "040109": "Deflate64",
    "03": "Delta",
    "03030205": "PPC",
    "03030401": "IA64",
    "03030501": "ARM",
    "03030701": "ARMT",
    "03030805": "SPARC",
    "0a": "ARM64",
    "0b": "RISC-V",
  };

  function checkMethod(id) {
    if (METHODS[id]) return;
    if (id === "06f10701") throw new Error("That 7z is password-protected; unpack it on a computer first.");
    throw new Error(`That 7z uses ${UNSUPPORTED[id] || "a compression method"} (${id}), which this can't unpack. ` +
      "Re-pack it as 7z with the usual LZMA2 setting, or as a zip.");
  }

  // --- header ----------------------------------------------------------------

  class Reader {
    constructor(bytes) {
      this.b = bytes;
      this.pos = 0;
    }

    byte() {
      if (this.pos >= this.b.length) throw damaged("its file list is cut short");
      return this.b[this.pos++];
    }

    // 7z's variable-length number: the leading 1 bits of the first byte say
    // how many little-endian bytes follow.
    number() {
      const first = this.byte();
      let mask = 0x80;
      let value = 0;
      for (let i = 0; i < 8; i++) {
        if ((first & mask) === 0) return value + (first & (mask - 1)) * 2 ** (8 * i);
        value += this.byte() * 2 ** (8 * i);
        mask >>>= 1;
      }
      return value;
    }

    u32() {
      let v = 0;
      for (let i = 0; i < 4; i++) v += this.byte() * 2 ** (8 * i);
      return v;
    }

    bytes(n) {
      if (this.pos + n > this.b.length) throw damaged("its file list is cut short");
      const out = this.b.subarray(this.pos, this.pos + n);
      this.pos += n;
      return out;
    }

    bits(n) {
      const out = [];
      let byte = 0;
      for (let i = 0; i < n; i++) {
        if (i % 8 === 0) byte = this.byte();
        out.push((byte & (0x80 >>> (i % 8))) !== 0);
      }
      return out;
    }

    // An "all defined" byte, else a bit per item.
    defined(n) {
      return this.byte() ? new Array(n).fill(true) : this.bits(n);
    }

    expect(id) {
      if (this.byte() !== id) throw damaged("unexpected data in its file list");
    }
  }

  function readDigests(r, n) {
    const defined = r.defined(n);
    for (const d of defined) if (d) r.u32();
    return defined;
  }

  function readFolder(r) {
    const coders = [];
    const numCoders = r.number();
    for (let i = 0; i < numCoders; i++) {
      const flags = r.byte();
      if (flags & 0x80) throw new Error("That 7z uses alternative coders, which this can't unpack.");
      const id = [...r.bytes(flags & 0x0f)].map((x) => x.toString(16).padStart(2, "0")).join("") || "00";
      let numIn = 1;
      if (flags & 0x10) {
        numIn = r.number();
        if (r.number() !== 1) throw new Error("That 7z uses a coder layout this can't unpack.");
      }
      const props = flags & 0x20 ? r.bytes(r.number()).slice() : null;
      coders.push({ id, numIn, props });
    }
    const totalIn = coders.reduce((sum, c) => sum + c.numIn, 0);
    const bindPairs = [];
    for (let i = 0; i < numCoders - 1; i++) bindPairs.push({ inIndex: r.number(), outIndex: r.number() });
    const numPacked = totalIn - bindPairs.length;
    const packed = [];
    if (numPacked === 1) {
      for (let i = 0; i < totalIn; i++) {
        if (!bindPairs.some((bp) => bp.inIndex === i)) {
          packed.push(i);
          break;
        }
      }
    } else {
      for (let i = 0; i < numPacked; i++) packed.push(r.number());
    }
    return { coders, bindPairs, packed, unpackSizes: [], numStreams: 1, sizes: [] };
  }

  function readStreamsInfo(r) {
    const s = { packPos: 0, packSizes: [], folders: [] };
    let id = r.byte();
    if (id === 0x06) {
      s.packPos = r.number();
      const n = r.number();
      for (;;) {
        id = r.byte();
        if (id === 0) break;
        if (id === 0x09) for (let i = 0; i < n; i++) s.packSizes.push(r.number());
        else if (id === 0x0a) readDigests(r, n);
        else throw damaged("unexpected data in its file list");
      }
      id = r.byte();
    }
    if (id === 0x07) {
      r.expect(0x0b);
      const n = r.number();
      if (r.byte() !== 0) throw new Error("That 7z keeps its file list elsewhere, which this can't read.");
      for (let i = 0; i < n; i++) s.folders.push(readFolder(r));
      r.expect(0x0c);
      for (const f of s.folders) for (let i = 0; i < f.coders.length; i++) f.unpackSizes.push(r.number());
      id = r.byte();
      if (id === 0x0a) {
        readDigests(r, n).forEach((d, i) => { s.folders[i].crcDefined = d; });
        id = r.byte();
      }
      if (id !== 0) throw damaged("unexpected data in its file list");
      id = r.byte();
    }

    // The folder's output is the one coder output no bind pair consumes.
    let packIndex = 0;
    let offset = 32 + s.packPos;
    const packOffsets = s.packSizes.map((size) => {
      const at = offset;
      offset += size;
      return at;
    });
    for (const f of s.folders) {
      f.main = f.coders.findIndex((c, i) => !f.bindPairs.some((bp) => bp.outIndex === i));
      f.unpackSize = f.unpackSizes[f.main];
      f.packOffsets = f.packed.map((_, i) => packOffsets[packIndex + i]);
      f.packSizes = f.packed.map((_, i) => s.packSizes[packIndex + i]);
      packIndex += f.packed.length;
      f.sizes = [f.unpackSize];
    }

    if (id === 0x08) {
      id = r.byte();
      if (id === 0x0d) {
        for (const f of s.folders) f.numStreams = r.number();
        id = r.byte();
      }
      for (const f of s.folders) {
        if (f.numStreams === 1) continue;
        f.sizes = [];
        if (f.numStreams === 0) continue;
        if (id !== 0x09) throw damaged("its file sizes are missing");
        let sum = 0;
        for (let i = 0; i < f.numStreams - 1; i++) {
          const size = r.number();
          f.sizes.push(size);
          sum += size;
        }
        f.sizes.push(f.unpackSize - sum);
      }
      if (id === 0x09) id = r.byte();
      if (id === 0x0a) {
        readDigests(r, s.folders.reduce((sum, f) => sum + (f.numStreams === 1 && f.crcDefined ? 0 : f.numStreams), 0));
        id = r.byte();
      }
      if (id !== 0) throw damaged("unexpected data in its file list");
      id = r.byte();
    }
    if (id !== 0) throw damaged("unexpected data in its file list");
    return s;
  }

  function readFilesInfo(r) {
    const n = r.number();
    const files = [];
    for (let i = 0; i < n; i++) files.push({ name: "", size: 0, dir: false, emptyStream: false, anti: false });
    let emptyStreams = [];
    let emptyFiles = [];
    let anti = [];
    for (;;) {
      const type = r.byte();
      if (type === 0) break;
      const size = r.number();
      const end = r.pos + size;
      if (type === 0x0e) {
        emptyStreams = r.bits(n);
      } else if (type === 0x0f) {
        emptyFiles = r.bits(emptyStreams.filter(Boolean).length);
      } else if (type === 0x10) {
        anti = r.bits(emptyStreams.filter(Boolean).length);
      } else if (type === 0x11) {
        if (r.byte() !== 0) throw new Error("That 7z keeps its file names elsewhere, which this can't read.");
        const names = new TextDecoder("utf-16le").decode(r.bytes(end - r.pos)).split("\0");
        for (let i = 0; i < n; i++) files[i].name = names[i] || "";
      } else if (type === 0x15) {
        const defined = r.defined(n);
        r.byte(); // external
        defined.forEach((d, i) => {
          if (d && r.u32() & 0x10) files[i].dir = true;
        });
      }
      r.pos = end;
    }
    let empty = 0;
    files.forEach((f, i) => {
      if (!emptyStreams[i]) return;
      f.emptyStream = true;
      if (!emptyFiles[empty]) f.dir = true;
      if (anti[empty]) f.anti = true;
      empty++;
    });
    return files;
  }

  // --- decoding a folder -----------------------------------------------------

  function folderSource(blob, folder) {
    const inStart = [];
    let at = 0;
    for (const c of folder.coders) {
      inStart.push(at);
      at += c.numIn;
    }
    const build = (coderIndex) => {
      const coder = folder.coders[coderIndex];
      const inputs = [];
      for (let k = 0; k < coder.numIn; k++) {
        const inIndex = inStart[coderIndex] + k;
        const bp = folder.bindPairs.find((b) => b.inIndex === inIndex);
        if (bp) {
          inputs.push(build(bp.outIndex));
        } else {
          const p = folder.packed.indexOf(inIndex);
          if (p < 0) throw damaged("bad coder layout");
          inputs.push(packSource(blob, folder.packOffsets[p], folder.packSizes[p]));
        }
      }
      checkMethod(coder.id);
      return METHODS[coder.id].make(inputs, coder.props, folder.unpackSizes[coderIndex]);
    };
    return build(folder.main);
  }

  // Hands out exactly the bytes asked for from a source's uneven chunks.
  function splitter(source) {
    let chunk = null;
    let at = 0;
    return async function next(max) {
      while (!chunk || at >= chunk.length) {
        chunk = await source.read();
        at = 0;
        if (!chunk) throw damaged("a file in it is cut short");
      }
      const n = Math.min(max, chunk.length - at);
      const piece = chunk.subarray(at, at + n);
      at += n;
      return piece;
    };
  }

  async function readAll(source, size) {
    const out = new Uint8Array(size);
    const next = splitter(source);
    for (let at = 0; at < size;) {
      const piece = await next(size - at);
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  }

  // --- the archive -----------------------------------------------------------

  const SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

  function is(bytes) {
    return SIGNATURE.every((b, i) => bytes[i] === b);
  }

  async function open(blob) {
    const start = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (start.length < 32 || !is(start)) throw new Error("That file is not a 7z archive.");
    const sr = new Reader(start);
    sr.pos = 12;
    const nextOffset = sr.u32() + sr.u32() * 2 ** 32;
    const nextSize = sr.u32() + sr.u32() * 2 ** 32;
    if (nextSize === 0) return { files: [], async extract() { } };
    if (32 + nextOffset + nextSize > blob.size) throw new Error("That 7z is cut short; download it again.");
    let header = new Uint8Array(await blob.slice(32 + nextOffset, 32 + nextOffset + nextSize).arrayBuffer());

    // The file list is usually itself compressed ("encoded header").
    let r;
    for (;;) {
      r = new Reader(header);
      const id = r.byte();
      if (id === 0x01) break;
      if (id !== 0x17) throw damaged("its file list is unreadable");
      const streams = readStreamsInfo(r);
      const folder = streams.folders[0];
      if (!folder) throw damaged("its file list is unreadable");
      for (const c of folder.coders) checkMethod(c.id);
      header = await readAll(folderSource(blob, folder), folder.unpackSize);
    }

    let id = r.byte();
    if (id === 0x02) {
      for (;;) {
        const type = r.byte();
        if (type === 0) break;
        r.bytes(r.number());
      }
      id = r.byte();
    }
    if (id === 0x03) {
      readStreamsInfo(r);
      id = r.byte();
    }
    let streams = { folders: [] };
    if (id === 0x04) {
      streams = readStreamsInfo(r);
      id = r.byte();
    }
    let all = [];
    if (id === 0x05) {
      all = readFilesInfo(r);
      id = r.byte();
    }
    if (id !== 0) throw damaged("unexpected data in its file list");

    // Files with data take the folders' streams in order.
    const folders = streams.folders;
    let fi = 0;
    let si = 0;
    for (const f of all) {
      if (f.emptyStream) continue;
      while (fi < folders.length && si >= folders[fi].numStreams) {
        fi++;
        si = 0;
      }
      if (fi >= folders.length) throw damaged("more files than data");
      f.folder = fi;
      f.size = folders[fi].sizes[si++];
    }
    for (const folder of folders) for (const c of folder.coders) checkMethod(c.id);

    const files = all.filter((f) => !f.anti);
    return {
      files,
      // sink: { start(file), write(bytes), end() }, all awaited. Files not in
      // `wanted` are decoded and dropped when they share a folder with ones
      // that are, and skipped outright when they don't.
      async extract(wanted, sink) {
        const want = new Set(wanted);
        for (let i = 0; i < folders.length; i++) {
          const members = all.filter((f) => !f.emptyStream && f.folder === i);
          if (!members.some((f) => want.has(f))) continue;
          const next = splitter(folderSource(blob, folders[i]));
          for (const f of members) {
            const keep = want.has(f);
            if (keep) await sink.start(f);
            for (let left = f.size; left > 0;) {
              const piece = await next(Math.min(left, CHUNK));
              if (keep) await sink.write(piece);
              left -= piece.length;
            }
            if (keep) await sink.end();
          }
        }
        for (const f of files) {
          if (f.emptyStream && want.has(f)) {
            await sink.start(f);
            await sink.end();
          }
        }
      },
    };
  }

  window.NoberuSevenZip = { is, open };
})();
