import { mfaRecoveryEmail, verificationEmail } from "./mail.templates.js";

describe("verificationEmail", () => {
  it("includes the code in subject-adjacent text and html", () => {
    const mail = verificationEmail("482193", 10);
    expect(mail.subject).toBe("Your ordo verification code");
    expect(mail.text).toContain("482193");
    expect(mail.text).toContain("Expires in 10 minutes");
    expect(mail.html).toContain("482193");
    expect(mail.html).toContain("Expires in 10 minutes");
    expect(mail.html).toContain("cid:ordo-logo");
    expect(mail.html).toContain('alt="ordo"');
    expect(mail.html).toContain("border-radius:24px");
  });

  it("strips non-digits from the displayed code", () => {
    const mail = verificationEmail("12 34-56", 10);
    expect(mail.text).toContain("123456");
    expect(mail.html).toContain("123456");
    expect(mail.html).not.toContain("12 34-56");
  });
});

describe("mfaRecoveryEmail", () => {
  it("uses recovery copy and includes the code", () => {
    const mail = mfaRecoveryEmail("482193", 10);
    expect(mail.subject).toBe("Your ordo authenticator recovery code");
    expect(mail.text).toContain("Your authenticator recovery code");
    expect(mail.text).toContain("482193");
    expect(mail.html).toContain("Authenticator recovery");
    expect(mail.html).toContain("482193");
  });
});
