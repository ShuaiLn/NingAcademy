import { describe, expect, it } from "vitest";
import { inspectStudyImage, resizedStudyDimensions } from "./study-image";
function png(width: number, height: number) {
  const bytes = new Uint8Array(33); bytes.set([137,80,78,71,13,10,26,10]);
  bytes.set([73,72,68,82],12); const view = new DataView(bytes.buffer);
  view.setUint32(8,13); view.setUint32(16,width); view.setUint32(20,height); return bytes;
}
function jpeg(orientation: number) {
  const bytes = new Uint8Array(50); bytes.set([255,216,255,225,0,34,69,120,105,102,0,0]);
  const view = new DataView(bytes.buffer); bytes.set([73,73,42,0,8,0,0,0,1,0],12);
  view.setUint16(22,0x112,true); view.setUint16(24,3,true); view.setUint32(26,1,true); view.setUint16(30,orientation,true);
  bytes.set([255,192,0,10,8],38); view.setUint16(43,3000); view.setUint16(45,2400); bytes.set([255,217],48); return bytes;
}
describe("study image preflight before decode", () => {
  it("uses magic bytes and validates PNG dimensions", () => {
    expect(inspectStudyImage(png(2400,3000))).toMatchObject({type:"image/png",width:2400,height:3000});
    for (const [w,h] of [[0,2],[8193,1],[5000,5000]]) expect(() => inspectStudyImage(png(w,h))).toThrow();
    expect(() => inspectStudyImage(new Uint8Array(10*1024*1024+1))).toThrow();
    expect(() => inspectStudyImage(new TextEncoder().encode("fake.png"))).toThrow();
  });
  it.each([1,2,3,4,5,6,7,8])("accounts for EXIF orientation %i before direct resize", orientation => {
    const header = inspectStudyImage(jpeg(orientation)); expect(header.orientation).toBe(orientation);
    expect(resizedStudyDimensions(header)).toEqual(orientation>=5 ? {width:2200,height:1760} : {width:1760,height:2200});
  });
  it("rejects malformed JPEG segments and orientation", () => {
    expect(() => inspectStudyImage(jpeg(9))).toThrow();
    const invalid = jpeg(1); invalid[5] = 255; expect(() => inspectStudyImage(invalid)).toThrow();
  });
  it("reads WebP VP8X and rejects animation and truncated RIFF", () => {
    const bytes = new Uint8Array(30); const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("RIFF")); view.setUint32(4,22,true);
    bytes.set(new TextEncoder().encode("WEBPVP8X"),8); view.setUint32(16,10,true); bytes[24]=99;bytes[27]=199;
    expect(inspectStudyImage(bytes)).toMatchObject({type:"image/webp",width:100,height:200});
    bytes[20]=2; expect(() => inspectStudyImage(bytes)).toThrow();
    expect(() => inspectStudyImage(bytes.slice(0,25))).toThrow();
  });
  it("does not upscale small inputs", () => {
    expect(resizedStudyDimensions(inspectStudyImage(png(200,100)))).toEqual({width:200,height:100});
  });
});
