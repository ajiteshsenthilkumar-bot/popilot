import { describe, expect, it } from "vitest";
import { matchSender, parseAllowList } from "@/lib/allowlist";
import { isTrivial } from "@/lib/relevance";

const LIST = "+91 98123-45678=Rajesh Labels, 919800000001 = Pack Wale; 919876500000=*, group:120363@g.us=Vendor Group";

describe("allow-list", () => {
  const entries = parseAllowList(LIST);

  it("parses phones (with +, spaces, dashes), the forwarder star and groups", () => {
    expect(entries).toEqual([
      { key: "919812345678", vendor: "Rajesh Labels" },
      { key: "919800000001", vendor: "Pack Wale" },
      { key: "919876500000", vendor: null },
      { key: "group:120363@g.us", vendor: "Vendor Group" },
    ]);
  });

  it("allows a listed vendor and names them", () => {
    expect(matchSender(entries, "919812345678")).toEqual({ allowed: true, vendor: "Rajesh Labels" });
  });

  it("allows the forwarder but leaves the vendor for the AI to find", () => {
    expect(matchSender(entries, "919876500000")).toEqual({ allowed: true, vendor: null });
  });

  it("drops everyone else", () => {
    expect(matchSender(entries, "919999999999")).toEqual({ allowed: false });
  });

  it("fails closed when the list is empty or unset", () => {
    expect(matchSender(parseAllowList(""), "919812345678").allowed).toBe(false);
    expect(matchSender(parseAllowList(undefined), "919812345678").allowed).toBe(false);
  });

  it("needs the group itself to be listed, and uses the member's own name if known", () => {
    expect(matchSender(entries, "919812345678", "other@g.us")).toEqual({ allowed: false });
    expect(matchSender(entries, "919812345678", "120363@g.us")).toEqual({ allowed: true, vendor: "Rajesh Labels" });
    expect(matchSender(entries, "919911111111", "120363@g.us")).toEqual({ allowed: true, vendor: "Vendor Group" });
  });

  it("ignores junk entries", () => {
    expect(parseAllowList("abc=Nobody, 123=Short, =x, group:=y")).toEqual([]);
  });
});

describe("trivial-message filter", () => {
  it.each(["", "   ", "ok", "Ok sir", "Thanks!", "thank you", "👍", "🙏🙏", "Good morning", "hi bhaiya", "theek hai", "..."])(
    "drops %j",
    (t) => expect(isTrivial(t)).toBe(true),
  );

  it.each([
    "labels Monday tak nahi aayenge",
    "ok but labels will be late",
    "3 din aur lagenge",
    "maal ready hai kal bhej raha hoon",
    "done",
  ])("keeps %j for the AI", (t) => expect(isTrivial(t)).toBe(false));
});
