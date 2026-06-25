export function validateStorePassword(password: string) {
  const errors: string[] = [];

  if (password.length === 0) {
    errors.push("Password cannot be empty.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
