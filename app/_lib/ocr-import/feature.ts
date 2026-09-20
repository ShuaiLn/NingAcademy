// Application rollback switch. Setting the public value to "false" hides the
// entry point and makes the route unavailable after a rebuild; the Server
// Action checks the same value independently.
export const PERSONAL_WORD_OCR_ENABLED =
  process.env.NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED !== "false";
