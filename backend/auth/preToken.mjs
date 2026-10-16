/* Cognito Pre-Token-Generation trigger. Adds a `role` claim to the ID token:
   "professor" for emails on the PROFESSOR_EMAILS allow-list, "student" for
   everyone else. The games API trusts only this claim, never the browser. */

const PROFESSORS = new Set(
  (process.env.PROFESSOR_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const roleFor = (email) => (PROFESSORS.has((email || "").trim().toLowerCase()) ? "professor" : "student");

export const handler = async (event) => {
  const role = roleFor(event.request?.userAttributes?.email);
  event.response = {
    ...event.response,
    claimsOverrideDetails: { claimsToAddOrOverride: { role } },
  };
  return event;
};
