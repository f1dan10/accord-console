/* Cognito Pre-Token-Generation trigger. Adds a `role` claim to the ID token:
   "professor" for emails on the PROFESSOR_EMAILS bootstrap list or invited
   through the app (Professors table), "student" for everyone else. The games
   API trusts only this claim, never the browser. The trigger also runs on
   every token refresh, so an invite or revoke takes effect within the hour. */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.PROFESSORS_TABLE;

const ROOTS = new Set(
  (process.env.PROFESSOR_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const normalizeEmail = (email) => (email || "").trim().toLowerCase();

/* Invited -> active the first time the invitee gets a token, so the
   Professors list shows who has actually signed in. */
async function markActive(email, userId) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { email },
    UpdateExpression: "SET #s = :active, userId = :u",
    ConditionExpression: "#s = :invited",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":active": "active", ":invited": "invited", ":u": userId },
  })).catch((e) => { if (e.name !== "ConditionalCheckFailedException") throw e; });
}

export async function roleFor(email, userId) {
  const e = normalizeEmail(email);
  if (!e) return "student";
  if (ROOTS.has(e)) return "professor";
  if (!TABLE) return "student";
  try {
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email: e } }));
    if (!r.Item) return "student";
    if (r.Item.status === "invited" && userId) await markActive(e, userId).catch((err) => console.error("markActive", err));
    return "professor";
  } catch (err) {
    // Fail closed: a lookup error must never grant the professor role.
    console.error("professor lookup failed", err);
    return "student";
  }
}

export const handler = async (event) => {
  const attrs = event.request?.userAttributes || {};
  const role = await roleFor(attrs.email, attrs.sub);
  event.response = {
    ...event.response,
    claimsOverrideDetails: { claimsToAddOrOverride: { role } },
  };
  return event;
};
