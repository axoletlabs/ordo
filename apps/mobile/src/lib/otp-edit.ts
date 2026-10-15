/** Editing rules shared by every segmented OTP, backup-code and PIN field. */
export function normalizeOtp(raw: string, kind: "numeric" | "backup", length: number): string {
  return (kind === "backup" ? raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : raw.replace(/\D/g, "")).slice(0, length);
}

export function editOtp(value: string, raw: string, index: number, kind: "numeric" | "backup", length: number) {
  const inserted = normalizeOtp(raw, kind, length);
  const at = Math.min(Math.max(0, index), value.length, length - 1);
  if (raw && !inserted) return { value, index: at };
  // OS autofill and a complete pasted code replace the whole code, even when
  // invoked from a middle cell. Short pastes overwrite from the chosen cell.
  if (inserted.length === length) return { value: inserted, index: length - 1 };
  if (!raw) return { value: value.slice(0, at) + value.slice(at + 1), index: at };
  return {
    value: (value.slice(0, at) + inserted + value.slice(at + inserted.length)).slice(0, length),
    index: Math.min(at + inserted.length, length - 1),
  };
}
