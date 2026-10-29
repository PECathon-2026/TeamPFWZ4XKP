import { DetectionFinding } from "../types.js";

// OTP keyword proximity regex: keywords followed or preceded by 4 to 8 digits, allowing connector words like 'is', ':', '-'
const OTP_FORWARD_REGEX = /\b(?:otp|one-time(?:\s*password)?|verification(?:\s*code)?|auth\s*code|2fa|passcode)(?:[\s:=_-]+|(?:[\s]+is[\s:]+))(\d{4,8})\b/gi;
const OTP_REVERSE_REGEX = /\b(\d{4,8})(?:[\s:=_-]+|(?:[\s]+is\s+(?:your\s+)?))(?:\b(?:otp|one-time(?:\s*password)?|verification(?:\s*code)?|2fa|passcode)\b)/gi;

export function detectOTP(text: string): DetectionFinding[] {
  const findings: DetectionFinding[] = [];
  let match: RegExpExecArray | null;

  OTP_FORWARD_REGEX.lastIndex = 0;
  while ((match = OTP_FORWARD_REGEX.exec(text)) !== null) {
    const otpValue = match[1];
    const fullMatch = match[0];
    const otpStart = match.index + fullMatch.lastIndexOf(otpValue);

    findings.push({
      category: "OTP",
      source: "context",
      ruleId: "otp.proximity.forward",
      confidence: 0.95,
      start: otpStart,
      end: otpStart + otpValue.length,
      matchedText: otpValue,
    });
  }

  OTP_REVERSE_REGEX.lastIndex = 0;
  while ((match = OTP_REVERSE_REGEX.exec(text)) !== null) {
    const otpValue = match[1];
    const fullMatch = match[0];
    const otpStart = match.index + fullMatch.indexOf(otpValue);

    findings.push({
      category: "OTP",
      source: "context",
      ruleId: "otp.proximity.reverse",
      confidence: 0.95,
      start: otpStart,
      end: otpStart + otpValue.length,
      matchedText: otpValue,
    });
  }

  return findings;
}
