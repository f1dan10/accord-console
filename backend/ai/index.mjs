import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

/* Server-side stand-in for the claude.ai artifact proxy. The browser posts
   { prompt, max_tokens }; we call Claude on Amazon Bedrock with this Lambda's
   IAM role and return the Messages API response unchanged, so the frontend
   keeps reading data.content[].text exactly as before. */

const client = new AnthropicBedrock({ awsRegion: process.env.AWS_REGION });
const MODEL = process.env.MODEL_ID || "global.anthropic.claude-sonnet-4-6";

/* The API Gateway route carries the CognitoJwt authorizer, so a request only
   reaches this handler with a valid signed-in user's token. These caps stay
   anyway: a signed-in user is not the same as a trusted one, and they bound
   what one account can spend per call. */
const MAX_PROMPT_CHARS = 20000;
const MAX_TOKENS_CAP = 1000;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  let req;
  try {
    req = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body || "{}");
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const { prompt } = req;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return json(400, { error: "prompt must be a non-empty string under 20000 characters" });
  }
  const maxTokens = Math.min(Math.max(1, req.max_tokens | 0 || 300), MAX_TOKENS_CAP);

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return json(200, message);
  } catch (err) {
    console.error("bedrock error", err.status, err.message);
    return json(502, { error: "model call failed" });
  }
};
