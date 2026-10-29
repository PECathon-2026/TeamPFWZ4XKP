import { Provider } from "./types.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export function getProvider(): Provider {
  const providerType = (process.env.PROVIDER || "mock").toLowerCase();

  switch (providerType) {
    case "anthropic":
    case "claude":
      return new AnthropicProvider();
    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider();
    case "ollama":
      return new OllamaProvider();
    case "mock":
    default:
      return new MockProvider();
  }
}

