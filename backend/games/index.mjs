import { makeHandler } from "./app.mjs";
import { dynamoStore } from "./db.mjs";
import { randomWord } from "./words.mjs";

/* Games API Lambda: accounts' games, join codes and per-game state documents.
   Every route sits behind the Cognito JWT authorizer (see template.yaml). */

export const handler = makeHandler(dynamoStore, {
  randomWord,
  rootProfessors: (process.env.PROFESSOR_EMAILS || "").split(","),
});
