// Voice commands: tap the microphone, say "前進" / "左轉" / "坐下" / "踢球" ...,
// and the robot does it and answers out loud.
//
// Uses the browser's own speech recognition (Chrome, Edge, Safari) and speech
// synthesis. Browsers only give a page the microphone on https or localhost,
// so over plain http on the LAN this reports itself as unavailable.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Scanning the QR code inside LINE / Facebook / Instagram / WeChat opens their
// own built-in browser, where speech recognition does not work.
const IN_APP_BROWSER = /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(navigator.userAgent);

// Longest phrases first inside each group; both Traditional and Simplified
// spellings, since recognisers sometimes answer in either.
const COMMANDS = [
  { action: 'stop', words: ['不要動', '停下來', '停止', '站好', '停', 'stop'] },
  { action: 'stand', words: ['站起來', '起來', '起立', '站起来', '起来'] },
  { action: 'sit', words: ['坐下來', '坐下', '坐下来', '坐'] },
  { action: 'spin', words: ['轉一圈', '轉圈', '转一圈', '转圈'] },
  { action: 'left', words: ['向左轉', '往左轉', '左轉', '向左', '往左', '左边', '左邊', '左转', 'left'] },
  { action: 'right', words: ['向右轉', '往右轉', '右轉', '向右', '往右', '右边', '右邊', '右转', 'right'] },
  { action: 'back', words: ['往後退', '向後退', '後退', '往後', '倒退', '后退', '往后', 'back'] },
  { action: 'kick', words: ['射門', '踢球', '射门', '踢', 'kick'] },
  { action: 'pick', words: ['撿東西', '撿起來', '低頭', '撿', '捡东西', '捡'] },
  { action: 'roll', words: ['前滾翻', '翻跟斗', '翻滾', '前滚翻', '翻滚', '翻'] },
  { action: 'forward', words: ['往前走', '向前走', '前進', '往前', '向前', '前进', '走', 'forward'] },
  { action: 'reset', words: ['重新開始', '重來', '重新开始', '重来'] },
  { action: 'challenge', words: ['開始挑戰', '挑戰', '比賽', '开始挑战', '挑战', '比赛'] },
  { action: 'hello', words: ['你好', '哈囉', '嗨', '您好', 'hello'] },
  { action: 'who', words: ['你是誰', '你叫什麼', '名字', '你是谁', '你叫什么'] },
];

// seconds a spoken move keeps going (the robot turns ~40 degrees a second)
const MOVE_SECONDS = { forward: 2.5, back: 2.0, left: 1.2, right: 1.2, spin: 8.5 };

export function parseCommand(text) {
  const t = text.toLowerCase().replace(/[\s，。！？,.!?]/g, '');
  for (const c of COMMANDS) if (c.words.some((w) => t.includes(w))) return c.action;
  return null;
}

export class Voice {
  // hooks: { robot, driver, game, name, onState(state, text) } where state is
  // 'listening' | 'heard' | 'reply' | 'error' | 'idle'
  constructor(hooks) {
    Object.assign(this, hooks);
    this.listening = false;
    this.recognizer = null;
    this.muted = () => false;
  }

  get available() { return Boolean(Recognition) && window.isSecureContext && !IN_APP_BROWSER; }

  get unavailableReason() {
    if (IN_APP_BROWSER) {
      return '這是 App 內建的瀏覽器，不能用語音。請按右上角「⋯」選「用瀏覽器開啟」（Chrome 或 Safari）。';
    }
    if (!Recognition) return '這個瀏覽器不支援語音辨識，請用 Chrome、Edge 或 Safari。';
    if (!window.isSecureContext) {
      return '語音指令需要 https 網址：網站放上網路後就能用；在區域網路測試時，請在電腦上改用 run_web_voice_test.bat。';
    }
    return '';
  }

  toggle() {
    if (this.listening) { this.recognizer?.stop(); return; }
    if (!this.available) { this.onState('error', this.unavailableReason); return; }
    const r = new Recognition();
    r.lang = 'zh-TW';
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.continuous = false;
    this.recognizer = r;
    let finalText = '';
    r.onstart = () => { this.listening = true; this.onState('listening', '請說：前進、左轉、坐下、踢球…'); };
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      // Of the alternatives, prefer one that is a command we know.
      let best = last[0].transcript;
      for (let i = 0; i < last.length; i++) {
        if (parseCommand(last[i].transcript)) { best = last[i].transcript; break; }
      }
      this.onState('heard', best);
      if (last.isFinal) finalText = best;
    };
    r.onerror = (e) => {
      const why = { 'not-allowed': '沒有麥克風權限，請在瀏覽器允許使用麥克風。', 'no-speech': '沒有聽到聲音，再試一次？', 'network': '語音辨識需要網路連線。' }[e.error];
      this.onState('error', why || `語音辨識錯誤（${e.error}）`);
    };
    r.onend = () => {
      this.listening = false;
      if (finalText) this.handle(finalText); else this.onState('idle', '');
    };
    try { r.start(); } catch (err) { this.onState('error', String(err.message || err)); }
  }

  // Do what the text asks; returns the spoken reply. Also used by tests.
  handle(text) {
    const action = parseCommand(text);
    const { robot, driver, game, name } = this;
    const now = performance.now() / 1000;
    const move = (dir, seconds) => {
      driver.stop();
      driver.until[dir] = now + seconds;
    };
    let reply;
    switch (action) {
      case 'forward': move('up', MOVE_SECONDS.forward); reply = '好的，前進！'; break;
      case 'back': move('down', MOVE_SECONDS.back); reply = '後退！'; break;
      case 'left': move('left', MOVE_SECONDS.left); reply = '向左轉！'; break;
      case 'right': move('right', MOVE_SECONDS.right); reply = '向右轉！'; break;
      case 'spin': move('left', MOVE_SECONDS.spin); reply = '我轉一圈給你看！'; break;
      case 'stop': driver.stop(); reply = '好，我停下來了。'; break;
      case 'sit':
        if (robot.sitMode) reply = '我已經坐著了。';
        else { driver.stop(); robot.toggleSit(); reply = '好，我坐下。'; }
        break;
      case 'stand':
        if (!robot.sitMode) reply = '我站著呢！';
        else { robot.toggleSit(); driver.busyUntil = now + 2; reply = '我站起來了！'; }
        break;
      case 'pick': driver.stop(); robot.triggerPick(); reply = '我來撿撿看！'; break;
      case 'kick': {
        const foot = robot.kickReady();
        driver.stop();
        robot.triggerBehavior(foot || 'kick_left');
        reply = foot ? '看我射門！' : '球不在我腳前面，我先踢踢看！';
        break;
      }
      case 'roll': driver.stop(); robot.triggerBehavior('roulade'); reply = '看我前滾翻！'; break;
      case 'reset': robot.reset(); driver.stop(); reply = '重新開始！'; break;
      case 'challenge': driver.stop(); game.startChallenge(); reply = '挑戰開始！六十秒，加油！'; break;
      case 'hello': reply = `你好！我是${name}！`; break;
      case 'who': reply = `我是${name}，一個會走路、會踢球的機器人！`; break;
      default: reply = '我聽不懂耶……可以說「前進」、「左轉」、「坐下」或「踢球」喔！';
    }
    this.onState('reply', reply);
    this.say(reply);
    return { action, reply };
  }

  say(text) {
    if (this.muted() || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    u.rate = 1.05;
    u.pitch = 1.5;  // a child's voice
    const voice = speechSynthesis.getVoices().find((v) => /zh[-_]TW/i.test(v.lang))
      || speechSynthesis.getVoices().find((v) => /^zh/i.test(v.lang));
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
