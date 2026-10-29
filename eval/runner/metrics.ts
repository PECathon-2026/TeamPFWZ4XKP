import { DOMNode } from "@privacylens/protocol";
import { PlantedCanary } from "../canaries/generator.js";

export interface ScenarioEvalResult {
  scenarioId: string;
  scenarioName: string;
  canariesPlanted: number;
  canariesLeaked: number;
  recallPercent: number;
  precisionPercent: number;
  contextPreservationPercent: number;
  taskSuccess: boolean;
  leakedCanaryDetails: string[];
}

/**
 * Searches the serialized output for any presence of planted canaries.
 */
export function assertCanaryContainment(
  serializedPayload: string,
  plantedCanaries: PlantedCanary[]
): { leakedCount: number; leaks: string[] } {
  let leakedCount = 0;
  const leaks: string[] = [];

  for (const canary of plantedCanaries) {
    if (serializedPayload.includes(canary.value)) {
      leakedCount++;
      leaks.push(`Canary ${canary.id} (${canary.category}) leaked on pathway ${canary.pathway}`);
    }
  }

  return { leakedCount, leaks };
}

/**
 * Measures interactive elements preserved in the sanitized DOM tree vs raw tree.
 */
export function measureContextPreservation(
  rawRoot: DOMNode,
  sanitizedRoot: DOMNode
): number {
  function countInteractive(node: DOMNode): number {
    let count = node.isInteractive ? 1 : 0;
    for (const child of node.children) {
      count += countInteractive(child);
    }
    return count;
  }

  const rawCount = countInteractive(rawRoot);
  const sanitizedCount = countInteractive(sanitizedRoot);

  if (rawCount === 0) return 100;
  return Math.min(100, (sanitizedCount / rawCount) * 100);
}

