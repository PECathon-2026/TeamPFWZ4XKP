/**
 * Luhn mod-10 checksum validation.
 */
export function validateLuhn(cardNumber: string): boolean {
  const sanitized = cardNumber.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(sanitized)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized.charAt(i), 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

export type CardBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "rupay"
  | "diners"
  | "jcb"
  | "unknown";

/**
 * Identify card brand by IIN/BIN.
 */
export function identifyCardBrand(cardNumber: string): CardBrand {
  const digits = cardNumber.replace(/[\s-]/g, "");

  if (/^4\d{12}(\d{3})?(\d{3})?$/.test(digits)) return "visa";
  if (/^(5[1-5]\d{4}|222[1-9]\d{2}|22[3-9]\d{3}|2[3-6]\d{4}|27[01]\d{3}|2720\d{2})\d{10}$/.test(digits))
    return "mastercard";
  if (/^3[47]\d{13}$/.test(digits)) return "amex";
  if (/^(6011|65\d{2}|64[4-9]\d)\d{12}$/.test(digits)) return "discover";
  if (/^(508[5-9]|6069[89]|607[0-9]|608[0-4]|6521[5-9]|652[2-9]|653[01]|817[0-9]|818[0-9]|820[0-9])\d+$/.test(digits))
    return "rupay";
  if (/^3(0[0-5]|[68]\d)\d{11}$/.test(digits)) return "diners";
  if (/^(?:2131|1800|35\d{3})\d{11}$/.test(digits)) return "jcb";

  return "unknown";
}

