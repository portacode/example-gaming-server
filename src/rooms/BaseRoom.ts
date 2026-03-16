import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export const PLAYERS_PER_GAME = 1;

// Base state that can be extended by concrete games
export class BaseState extends Schema {
  @type("string") roomId = "";
  @type({ map: "string" }) players = new MapSchema<string>(); // sessionId -> username
  @type("boolean") started = false;
}

// Generic room that handles waiting/start and provides hooks for state updates
export abstract class BaseRoom<S extends BaseState> extends Room<S> {
  maxClients = PLAYERS_PER_GAME;

  onCreate(options: any) {
    // Initialize state (must be implemented by subclass)
    this.setState(this.getInitialState());
    this.state.roomId = this.roomId;
    this.state.started = false;
    console.log(`Room ${this.roomId} created (max ${this.maxClients} players)`);

    // Forward any client message to onMessage handler (to be implemented)
    this.onMessage("*", (client, message) => {
      this.onClientMessage(client, message);
    });
  }

  /** Subclasses must return an instance of their specific state */
  abstract getInitialState(): S;

  /** Subclasses implement specific message handling */
  abstract onClientMessage(client: Client, message: any): void;

  /** Called when enough players have joined to start the game */
  onStartGame() {
    this.state.started = true;
    this.broadcast("gameStart", {
      message: "Enough players! Game started.",
      players: Array.from(this.state.players.values()),
    } as any);
    console.log(`Room ${this.roomId} started`);
  }

  onJoin(client: Client, options: any) {
    if (this.state.started) {
      this.send(client, { type: "error", message: "Game already started" } as any);
      return;
    }
    const username = options?.username ?? `Player_${client.sessionId.slice(0, 6)}`;
    this.state.players.set(client.sessionId, username);
    this.broadcast("waitingUpdate", {
      waiting: this.state.players.size,
      max: this.maxClients,
      started: this.state.started,
    } as any);

    if (this.state.players.size >= this.maxClients) {
      this.onStartGame();
    }
  }

  onLeave(client: Client, consented: boolean) {
    this.state.players.delete(client.sessionId);
    if (this.state.started) {
      // Game in progress: notify others but keep game going
      this.broadcast("playerLeft", { sessionId: client.sessionId } as any);
    } else {
      this.broadcast("waitingUpdate", {
        waiting: this.state.players.size,
        max: this.maxClients,
        started: this.state.started,
      } as any);
    }
  }

  onDispose() {
    console.log(`Room ${this.roomId} disposing...`);
  }
}