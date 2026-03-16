import { BaseGameRoom } from "../core/game/BaseGameRoom";
import { GameAction } from "../core/game/types";
import { BaseRoomState } from "../schema/BaseRoomState";

export abstract class AbstractRoom<
  TRoomState extends BaseRoomState,
  TInternalState,
  TAction extends GameAction,
  TJoinOptions = unknown,
  TPlayerView = unknown,
  TCreateOptions = unknown,
> extends BaseGameRoom<TRoomState, TInternalState, TAction, TJoinOptions, TPlayerView, TCreateOptions> {}
