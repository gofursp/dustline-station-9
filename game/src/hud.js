// The DOM HUD: health, armour, ammo, money, the round clock, the score, the
// kill feed, the bomb, the buy menu and the banners. It never touches the
// simulation; main.js pushes numbers in and reads the play and buy callbacks
// out. Every setter remembers its last value and leaves the DOM alone when
// nothing changed, so a 60 Hz sim never thrashes the layout.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armourFill = $('armour-fill');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const roundValue = $('round-value');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const bombFill = $('bomb-fill');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const damageVignette = $('damage-vignette');
  const flashOverlay = $('flash-overlay');
  const buyMenu = $('buy-menu');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerCopy = $('banner-copy');

  let lastHealth = -1;
  let lastArmour = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastRound = '';
  let lastBomb = '';
  let hitTimer = 0;
  let damageTimer = 0;

  const COPY = {
    start: {
      title: 'DUSTLINE: Station 9',
      copy: 'A freight yard at dusk. Plant the charge at Site A or Site B — or eliminate the Dusk squad. First to 5 rounds takes the yard.',
      action: 'Click to play',
    },
    paused: {
      title: 'DUSTLINE: Station 9',
      copy: 'Paused. Click to resume.',
      action: 'Click to resume',
    },
    dead: {
      title: 'You are down',
      copy: 'Your squad fights on. The round ends when one side is gone — or the charge goes off.',
      action: 'Spectate',
    },
  };

  return {
    setHealth(value) {
      if (value === lastHealth) return;
      lastHealth = value;
      healthFill.style.width = `${value}%`;
      healthValue.textContent = String(value);
      healthFill.classList.toggle('low', value <= 30);
    },
    setArmour(value) {
      if (value === lastArmour) return;
      lastArmour = value;
      armourFill.style.width = `${value}%`;
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setTimer(text, urgent) {
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', !!urgent);
    },
    setScore(vanguard, dusk, round) {
      const text = `Vanguard <b>${vanguard} : ${dusk}</b> Dusk`;
      if (text !== lastScore) {
        lastScore = text;
        scoreValue.innerHTML = text;
      }
      const roundText = `Round ${round}`;
      if (roundText !== lastRound) {
        lastRound = roundText;
        roundValue.textContent = roundText;
      }
    },
    pushKill(text) {
      const line = document.createElement('div');
      line.className = 'killfeed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
    },
    setBomb(text, progress) {
      const key = `${text}|${Math.round(progress * 20)}`;
      if (key === lastBomb) return;
      lastBomb = key;
      bombStatus.textContent = text;
      bombFill.style.width = `${Math.round(progress * 100)}%`;
      bombStatus.parentElement.hidden = text === '';
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageVignette.classList.remove('on'), 220);
    },
    flashWhite(strength) {
      flashOverlay.style.opacity = String(Math.min(1, strength));
      if (strength > 0) {
        setTimeout(() => { flashOverlay.style.opacity = '0'; }, 60);
        setTimeout(() => { flashOverlay.style.opacity = '0'; }, 900);
      }
    },
    showBuy(money, owned) {
      buyMenu.hidden = false;
      $('buy-money').textContent = `$${money}`;
      for (const button of buyMenu.querySelectorAll('[data-buy]')) {
        const id = button.dataset.buy;
        const price = Number(button.dataset.price);
        button.disabled = money < price || (owned[id] && id !== 'flashbang' && id !== 'armour');
        button.classList.toggle('owned', !!owned[id] && id !== 'flashbang' && id !== 'armour');
      }
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    buyVisible() {
      return !buyMenu.hidden;
    },
    showBanner(title, copy, ms = 3800) {
      bannerTitle.textContent = title;
      bannerCopy.textContent = copy;
      banner.hidden = false;
      setTimeout(() => { banner.hidden = true; }, ms);
    },
    showOverlay(mode) {
      const text = COPY[mode];
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (button && !button.disabled) handler(button.dataset.buy);
      });
    },
  };
}
