// What a new creator sends to sign up. The email is their sign-in name; it must be unique (case-insensitively).

export interface SignupInputDetails {
  email: string;
  password: string;
  displayName: string;
}

export const MIN_SIGNUP_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ParseResult = { isError: false; signupInput: SignupInputDetails } | { isError: true; message: string };

function readText(rawValue: unknown): string {
  return typeof rawValue === 'string' ? rawValue.trim() : '';
}

// "dana.example@mail.com" → "dana.example": a starting display name, changed later in Settings
export function displayNameFromEmail(email: string): string {
  return email.split('@')[0]?.slice(0, MAX_DISPLAY_NAME_LENGTH) || 'Creator';
}

export function parseSignupBody(rawBody: unknown): ParseResult {
  const bodyDetails = (rawBody ?? {}) as Record<string, unknown>;
  const email = readText(bodyDetails.email).toLowerCase();
  const password = typeof bodyDetails.password === 'string' ? bodyDetails.password : '';
  const displayName = readText(bodyDetails.displayName);
  if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) return { isError: true, message: 'Enter a valid email address' };
  if (password.length < MIN_SIGNUP_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { isError: true, message: `Choose a password of at least ${MIN_SIGNUP_PASSWORD_LENGTH} characters` };
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) return { isError: true, message: `Your name can be at most ${MAX_DISPLAY_NAME_LENGTH} characters` };
  return { isError: false, signupInput: { email, password, displayName: displayName || displayNameFromEmail(email) } };
}
