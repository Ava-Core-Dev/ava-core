import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export type InternalGrokChatEnv = {
  GROK_API_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
  RR_PUSH_ADMIN_SECRET?: string;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function grokResponseText(response: Record<string, unknown>): string {
  const message = (response.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
    | Record<string, unknown>
    | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" ? str((part as Record<string, unknown>).text) : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function parseAiJson(content: string, summaryMax: number, reportMax: number): { summary_text: string; report_text: string } {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  const truncate = (s: string, max: number) => {
    const t = s.trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  };
  return {
    summary_text: truncate(str(obj.summary_text), summaryMax),
    report_text: truncate(str(obj.report_text), reportMax),
  };
}

export async function handleInternalGrokChatPost(
  request: Request,
  env: InternalGrokChatEnv,
): Promise<Response> {
  const adminOk = await verifyWorkerOpsAdmin(request, env);
  if (!adminOk) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }

  let body: {
    system_prompt?: string;
    user_payload?: unknown;
    temperature?: number;
    summary_max?: number;
    report_max?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const systemPrompt = str(body.system_prompt);
  if (!systemPrompt) return json({ detail: "system_prompt is required." }, 400);

  const token = str(env.GROK_API_BEARER_TOKEN);
  if (!token) return json({ detail: "GROK_API_BEARER_TOKEN is not configured on this Worker." }, 503);

  const apiUrl = str(env.GROK_API_URL) || "https://api.x.ai/v1/chat/completions";
  const model = str(env.GROK_MODEL) || "grok-3-latest";
  const temperature = Number(body.temperature);
  const summaryMax = Number(body.summary_max) || 300;
  const reportMax = Number(body.report_max) || 2800;
  const userContent =
    typeof body.user_payload === "string" ? body.user_payload : JSON.stringify(body.user_payload ?? {});

  const grokBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
    response_format: { type: "json_object" },
  };

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(grokBody),
    });
    const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = grokResponseText(response);
    if (!content) {
      return json(
        {
          ok: false,
          status: res.status,
          detail: JSON.stringify(response.error || response).slice(0, 500),
        },
        res.status >= 400 ? res.status : 502,
      );
    }
    try {
      const parsed = parseAiJson(content, summaryMax, reportMax);
      return json({ ok: true, status: res.status, model, ...parsed });
    } catch (e) {
      return json(
        {
          ok: false,
          status: res.status,
          detail: e instanceof Error ? e.message : String(e),
          content: content.slice(0, 1200),
        },
        502,
      );
    }
  } catch (e) {
    return json({ ok: false, detail: e instanceof Error ? e.message : String(e) }, 502);
  }
}
