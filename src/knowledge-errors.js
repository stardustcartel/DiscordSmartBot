// Never persist arbitrary provider error messages/payloads: they can contain secrets.
function errorDetails(error, { stage, provider, model, started } = {}) {
  const safe = (value) => typeof value === "number" ? value : /^[\w.-]{1,80}$/.test(String(value || "")) ? String(value) : undefined;
  const status = Number(error?.status || error?.statusCode);
  const name = safe(error?.name), code = safe(error?.code), causeCode = safe(error?.cause?.code);
  const timeout = ["AbortError", "TimeoutError"].includes(name) || [20, 23, "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code) || String(causeCode || "").includes("TIMEOUT");
  return { stage, provider, model, durationMs: started ? Date.now() - started : undefined,
    kind: timeout ? "timeout_or_abort" : error instanceof SyntaxError ? "invalid_json" : status ? "http_error" : "provider_or_processing_error",
    name, code, causeCode, httpStatus: status >= 100 && status <= 599 ? status : undefined };
}
module.exports = { errorDetails };
