import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/evidence/redact";

describe("evidence redaction (secrets never reach storage/models/exports)", () => {
  it("strips bearer tokens", () => {
    const r = redactSecrets('{"headers":{"authorization":"Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc-def_ghi"}}');
    expect(r.redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(r.redacted).toContain("[REDACTED:");
    expect(r.removed.length).toBeGreaterThan(0);
  });

  it("strips set-cookie and cookie headers", () => {
    const r = redactSecrets("Set-Cookie: session=deadbeefcafe; Path=/\nCookie: session=deadbeefcafe");
    expect(r.redacted).not.toContain("deadbeefcafe");
  });

  it("strips private key blocks, JWTs, AWS keys and password assignments", () => {
    const r = redactSecrets(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n" +
      "token=eyJhbGciOiJub25lIn0.eyJhIjoxfQ.abc123def456ghi789\n" +
      "aws_key=AKIAIOSFODNN7EXAMPLE\n" +
      '{"password":"SuperSecret123!"}'
    );
    expect(r.redacted).not.toContain("MIIEow");
    expect(r.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.redacted).not.toContain("SuperSecret123");
  });

  it("leaves ordinary evidence untouched", () => {
    const r = redactSecrets('{"order_id":"ord_1001","tenant":"tenant-b","total":499}');
    expect(r.redacted).toContain("ord_1001");
    expect(r.removed).toHaveLength(0);
  });
});
