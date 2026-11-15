// The match: rounds, the economy, the buy menu, the bomb. One state machine —
// buy, live, round end, match end — and every rule that decides a round: an
// elimination, a detonation, a defuse, the clock. Money is the player's only;
// a kill pays $300, a round win $3,250, a loss $1,900 plus $500 for each
// consecutive loss, a plant $300. The bomb starts with the player; if the
// player falls, a teammate carries it to a site and plants it, so a round is
// never decided by one death.
import { PHASE } from './state.js';
import { WEAPONS, FLASHBANG_PRICE, ARMOUR_PRICE } from './weapons.js';

const BUY_TIME = 15;
const ROUND_TIME = 100;
const PLANT_TIME = 3;
const FUSE_TIME = 35;
const DEFUSE_TIME = 5;
const ROUND_END_TIME = 4;
const WIN_BONUS = 3250;
const LOSS_BONUS = 1900;
const LOSS_STREAK_BONUS = 500;
const LOSS_BONUS_CAP = 3400;
const KILL_BONUS = 300;
const PLANT_BONUS = 300;

export function createRounds(state, map, player, weapons, bots) {
  const events = [];
  let siteOf = null;

  function notify(type, data = {}) {
    events.push({ type, ...data });
  }

  function drainEvents() {
    const out = events.splice(0, events.length);
    return out;
  }

  function aliveOf(team) {
    let count = 0;
    for (const bot of bots.bots) if (bot.team === team && bot.alive) count += 1;
    if (team === 'vanguard' && player.state.alive) count += 1;
    return count;
  }

  function assignPlans() {
    const lanes = ['mid', 'A', 'B'];
    const laneGoal = { mid: 'midCross', A: 'aSite', B: 'bSite' };
    for (const bot of bots.bots) {
      if (bot.team === 'vanguard') {
        const lane = lanes[Math.floor(Math.random() * lanes.length)];
        bots.routeTo(bot, bots.findRoute(bot, laneGoal[lane]));
      } else {
        const holds = ['aHold', 'aSite', 'bHold', 'bSite', 'dMid'];
        const index = bots.bots.indexOf(bot);
        bots.routeTo(bot, bots.findRoute(bot, holds[index % holds.length]));
      }
    }
  }

  function startRound() {
    state.phase = PHASE.BUY;
    state.buyClock = BUY_TIME;
    state.roundClock = ROUND_TIME;
    state.bomb = { status: 'carried', site: null, plantProgress: 0, fuse: 0, defuseProgress: 0, position: null, carrier: 'player' };
    state.roundWinner = null;
    state.roundReason = '';
    const vSpawn = map.spawns.vanguard;
    player.reset(vSpawn[0][0], vSpawn[0][1], Math.PI);
    bots.resetAll(state.round);
    weapons.resetLoadout();
    assignPlans();
    notify('round_start', { round: state.round });
  }

  function startMatch() {
    state.score = { vanguard: 0, dusk: 0 };
    state.lossStreak = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.round = 1;
    state.matchWinner = null;
    startRound();
  }

  function endRound(winner, reason) {
    if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
    state.phase = PHASE.ROUND_END;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.roundEndClock = ROUND_END_TIME;
    if (winner === 'vanguard') {
      state.score.vanguard += 1;
      state.money += WIN_BONUS;
      state.lossStreak = 0;
    } else {
      state.score.dusk += 1;
      state.lossStreak += 1;
      state.money += Math.min(LOSS_BONUS_CAP, LOSS_BONUS + LOSS_STREAK_BONUS * (state.lossStreak - 1));
    }
    notify('round_end', { winner, reason });
    if (state.score.vanguard >= state.winsToTake || state.score.dusk >= state.winsToTake || state.round >= state.maxRounds) {
      state.phase = PHASE.MATCH_END;
      state.matchWinner = state.score.vanguard > state.score.dusk ? 'vanguard' : 'dusk';
      notify('match_end', { winner: state.matchWinner });
    }
  }

  function siteAt(x, z) {
    for (const [name, site] of Object.entries(map.sites)) {
      const dx = x - site.x;
      const dz = z - site.z;
      if (dx * dx + dz * dz < site.radius * site.radius) return name;
    }
    return null;
  }

  function onKill(killer, victim, headshot) {
    const killerName = killer === 'player' ? 'You' : killer.name;
    const victimName = victim === 'player' ? 'You' : victim.name;
    state.killfeed.unshift({ text: `${killerName}  ✕  ${victimName}${headshot ? '  (headshot)' : ''}`, at: performance.now() });
    if (state.killfeed.length > 5) state.killfeed.pop();
    if (killer === 'player') {
      state.kills += 1;
      state.money += KILL_BONUS;
    }
    if (victim === 'player') {
      state.deaths += 1;
      if (state.bomb.status === 'carried' && state.bomb.carrier === 'player') {
        state.bomb.status = 'dropped';
        state.bomb.carrier = null;
        state.bomb.position = { x: player.state.body.position.x, z: player.state.body.position.z };
        notify('bomb_dropped');
      }
    }
    if (victim !== 'player' && victim.team) {
      // A bot that was defusing or carrying the bomb drops its job.
      if (state.bomb.carrier === victim) {
        state.bomb.status = 'dropped';
        state.bomb.carrier = null;
        state.bomb.position = { x: victim.body.position.x, z: victim.body.position.z };
      }
      victim.defusing = false;
    }
    notify('kill', { killer: killerName, victim: victimName, headshot });
    // Elimination ends the round — unless the bomb is already planted, in
    // which case the defenders still have a job to do.
    if (state.bomb.status !== 'planted') {
      if (aliveOf('dusk') === 0) endRound('vanguard', 'Team eliminated');
      else if (aliveOf('vanguard') === 0) endRound('dusk', 'Team eliminated');
    } else if (aliveOf('dusk') === 0) {
      endRound('vanguard', 'Team eliminated');
    }
  }

  function buyItem(id) {
    if (state.phase !== PHASE.BUY) return false;
    if (id === 'armour') {
      if (player.state.armour >= 100 || state.money < ARMOUR_PRICE) {
        notify('denied');
        return false;
      }
      state.money -= ARMOUR_PRICE;
      player.state.armour = 100;
      notify('buy', { item: 'Kevlar armour' });
      return true;
    }
    if (id === 'flashbang') {
      if (weapons.state.flashbangs >= 2 || state.money < FLASHBANG_PRICE) {
        notify('denied');
        return false;
      }
      state.money -= FLASHBANG_PRICE;
      weapons.state.flashbangs += 1;
      notify('buy', { item: 'Flashbang' });
      return true;
    }
    const def = WEAPONS[id];
    if (!def || weapons.state.owned[id] || state.money < def.price) {
      notify('denied');
      return false;
    }
    state.money -= def.price;
    weapons.buy(id);
    weapons.switchTo(id);
    notify('buy', { item: def.name });
    return true;
  }

  function step(dt, now, keys, pressed) {
    if (state.phase === PHASE.BUY) {
      state.buyClock -= dt;
      if (pressed.has('KeyB')) notify('toggle_buy');
      if (state.buyClock <= 0) {
        state.phase = PHASE.LIVE;
        state.roundClock = ROUND_TIME;
        notify('round_live');
      }
      return;
    }
    if (state.phase === PHASE.ROUND_END) {
      state.roundEndClock -= dt;
      if (state.roundEndClock <= 0) {
        state.round += 1;
        startRound();
      }
      return;
    }
    if (state.phase !== PHASE.LIVE) return;

    // The clock only matters before the plant.
    if (state.bomb.status !== 'planted') {
      state.roundClock -= dt;
      if (state.roundClock <= 0) {
        state.roundClock = 0;
        endRound('dusk', 'Time expired');
        return;
      }
    }

    // Planting: the carrier stands in a site and holds E.
    const carrier = state.bomb.carrier;
    if (state.bomb.status === 'carried' || state.bomb.status === 'dropped') {
      if (state.bomb.status === 'dropped') {
        // The nearest living teammate walks to the dropped bomb and picks it up.
        let nearest = null;
        let nearestD = Infinity;
        for (const bot of bots.bots) {
          if (bot.team !== 'vanguard' || !bot.alive) continue;
          const dx = bot.body.position.x - state.bomb.position.x;
          const dz = bot.body.position.z - state.bomb.position.z;
          const d = dx * dx + dz * dz;
          if (d < nearestD) {
            nearestD = d;
            nearest = bot;
          }
        }
        if (nearest) {
          if (nearestD < 1.44) {
            state.bomb.status = 'carried';
            state.bomb.carrier = nearest;
            notify('bomb_picked_up', { by: nearest.name });
            // The new carrier takes the bomb to the nearer site.
            const siteA = map.sites.A;
            const siteB = map.sites.B;
            const dA = (nearest.body.position.x - siteA.x) ** 2 + (nearest.body.position.z - siteA.z) ** 2;
            const dB = (nearest.body.position.x - siteB.x) ** 2 + (nearest.body.position.z - siteB.z) ** 2;
            bots.routeTo(nearest, bots.findRoute(nearest, dA < dB ? 'aSite' : 'bSite'));
          } else if (nearest.mode !== 'investigate') {
            bots.routeTo(nearest, bots.findRoute(nearest, bots.nearestNode(nearest)));
            // Walk straight at the bomb: override the route's last node.
            nearest.route = [];
            nearest.mode = 'investigate';
            nearest.investigateAt.set(state.bomb.position.x, 0, state.bomb.position.z);
            nearest.investigateUntil = now + 20;
          }
        }
      }
      const carrierPos = carrier === 'player'
        ? player.state.body.position
        : carrier && carrier.alive ? carrier.body.position : null;
      if (carrierPos) {
        siteOf = siteAt(carrierPos.x, carrierPos.z);
        const planting = carrier === 'player' ? keys.has('KeyE') : true;
        if (siteOf && planting) {
          state.bomb.plantProgress += dt / PLANT_TIME;
          if (state.bomb.plantProgress >= 1) {
            state.bomb.status = 'planted';
            state.bomb.site = siteOf;
            state.bomb.fuse = FUSE_TIME;
            state.bomb.defuseProgress = 0;
            state.bomb.position = { x: carrierPos.x, z: carrierPos.z };
            state.money += PLANT_BONUS;
            notify('plant', { site: siteOf });
            // Every defender now rushes the planted site.
            for (const bot of bots.bots) {
              if (bot.team === 'dusk' && bot.alive) {
                bots.routeTo(bot, bots.findRoute(bot, siteOf === 'A' ? 'aSite' : 'bSite'));
              }
            }
          }
        } else {
          state.bomb.plantProgress = Math.max(0, state.bomb.plantProgress - dt / PLANT_TIME);
        }
      }
    }

    // The fuse, and the defuse.
    if (state.bomb.status === 'planted') {
      state.bomb.fuse -= dt;
      let defuser = null;
      for (const bot of bots.bots) {
        if (bot.team !== 'dusk' || !bot.alive) continue;
        const dx = bot.body.position.x - state.bomb.position.x;
        const dz = bot.body.position.z - state.bomb.position.z;
        if (dx * dx + dz * dz < 2.56) {
          defuser = bot;
          break;
        }
      }
      if (defuser) {
        defuser.mode = 'hold';
        defuser.holdUntil = now + 1;
        defuser.defusing = true;
        state.bomb.defuseProgress += dt / DEFUSE_TIME;
        if (state.bomb.defuseProgress >= 1) {
          endRound('dusk', 'Bomb defused');
          return;
        }
      } else {
        state.bomb.defuseProgress = Math.max(0, state.bomb.defuseProgress - dt / DEFUSE_TIME);
        for (const bot of bots.bots) if (bot.team === 'dusk') bot.defusing = false;
      }
      if (state.bomb.fuse <= 0) {
        notify('explode', { site: state.bomb.site });
        endRound('vanguard', 'Bomb detonated');
      }
    }
  }

  return {
    events,
    drainEvents,
    startMatch,
    startRound,
    endRound,
    onKill,
    buyItem,
    step,
    siteAt,
    aliveOf,
  };
}
