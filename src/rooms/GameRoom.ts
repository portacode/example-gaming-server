import { simpleGameDefinition, PLAYERS_PER_GAME, SimpleGameAction, SimpleGameState, SimpleGameView, SimpleJoinOptions, SimpleRoomState } from "../games/simpleGame";
import { AbstractRoom } from "./AbstractRoom";

export const RECONNECT_WINDOW_SECONDS = 300;

export class GameState extends SimpleRoomState {}

export class GameRoom extends AbstractRoom<
  GameState,
  SimpleGameState,
  SimpleGameAction,
  SimpleJoinOptions,
  SimpleGameView,
  Record<string, never>
> {
  maxClients = PLAYERS_PER_GAME;
  protected readonly definition = simpleGameDefinition;

  protected createRoomState() {
    return new GameState();
  }

  protected getReconnectWindowSeconds() {
    return RECONNECT_WINDOW_SECONDS;
  }
}
