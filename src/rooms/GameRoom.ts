import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

// Configuration: change this value to adjust required players per game
export const PLAYERS_PER_GAME = 4;

export class GameState extends Schema {
  @type("string") roomId = "";
  @type({ map: "string" }) players = new MapSchema<string>();
  @type("number") waiting = 0;
  @type("boolean") started = false;
}

export class GameRoom extends Room<GameState> {
  maxClients = PLAYERS_PER_GAME;

  onCreate(options: any) {
    this.setState(new GameState());
    this.state.roomId = this.roomId;
    this.state.waiting = 0;
    this.state.started = false;
    console.log(`Room ${this.roomId} created (max ${this.maxClients} players)`);

    // Handle any incoming message and broadcast as playerMessage
    this.onMessage("*", (client, type, message) => {
      this.broadcast("playerMessage", {
        sessionId: client.sessionId,
        type,
        message,
      } as any);
    });
  }

  onJoin(client: Client, options: any) {
    if (this.state.started) {
      // Game already started, inform client and do not add them
      this.send(client, { type: "error", message: "Game already started" } as any);
      return;
    }
    // add player
    this.state.players.set(client.sessionId, client.id ?? "");
    this.state.waiting = this.state.players.size;
    this.broadcast("waitingUpdate", {
      waiting: this.state.waiting,
      max: this.maxClients,
      started: this.state.started,
    } as any);

    // If enough players, start the game
    if (this.state.waiting >= this.maxClients) {
      this.state.started = true;
      this.broadcast("gameStart", {
        message: "Enough players! Game started.",
        players: Array.from(this.state.players.values()),
      } as any);
      // Here you would initialize your game state, start timers, etc.
      console.log(`Room ${this.roomId} started with ${this.state.waiting} players`);
    }
  }

  onLeave(client: Client, consented: boolean) {
    if (this.state.started) {
      // Optional: handle player disconnect during game
      this.state.players.delete(client.sessionId);
      this.state.waiting = this.state.players.size;
      this.broadcast("waitingUpdate", {
        waiting: this.state.waiting,
        max: this.maxClients,
        started: this.state.started,
      } as any);
    } else {
      this.state.players.delete(client.sessionId);
      this.state.waiting = this.state.players.size;
      this.broadcast("waitingUpdate", {
        waiting: this.state.waiting,
        max: this.maxClients,
        started: this.state.started,
      } as any);
    }
  }

  onDispose() {
    console.log(`Room ${this.roomId} disposing...`);
  }
}