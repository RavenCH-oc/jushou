import { describe, expect, it } from "vitest";
import { readJoinLink } from "./join-link";

describe("readJoinLink", () => {
  it("takes a 6-digit code and removes it from the address", () => {
    expect(readJoinLink("https://x.dev/?code=012345")).toEqual({ code: "012345", cleanUrl: "/" });
    expect(readJoinLink("https://x.dev/?a=1&code=012345#top")).toEqual({ code: "012345", cleanUrl: "/?a=1#top" });
  });

  it("removes a broken code but doesn't use it", () => {
    expect(readJoinLink("https://x.dev/?code=12ab")).toEqual({ code: null, cleanUrl: "/" });
    expect(readJoinLink("https://x.dev/?code=")).toEqual({ code: null, cleanUrl: "/" });
  });

  it("leaves a normal address alone", () => {
    expect(readJoinLink("https://x.dev/")).toEqual({ code: null, cleanUrl: null });
  });
});
