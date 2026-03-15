import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export class GameState extends Schema {
  @type("string") roomId = "";
  @type({ map: "string" }) players = new MapSchema<string>();
}

export class AbstractRoom extends Room<GameState> {
  onCreate(options: any) {
    const state = new GameState();
    state.roomId = this.roomId;
    this.setState(state);
    console.log(`Room ${this.roomId} created!`);

    // handle any incoming message and broadcast it
    this.onMessage("*", (client, message) => {
      this.broadcast("message", { sessionId: client.sessionId, message });
    });
  }

  onJoin(client: Client, options: any) {
    // store player id (client.id or sessionId)
    this.state.players.set(client.sessionId, client.id ?? "");
    this.broadcast("join", { sessionId: client.sessionId, clientId: client.id });
  }

  onLeave(client: Client, consented: boolean) {
    this.state.players.delete(client.sessionId);
    this.broadcast("leave", { sessionId: client.sessionId });
  }

  onDispose() {
    console.log(`Room ${this.roomId} disposing...`);
  }
}