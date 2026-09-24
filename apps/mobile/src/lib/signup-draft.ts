/** In-memory signup form, so editing the email can return to a filled register screen. */
export interface SignupDraft {
  displayName: string;
  email: string;
  password: string;
  confirm: string;
  atLeast13: boolean;
}

let draft: SignupDraft | null = null;

export function saveSignupDraft(next: SignupDraft): void {
  draft = next;
}

export function readSignupDraft(): SignupDraft | null {
  return draft;
}
