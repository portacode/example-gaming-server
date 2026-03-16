import { Client, Room } from "colyseus";
import { BaseRoomState } from "../../schema/BaseRoomState";
import { GameAction, GameDefinition, JoinContext, PlayerContext } from "./types";

export abstract class BaseGameRoom<
  TRoomState extends BaseRoomState,
  TInternalState,
  TAction extends GameAction,
  TJoinOptions = unknown,
  TPlayerView = unknown,
  TCreateOptions = unknown,
> extends Room<TRoomState> {
  protected internalState!: TInternalState;
  protected abstract readonly definition: GameDefinition<
    TInternalState,
    TRoomState,
    TAction,
    TJoinOptions,
    TPlayerView,
    TCreateOptions
  >;

  protected abstract createRoomState(): TRoomState;

  protected getReconnectWindowSeconds() {
    return 300;
  }

  onCreate(options: TCreateOptions) {
    const roomState = this.createRoomState();
    roomState.roomId = this.roomId;
    roomState.maxPlayers = this.maxClients;
    this.setState(roomState);

    this.internalState = this.definition.createInitialState({
      roomId: this.roomId,
      maxClients: this.maxClients,
      options,
    });

    this.onMessage("action", (client, action: TAction) => {
      this.handleAction(client, action);
    });

    this.syncState();
  }

  onJoin(client: Client, options: TJoinOptions) {
    const joinContext: JoinContext<TJoinOptions> = {
      client,
      options,
      roomId: this.roomId,
      maxClients: this.maxClients,
    };
    const isReconnection = this.definition.hasPlayer(this.internalState, client.sessionId);

    if (isReconnection) {
      this.definition.onPlayerReconnect?.(this.internalState, this.createPlayerContext(client));
      this.syncState();
      return;
    }

    const reason = this.definition.canJoin?.(this.internalState, joinContext);
    if (reason) {
      client.leave(4001, reason);
      return;
    }

    this.definition.onPlayerJoin(this.internalState, joinContext);
    this.syncState();
  }

  async onLeave(client: Client, consented: boolean) {
    if (!this.definition.hasPlayer(this.internalState, client.sessionId)) {
      return;
    }

    const context = this.createPlayerContext(client);
    if (consented) {
      this.definition.onPlayerLeave?.(this.internalState, context);
      this.syncState();
      return;
    }

    this.definition.onPlayerDisconnect?.(this.internalState, context);
    this.syncState();

    try {
      await this.allowReconnection(client, this.getReconnectWindowSeconds());
    } catch {
      this.definition.onPlayerLeave?.(this.internalState, context);
      this.syncState();
    }
  }

  onDispose() {
    console.log(`Room ${this.roomId} disposing...`);
  }

  protected syncState() {
    this.definition.syncRoomState(this.state, this.internalState, this.roomId, this.maxClients);
    this.state.roomId = this.roomId;
    this.state.maxPlayers = this.maxClients;
    this.syncLockState();
    this.syncPlayerViews();
  }

  private createPlayerContext(client: Client): PlayerContext {
    return {
      client,
      roomId: this.roomId,
    };
  }

  private handleAction(client: Client, action: TAction) {
    if (!this.definition.hasPlayer(this.internalState, client.sessionId)) {
      client.send("actionError", { message: "Unknown player session." });
      return;
    }

    try {
      this.definition.applyAction(this.internalState, this.createPlayerContext(client), action);
      this.syncState();
    } catch (error) {
      client.send("actionError", {
        message: error instanceof Error ? error.message : "Action failed.",
      });
    }
  }

  private syncLockState() {
    const isOpenForNewPlayers = this.definition.isOpenForNewPlayers?.(this.internalState) ?? true;

    if (!isOpenForNewPlayers) {
      if (!this.locked) {
        void this.lock();
      }
      return;
    }

    if (this.locked && this.clients.length < this.maxClients) {
      void this.unlock();
    }
  }

  private syncPlayerViews() {
    for (const client of this.clients) {
      client.send("playerView", this.definition.projectView(this.internalState, client.sessionId));
    }
  }
}
