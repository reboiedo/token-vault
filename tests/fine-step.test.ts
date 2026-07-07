/** Modifier-aware fine stepping used by the color scale editor + surfaces. */
import { describe, expect, it } from "vitest";
import { fineStepKeyDown } from "../src/app/lib/fine-step";

type Ev = { key: string; shiftKey?: boolean };
function press(ev: Ev, opts: Omit<Parameters<typeof fineStepKeyDown>[1], "onChange">) {
  let out: number | undefined;
  const e = {
    ...ev,
    shiftKey: ev.shiftKey ?? false,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Parameters<typeof fineStepKeyDown>[0];
  fineStepKeyDown(e, { ...opts, onChange: (n) => (out = n) });
  return out;
}

describe("fineStepKeyDown", () => {
  const base = { value: 0.5, step: 0.01, min: 0, max: 1 };

  it("nudges by step on a plain arrow", () => {
    expect(press({ key: "ArrowUp" }, base)).toBe(0.51);
    expect(press({ key: "ArrowDown" }, base)).toBe(0.49);
  });

  it("nudges by the fine step (step/10) with Shift", () => {
    expect(press({ key: "ArrowUp", shiftKey: true }, base)).toBe(0.501);
    expect(press({ key: "ArrowDown", shiftKey: true }, base)).toBe(0.499);
  });

  it("kills floating-point drift", () => {
    expect(press({ key: "ArrowUp" }, { ...base, value: 0.07 })).toBe(0.08);
    expect(press({ key: "ArrowUp", shiftKey: true }, { ...base, value: 0.129 })).toBe(0.13);
  });

  it("clamps to min/max", () => {
    expect(press({ key: "ArrowUp" }, { ...base, value: 1 })).toBeUndefined(); // already at max → no change
    expect(press({ key: "ArrowDown" }, { ...base, value: 0 })).toBeUndefined();
  });

  it("honors an explicit fineStep and hue-style step of 1", () => {
    expect(press({ key: "ArrowUp", shiftKey: true }, { value: 200, step: 1, min: 0, max: 360 })).toBe(200.1);
    expect(press({ key: "ArrowUp" }, { value: 200, step: 1, min: 0, max: 360 })).toBe(201);
  });

  it("ignores non-arrow keys", () => {
    expect(press({ key: "a" }, base)).toBeUndefined();
  });
});
