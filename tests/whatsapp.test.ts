import { describe, expect, it } from "vitest";
import { parseChatExport } from "@/lib/whatsapp";

describe("whatsapp export parser", () => {
  it("parses both export styles and multi-line messages", () => {
    const raw = [
      "12/10/24, 3:45 pm - Rajesh Labels: bhaiya labels Monday tak nahi aayenge",
      "aur printing mein dikkat hai",
      "[13/10/24, 10:02:11 AM] Shree Labs: <Media omitted>",
      "13/10/24, 11:00 am - Messages are end-to-end encrypted.",
      "13/10/24, 11:05 am - Pack Wale: box 3 din mein",
    ].join("\n");
    const msgs = parseChatExport(raw);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].sender).toBe("Rajesh Labels");
    expect(msgs[0].text).toBe("bhaiya labels Monday tak nahi aayenge\naur printing mein dikkat hai");
    expect(msgs[1].sender).toBe("Pack Wale");
  });
});
