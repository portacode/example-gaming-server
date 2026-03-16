import type { Client } from "colyseus";
import type { BaseRoomState } from "../../schema/BaseRoomState";

export type RoomPhase = "waiting" | "active" | "ended";

export interface GameAction {
  type: string;
}

export interface CreateStateContext<TCreateOptions> {
  roomId: string;
  maxClients: number;
  options: TCreateOptions;
}

export interface JoinContext<TJoinOptions> {
  client: Client;
  options: TJoinOptions;
  roomId: string;
  maxClients: number;
}

export interface PlayerContext {
  client: Client;
  roomId: string;
}

export interface TickContext {
  roomId: string;
  maxClients: number;
  deltaTimeMs: number;
}

export interface GameDefinition<
  TInternalState,
  TRoomState extends BaseRoomState,
  TAction extends GameAction,
  TJoinOptions = unknown,
  TPlayerView = unknown,
  TCreateOptions = unknown,
> {
  createInitialState(context: CreateStateContext<TCreateOptions>): TInternalState;
  hasPlayer(state: TInternalState, sessionId: string): boolean;
  canJoin?(state: TInternalState, context: JoinContext<TJoinOptions>): string | void;
  onPlayerJoin(state: TInternalState, context: JoinContext<TJoinOptions>): void;
  onPlayerReconnect?(state: TInternalState, context: PlayerContext): void;
  onPlayerDisconnect?(state: TInternalState, context: PlayerContext): void;
  onPlayerLeave?(state: TInternalState, context: PlayerContext): void;
  applyAction(state: TInternalState, context: PlayerContext, action: TAction): void;
  tick?(state: TInternalState, context: TickContext): boolean;
  projectView(state: TInternalState, viewerSessionId: string): TPlayerView;
  syncRoomState(roomState: TRoomState, state: TInternalState, roomId: string, maxClients: number): void;
  isOpenForNewPlayers?(state: TInternalState): boolean;
}
