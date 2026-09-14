/**
 * Ollama in-flight guard stub.
 * The desktop calls these to signal when Ollama is busy.
 * Python core manages Ollama directly — these are no-ops in the new build.
 */
export function beginOllamaWork(tag = "") {}
export function endOllamaWork(tag = "") {}
