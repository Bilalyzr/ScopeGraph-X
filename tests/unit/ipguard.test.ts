import { describe, expect, it } from "vitest";
import { classifyIp, isBlockedAddress, isValidHostname } from "@/lib/policy/ipguard";

describe("IP guard (SSRF mitigation — private/reserved blocked by default)", () => {
  it.each([
    ["127.0.0.1", "LOOPBACK"],
    ["10.0.0.5", "PRIVATE"],
    ["192.168.1.1", "PRIVATE"],
    ["172.16.0.1", "PRIVATE"],
    ["169.254.169.254", "LINK_LOCAL"], // cloud metadata
    ["100.64.0.1", "PRIVATE"],
    ["0.0.0.0", "RESERVED"],
    ["224.0.0.1", "RESERVED"],
    ["198.18.0.1", "RESERVED"],
    ["::1", "LOOPBACK"],
    ["fe80::1", "LINK_LOCAL"],
    ["fd12::1", "UNIQUE_LOCAL"],
    ["::ffff:10.0.0.5", "PRIVATE"], // IPv4-mapped
  ])("blocks %s (%s)", (ip, _cls) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    ["203.0.113.10"], ["198.51.100.7"], ["93.184.216.34"],
    ["2606:2800:220:1:248:1893:25c8:1946"],
  ])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("rejects invalid addresses", () => {
    expect(classifyIp("not-an-ip")).toBe("INVALID");
    expect(isBlockedAddress("999.999.999.999")).toBe(true);
  });

  it("validates hostname syntax", () => {
    expect(isValidHostname("api.demo-target.test")).toBe(true);
    expect(isValidHostname("203.0.113.10")).toBe(true);
    expect(isValidHostname("bad host.example")).toBe(false);
    expect(isValidHostname("example.com/../../etc")).toBe(false);
    expect(isValidHostname("-leadingdash.example")).toBe(false);
    expect(isValidHostname("")).toBe(false);
    expect(isValidHostname("a".repeat(300) + ".example")).toBe(false);
  });
});
