import { describe, expect, test } from "vitest";
import { colourTreatment, siteIcons, sweepEnabled, sweepSwitch, sweepSwitchedOn } from "../extension/src/settings";

describe("settings", () => {
  test("a fresh install (nothing stored) has the sweep off and the Neutral treatment", () => {
    expect(sweepEnabled(undefined)).toBe(false);
    expect(colourTreatment(undefined)).toBe("neutral");
    expect(colourTreatment("warm")).toBe("warm");
    expect(colourTreatment("catppuccin")).toBe("neutral");
  });

  test("switching the sweep on from never-set restarts its baseline, like switching on from off", () => {
    expect(sweepSwitchedOn(undefined, true)).toBe(true);
    expect(sweepSwitchedOn(false, true)).toBe(true);
    expect(sweepSwitchedOn(true, true)).toBe(false);
    expect(sweepSwitchedOn(true, false)).toBe(false);
    expect(sweepSwitchedOn(undefined, undefined)).toBe(false);
  });

  test("the options switch writes the new baseline in the same write as switching on", () => {
    expect(sweepSwitch(true, 1_000)).toEqual({ enabled: true, lastSweepAt: 1_000 });
    expect(sweepSwitch(false, 1_000)).toEqual({ enabled: false });
  });
  test("site icons are on unless switched off", () => {
    expect(siteIcons(undefined)).toBe(true);
    expect(siteIcons(true)).toBe(true);
    expect(siteIcons(false)).toBe(false);
  });
});
