import { createGame, shuffle, type GameState } from "./engine";
import type { Account, Prefs } from "../data/store";

const BOT_NAMES = ["Ada", "Bruno", "Cleo", "Dmitri", "Esme", "Felix", "Greta", "Hugo"];

/** Deal a new game: the account in seat 0 against computer opponents. */
export function dealSolo(a: Account, p: Prefs): GameState {
  const names = shuffle(BOT_NAMES.slice());
  return createGame({
    stockSize: p.stockSize,
    players: [
      { name: a.name, isHuman: true, uid: a.uid },
      ...Array.from({ length: p.opponents }, (_, i) => ({ name: names[i], isHuman: false, difficulty: p.difficulty })),
    ],
  });
}
