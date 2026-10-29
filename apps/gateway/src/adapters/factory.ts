import { Provider } from "./types.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { NemotronProvider } from "./nemotron.js";

export function getProvider(
  overrideType?: string,
  overrideModel?: string,
  overrideKey?: string
): Provider {
  const envProvider = (process.env.PROVIDER || "").toLowerCase();
  const apiKey = (
    overrideKey ||
    process.env.NVIDIA_API_KEY ||
    process.env.NEMOTRON_API_KEY ||
    process.env.PROVIDER_API_KEY ||
    ""
  ).trim();

  // If explicitly requested nemotron or nvidia
  if (
    overrideType === "nemotron" ||
    overrideType === "nvidia" ||
    envProvider === "nemotron" ||
    envProvider === "nvidia"
  ) {
    if (!apiKey) {
      console.warn(
        "[PrivacyLens Gateway] PROVIDER=nemotron configured but no NVIDIA_API_KEY found. Falling back to MockProvider until key is provided."
      );
      return new MockProvider();
    }
    return new NemotronProvider(apiKey, undefined, overrideModel);
  }

  // If NVIDIA key exists and no provider explicitly set, use Nemotron
  if (!envProvider && apiKey) {
    return new NemotronProvider(apiKey, undefined, overrideModel);
  }

  const providerType = (overrideType || envProvider || "mock").toLowerCase();

  switch (providerType) {
    case "anthropic":
    case "claude":
      return new AnthropicProvider(overrideKey, overrideModel);
    case "openai":
      return new OpenAICompatibleProvider(overrideKey, undefined, overrideModel);
    case "openai-compatible":
      return new OpenAICompatibleProvider(overrideKey, process.env.BASE_URL, overrideModel);
    case "ollama":
      return new OllamaProvider(process.env.OLLAMA_HOST, overrideModel);
    case "mock":
    default:
      return new MockProvider();
  }
}
