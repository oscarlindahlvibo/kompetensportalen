export function normalizePersonalIdentity(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 12) throw new Error("personal_identity_invalid");

  const dateDigits = digits.length === 12 ? digits.slice(0, 8) : digits.slice(0, 6);
  const year = digits.length === 12 ? Number(dateDigits.slice(0, 4)) : 2000 + Number(dateDigits.slice(0, 2));
  const month = Number(dateDigits.slice(digits.length === 12 ? 4 : 2, digits.length === 12 ? 6 : 4));
  const rawDay = Number(dateDigits.slice(digits.length === 12 ? 6 : 4));
  const day = rawDay > 60 ? rawDay - 60 : rawDay;
  const date = new Date(Date.UTC(year, month - 1, day));
  const dateIsValid = month >= 1 && month <= 12 && day >= 1 && day <= 31
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
  if (!dateIsValid) throw new Error("personal_identity_invalid");

  const luhnDigits = digits.length === 12 ? digits.slice(2) : digits;
  const checksum = luhnDigits.split("").reduce((sum, digit, index) => {
    const value = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return sum + (value > 9 ? value - 9 : value);
  }, 0);
  if (checksum % 10 !== 0) throw new Error("personal_identity_invalid");

  return digits;
}
