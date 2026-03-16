import { MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerPresenceState extends Schema {
  @type("string") sessionId = "";
  @type("string") username = "";
  @type("boolean") connected = true;
}

export class BaseRoomState extends Schema {
  @type("string") roomId = "";
  @type("string") phase = "waiting";
  @type("number") connectedPlayers = 0;
  @type("number") maxPlayers = 0;
  @type({ map: PlayerPresenceState }) players = new MapSchema<PlayerPresenceState>();
}
