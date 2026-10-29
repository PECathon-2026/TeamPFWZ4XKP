import { Provider } from "./types.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";

export function getProvider(): Provider {
  const providerType = (process.env.PROVIDER || "mock").toLowerCase();

  switch (providerType) {
    case "ollama":
      return new OllamaProvider();
    case "openai":
    case "anthropic":
      return new OpenAICompatibleProvider();
    case "mock":
    default:
      return new MockProvider();
  }
}

