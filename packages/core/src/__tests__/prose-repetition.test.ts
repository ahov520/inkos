import { describe, expect, it } from "vitest";
import { detectRepeatedNgrams } from "../agents/prose-repetition.js";

describe("detectRepeatedNgrams (zh)", () => {
  it("flags a 4+ char phrase repeated 3 times", () => {
    const content = [
      "他握紧了拳头，指节发白。",
      "对面的人冷笑一声。他握紧了拳头，一步跨上前。",
      "灯光晃动。他握紧了拳头，终于开口。",
    ].join("\n\n");
    const violations = detectRepeatedNgrams(content, "zh");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
    expect(violations[0]!.rule).toBe("章内重复短语");
    expect(violations[0]!.description).toContain("握紧了拳头");
    expect(violations[0]!.description).toContain("3 次");
  });

  it("reports at most one candidate (the strongest)", () => {
    const content =
      "他深吸一口气。他深吸一口气。他深吸一口气。他深吸一口气。" +
      "她转过身去。她转过身去。她转过身去。";
    const violations = detectRepeatedNgrams(content, "zh");
    expect(violations).toHaveLength(1);
    // 深吸一口气 repeats 4 times > 转过身去 3 times
    expect(violations[0]!.description).toContain("深吸一口气");
  });

  it("does not cross punctuation boundaries", () => {
    // "转身。他走" repeats but is split by punctuation into short runs.
    const content = "转身。他走了。转身。他走了。转身。他走了。";
    const violations = detectRepeatedNgrams(content, "zh");
    expect(violations).toHaveLength(0);
  });

  it("stays silent below the threshold", () => {
    const content = "他握紧了拳头。后来他松开了手。再后来他握紧了拳头。";
    expect(detectRepeatedNgrams(content, "zh")).toHaveLength(0);
  });

  it("returns empty for empty content", () => {
    expect(detectRepeatedNgrams("", "zh")).toHaveLength(0);
    expect(detectRepeatedNgrams("   ", "zh")).toHaveLength(0);
  });
});

describe("detectRepeatedNgrams (en)", () => {
  it("flags a repeated word trigram", () => {
    const content = [
      "He clenched his fists and waited.",
      "The door opened. He clenched his fists again, saying nothing.",
      "At last he clenched his fists, and the room went quiet.",
    ].join("\n\n");
    const violations = detectRepeatedNgrams(content, "en");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("Repeated phrase");
    expect(violations[0]!.description).toContain("clenched his fists");
  });

  it("normalizes case when counting", () => {
    const content = "The old road. the old road? THE OLD ROAD.";
    const violations = detectRepeatedNgrams(content, "en");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.description).toContain("the old road");
  });

  it("stays silent below the threshold", () => {
    const content = "He walked away. He walked home. She walked away.";
    expect(detectRepeatedNgrams(content, "en")).toHaveLength(0);
  });
});
