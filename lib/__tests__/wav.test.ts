import { describe, expect, it } from "vitest";
import { encodeWav } from "../wav";

describe("encodeWav", () => {
  it("writes a valid stereo PCM16 header and interleaves samples", () => {
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([1, -1, 0.25, -0.25]);
    const wav = encodeWav([left, right], 44_100);
    const view = new DataView(wav);

    const ascii = (at: number, length: number) =>
      Array.from({ length }, (_, i) =>
        String.fromCharCode(view.getUint8(at + i)),
      ).join("");

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2); // frames * ch * 2 bytes
    expect(wav.byteLength).toBe(44 + 16);
    // frame 0: L=0, R=max
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    // clipping clamps instead of wrapping
    expect(view.getInt16(50, true)).toBe(-32767);
  });
});
