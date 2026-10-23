import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, QueryCommand, BatchGetCommand,
  UpdateCommand, TransactWriteCommand, ScanCommand, PutCommand, DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { gzipSync, gunzipSync } from "node:zlib";
import { CodeTaken, DocTooLarge, StaleStatus } from "./app.mjs";

/* DynamoDB-backed store for app.mjs. Tables come from the SAM template. */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const T = {
  games: process.env.GAMES_TABLE,
  docs: process.env.DOCS_TABLE,
  members: process.env.MEMBERS_TABLE,
  codes: process.env.CODES_TABLE,
  professors: process.env.PROFESSORS_TABLE,
};
// DynamoDB items cap at 400 KB; leave headroom for the other attributes.
const MAX_DOC_GZ_BYTES = 350_000;

const cancelledOnCondition = (e, index) =>
  e.name === "TransactionCanceledException" && e.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

async function queryAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export const dynamoStore = {
  async getGame(gameId) {
    const r = await ddb.send(new GetCommand({ TableName: T.games, Key: { gameId } }));
    return r.Item || null;
  },

  async getMember(userId, gameId) {
    const r = await ddb.send(new GetCommand({ TableName: T.members, Key: { userId, gameId } }));
    return r.Item || null;
  },

  listMembers(gameId) {
    return queryAll({
      TableName: T.members, IndexName: "byGame",
      KeyConditionExpression: "gameId = :g", ExpressionAttributeValues: { ":g": gameId },
    });
  },

  listMemberships(userId) {
    return queryAll({
      TableName: T.members,
      KeyConditionExpression: "userId = :u", ExpressionAttributeValues: { ":u": userId },
    });
  },

  async getGames(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      let keys = ids.slice(i, i + 100).map((gameId) => ({ gameId }));
      for (let attempt = 0; keys.length && attempt < 5; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const r = await ddb.send(new BatchGetCommand({ RequestItems: { [T.games]: { Keys: keys } } }));
        out.push(...(r.Responses?.[T.games] || []));
        keys = r.UnprocessedKeys?.[T.games]?.Keys || [];
      }
    }
    return out;
  },

  async lookupCode(code) {
    const r = await ddb.send(new GetCommand({ TableName: T.codes, Key: { code } }));
    return r.Item?.gameId || null;
  },

  /* One transaction: claim the word (fails if an active game holds it), then
     the game, its empty state document and the owner's membership. */
  async createGame(game, owner) {
    try {
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: T.codes, Item: { code: game.code, gameId: game.gameId }, ConditionExpression: "attribute_not_exists(code)" } },
          { Put: { TableName: T.games, Item: game } },
          { Put: { TableName: T.docs, Item: { gameId: game.gameId, version: 0, updatedAt: game.createdAt } } },
          { Put: { TableName: T.members, Item: owner } },
        ],
      }));
    } catch (e) {
      if (cancelledOnCondition(e, 0)) throw new CodeTaken();
      throw e;
    }
  },

  /* Upsert that keeps an earlier delegation, so a student rejoining on Tuesday
     lands back in the same seat. */
  async joinAsStudent({ userId, gameId, name, email, joinedAt }) {
    const r = await ddb.send(new UpdateCommand({
      TableName: T.members, Key: { userId, gameId },
      UpdateExpression: "SET #n = :n, #e = :e, #r = if_not_exists(#r, :r), #d = if_not_exists(#d, :d), #j = if_not_exists(#j, :j)",
      ExpressionAttributeNames: { "#n": "name", "#e": "email", "#r": "role", "#d": "delegation", "#j": "joinedAt" },
      ExpressionAttributeValues: { ":n": name, ":e": email, ":r": "student", ":d": null, ":j": joinedAt },
      ReturnValues: "ALL_NEW",
    }));
    return r.Attributes;
  },

  async setDelegation(gameId, userId, delegation) {
    try {
      const r = await ddb.send(new UpdateCommand({
        TableName: T.members, Key: { userId, gameId },
        UpdateExpression: "SET #d = :d",
        ConditionExpression: "attribute_exists(userId)",
        ExpressionAttributeNames: { "#d": "delegation" },
        ExpressionAttributeValues: { ":d": delegation },
        ReturnValues: "ALL_NEW",
      }));
      return r.Attributes;
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") return null;
      throw e;
    }
  },

  async getDoc(gameId) {
    const r = await ddb.send(new GetCommand({ TableName: T.docs, Key: { gameId } }));
    if (!r.Item?.doc) return null;
    return { value: gunzipSync(Buffer.from(r.Item.doc)).toString(), version: r.Item.version };
  },

  async putDoc(gameId, text, ts) {
    const gz = gzipSync(text);
    if (gz.length > MAX_DOC_GZ_BYTES) throw new DocTooLarge();
    if (gz.length > 300_000) console.warn("game doc nearing size limit", gameId, gz.length);
    const r = await ddb.send(new UpdateCommand({
      TableName: T.docs, Key: { gameId },
      UpdateExpression: "SET #doc = :doc, #v = if_not_exists(#v, :zero) + :one, updatedAt = :t",
      ExpressionAttributeNames: { "#doc": "doc", "#v": "version" },
      ExpressionAttributeValues: { ":doc": gz, ":zero": 0, ":one": 1, ":t": ts },
      ReturnValues: "UPDATED_NEW",
    }));
    return r.Attributes.version;
  },

  /* Compare-and-set on the current status. Completing a game also frees its
     word for future games. */
  async setStatus(game, status, ts) {
    const update = {
      TableName: T.games, Key: { gameId: game.gameId },
      UpdateExpression: "SET #s = :to, updatedAt = :t",
      ConditionExpression: "#s = :from",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":to": status, ":from": game.status, ":t": ts },
    };
    try {
      if (status === "completed") {
        await ddb.send(new TransactWriteCommand({
          TransactItems: [
            { Update: update },
            { Delete: {
              TableName: T.codes, Key: { code: game.code },
              ConditionExpression: "attribute_not_exists(code) OR gameId = :g",
              ExpressionAttributeValues: { ":g": game.gameId },
            } },
          ],
        }));
        return { ...game, status, updatedAt: ts };
      }
      const r = await ddb.send(new UpdateCommand({ ...update, ReturnValues: "ALL_NEW" }));
      return r.Attributes;
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException" || cancelledOnCondition(e, 0)) throw new StaleStatus();
      throw e;
    }
  },

  // A handful of rows per course, so a scan is fine.
  async listProfessors() {
    const items = [];
    let ExclusiveStartKey;
    do {
      const r = await ddb.send(new ScanCommand({ TableName: T.professors, ExclusiveStartKey }));
      items.push(...(r.Items || []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  },

  /* Insert-if-absent. Returns the existing row when the email is already on
     the list (so a second invite doesn't reset an active professor), else null. */
  async addProfessor(row) {
    try {
      await ddb.send(new PutCommand({ TableName: T.professors, Item: row, ConditionExpression: "attribute_not_exists(email)" }));
      return null;
    } catch (e) {
      if (e.name !== "ConditionalCheckFailedException") throw e;
      const r = await ddb.send(new GetCommand({ TableName: T.professors, Key: { email: row.email } }));
      return r.Item || null;
    }
  },

  async removeProfessor(email) {
    const r = await ddb.send(new DeleteCommand({ TableName: T.professors, Key: { email }, ReturnValues: "ALL_OLD" }));
    return !!r.Attributes;
  },
};
