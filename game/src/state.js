// The whole match state, in one place. Every module reads this object; only
// rounds.js moves the phase and the round, only weapons.js touches the player's
// loadout, only bots.js moves a bot. Nothing else keeps a copy of a number that
// lives here, so the HUD, the sim and the screenshots can never disagree.
export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  ROUND_END: 'round_end',
  MATCH_END: 'match_end',
};

export function createState() {
  return {
    phase: PHASE.MENU,
    round: 1,
    maxRounds: 9,
    winsToTake: 5,
    roundTime: 100,
    roundClock: 0,
    buyTime: 15,
    buyClock: 0,
    score: { vanguard: 0, dusk: 0 },
    lossStreak: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    assists: 0,
    // Bomb: 'carried' (player holds it), 'planted', 'dropped', 'gone'.
    bomb: { status: 'carried', site: null, plantProgress: 0, fuse: 0, defuseProgress: 0, position: null },
    // The player is the only human; bots are listed here so the HUD's scoreboard
    // and the round-end checks read one list.
    players: [],
    killfeed: [],
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    flash: 0,
    startedAt: 0,
  };
}
