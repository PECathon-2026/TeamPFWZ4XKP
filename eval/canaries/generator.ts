import { generateVerhoeffCheckDigit } from "@privacylens/detector";

export interface PlantedCanary {
  id: string;
  category: string;
  value: string;
  pathway: string;
}

/**
 * Generates an algorithmically valid canary value for a given category.
 */
export function generateCanary(category: string, id: string): PlantedCanary {
  let value = "";
  // Ensure we have a strictly numeric sequence derived from id
  const digitsOnly = id.replace(/\D/g, "");
  const numId = digitsOnly ? digitsOnly.padStart(8, "0") : "10000001";

  switch (category) {
    case "CARD": {
      // 16-digit card starting with 4111 0000 0000
      const prefix = "41110000" + numId.slice(-7);
      let sum = 0;
      let shouldDouble = true;

      for (let i = prefix.length - 1; i >= 0; i--) {
        let d = parseInt(prefix.charAt(i), 10);
        if (shouldDouble) {
          d *= 2;
          if (d > 9) d -= 9;
        }
        sum += d;
        shouldDouble = !shouldDouble;
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      value = `${prefix}${checkDigit}`;
      break;
    }
    case "AADHAAR": {
      // 12-digit Aadhaar starting with 2-9
      const base11 = "289" + numId.slice(-8);
      const checkDigit = generateVerhoeffCheckDigit(base11);
      value = `${base11}${checkDigit}`;
      break;
    }
    case "PAN": {
      // 5 letters (4th is P), 4 digits, 1 letter
      const numPart = numId.slice(-4);
      value = `CANPZ${numPart}A`;
      break;
    }
    case "EMAIL": {
      value = `canary_${id}@eval.privacylens.test`;
      break;
    }
    case "PHONE": {
      value = `+9199999${numId.slice(-5)}`;
      break;
    }
    case "API_KEY": {
      value = `sk-canary-${id}-` + "x".repeat(24);
      break;
    }
    case "OTP": {
      value = (100000 + (parseInt(numId, 10) % 900000)).toString();
      break;
    }
    default:
      value = `CANARY_SECRET_${category}_${id}`;
  }

  return {
    id,
    category,
    value,
    pathway: "P1", // Default pathway: DOM text -> Outbound
  };
}
