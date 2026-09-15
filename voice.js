// =============================================================================
// voice.js — สั่ง 小慈 ด้วยเสียงภาษาจีน
// =============================================================================
//
// ทำงานยังไง (ไฟล์นี้ = หู + ปาก ส่วน "สมอง" ที่คิดว่าจะพูด/ทำอะไร อยู่ที่ brain.js)
//   1. ฟัง:   ใช้ระบบถอดเสียงของเบราว์เซอร์ (Web Speech API, ภาษา zh-TW) → ได้ "ข้อความ"
//             (Chrome ส่งเสียงไปถอดที่ Google, Safari ใช้ของ Apple; เว็บเราได้แค่ข้อความ)
//   2. คิด:   handle() ส่งข้อความให้ brain.ask() → ได้ { say(พูดอะไร), do(ทำท่าอะไร), mood(สีหน้า) }
//             ยกเว้นคำสั่งฉุกเฉิน「停/重來」ทำทันทีไม่ผ่านสมอง (รอ AI คิด = ช้าเกินไป)
//   3. ทำ:    doAction() สั่งหุ่นทีละท่า (ผ่าน driver / robot / game)
//   4. ตอบ:   say() พูดตอบด้วยเสียงสังเคราะห์ของเครื่อง (speechSynthesis) เสียงสูงแบบเด็ก
//
// COMMANDS ในไฟล์นี้ยังอยู่ ใช้ 2 อย่าง: (ก) เดาว่าผู้ใช้พูดคำสั่งฉุกเฉินไหม
// (ข) เป็นตัวสำรองให้ brain.js เวลาต่อ AI ไม่ได้ (ดู mode 'keywords' ใน brain.js)
//
// ไฟล์นี้แบ่งเป็น 3 ส่วน
//   ส่วนที่ 1  ตารางคำสั่ง COMMANDS + เวลาที่แต่ละท่าเดินต่อ MOVE_SECONDS   ← เพิ่มคำสั่งใหม่ตรงนี้
//   ส่วนที่ 2  parseCommand(): ข้อความ → ชื่อคำสั่ง
//   ส่วนที่ 3  class Voice: เปิด/ปิดไมค์ (toggle), ทำตามคำสั่ง (handle), พูดตอบ (say)
//
// ต่อกับไฟล์อื่นยังไง
//   app.js ฟังก์ชัน wireVoice() สร้าง new Voice({...}) ส่ง robot, driver, game ให้ และบอกว่า
//   เวลาสถานะเปลี่ยน (onState) ให้แสดงกล่องข้อความยังไง ปุ่ม 🎤 และปุ่ม V เรียก voice.toggle()
//
// ข้อจำกัดของเบราว์เซอร์: ใช้ไมค์ได้เฉพาะเว็บ https หรือ localhost และในแอป LINE/Facebook ใช้ไม่ได้
// และบน iPhone เสียงพูดต้องถูก "ปลดล็อก" ตอนนิ้วแตะจอก่อน ไม่งั้นเงียบสนิท (ดู unlockSpeech)
//
// อยากเพิ่มคำสั่ง เช่น「跳舞」: ①เพิ่ม { action: 'dance', words: ['跳舞'] } ใน COMMANDS
//                          ②เพิ่ม case 'dance': ... ใน handle() ว่าจะให้หุ่นทำอะไร และพูดตอบว่าอะไร

// ---- ส่วนที่ 1: ตารางคำสั่ง -------------------------------------------------------
// window.SpeechRecognition = ตัวถอดเสียงของเบราว์เซอร์ (Chrome/Safari ใช้ชื่อ webkitSpeechRecognition)
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
  { action: 'roll', words: ['前滾翻', '翻跟斗', '翻滾', '前滚翻', '翻滚', '翻'] },
  { action: 'forward', words: ['往前走', '向前走', '前進', '往前', '向前', '前进', '走', 'forward'] },
  { action: 'reset', words: ['重新開始', '重來', '重新开始', '重来'] },
  { action: 'hello', words: ['你好', '哈囉', '嗨', '您好', 'hello'] },
  { action: 'who', words: ['你是誰', '你叫什麼', '名字', '你是谁', '你叫什么'] },
];

// seconds a spoken move keeps going (the robot turns ~40 degrees a second)
const MOVE_SECONDS = { forward: 2.5, back: 2.0, left: 1.2, right: 1.2, spin: 8.5 };

// ---- ส่วนที่ 2: ข้อความ → คำสั่ง ----------------------------------------------------
// ตัดช่องว่าง/เครื่องหมายวรรคตอนออก แล้วไล่ตาราง COMMANDS จากบนลงล่าง กลุ่มแรกที่เจอคำตรงชนะ
// (ลำดับในตารางสำคัญ: 'stop' อยู่บนสุดเพราะ「不要動」ต้องชนะคำอื่น)
export function parseCommand(text) {
  const t = text.toLowerCase().replace(/[\s，。！？,.!?]/g, '');
  for (const c of COMMANDS) if (c.words.some((w) => t.includes(w))) return c.action;
  return null;
}

// ---- ส่วนที่ 3: ตัวฟัง/พูด ------------------------------------------------------------
export class Voice {
  // hooks: { robot, driver, game, name, brain, onState(state, text) } where state is
  // 'listening' | 'heard' | 'thinking' | 'reply' | 'error' | 'idle'
  constructor(hooks) {
    Object.assign(this, hooks);
    this.listening = false;
    this.thinking = false;                       // กำลังรอสมองคิด (app.js เอาไปทำสีหน้า)
    this.emergency = new Set(['stop', 'reset']); // คำสั่งที่ต้องทำทันที ไม่ผ่านสมอง
    this.mood = null;                            // สีหน้าที่สมองสั่งล่าสุด
    this.moodUntil = 0;                          // แสดงสีหน้านั้นถึงเวลาไหน (ms)
    this.recognizer = null;
    this.muted = () => false;
    this.speechUnlocked = false;   // ดู unlockSpeech()
  }

  // ปลดล็อกเสียงพูดของ iPhone — ต้องเรียกตอน "นิ้วแตะจอ" เท่านั้น
  //
  // ปัญหาที่เจอจริงบน iPhone + Safari (2026-09-15): กดไมค์ พูดใส่ ข้อความขึ้นจอครบ
  // เสียงเอฟเฟกต์ก็ดัง แต่หุ่นไม่พูดสักคำ และไม่มี error อะไรเลย
  //
  // สาเหตุ: iOS ยอมให้ speechSynthesis.speak() ออกเสียง ก็ต่อเมื่อเคยถูกเรียก
  // "ระหว่างที่นิ้วแตะจอ" มาก่อนอย่างน้อยหนึ่งครั้ง แต่ของเราหุ่นพูดตอนคิดเสร็จ
  // ซึ่งช้ากว่าการแตะปุ่มไป 2-8 วินาที (ยิ่งมีค้นคลังยิ่งนาน) → เลยจังหวะนั้นไปแล้ว
  // iOS จึงกลืนคำสั่งเงียบๆ ไม่ฟ้องอะไร (คอมไม่เจอ เพราะ Chrome/Edge ไม่มีข้อจำกัดนี้)
  //
  // วิธีแก้: ตอนแตะปุ่ม ให้สั่งพูด "ช่องว่าง" ด้วยเสียงระดับ 0 หนึ่งครั้ง
  // คนเล่นไม่ได้ยินอะไร แต่ iOS ถือว่าเครื่องเสียงถูกเปิดแล้ว ครั้งต่อๆ ไปพูดได้ตลอด
  unlockSpeech() {
    if (this.speechUnlocked || !('speechSynthesis' in window)) return;
    this.speechUnlocked = true;
    try {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      speechSynthesis.speak(silent);
    } catch { /* เบราว์เซอร์ที่ไม่รองรับก็แค่ไม่มีเสียงพูด ส่วนอื่นเล่นได้ปกติ */ }
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
    this.unlockSpeech();   // ต้องอยู่บรรทัดแรก: ตอนนี้ยังอยู่ใน "จังหวะที่นิ้วแตะจอ"
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

  // ตั้งสีหน้าชั่วคราวตามอารมณ์ที่สมองบอก (app.js expression() มาอ่านผ่าน activeMood())
  setMood(mood) { this.mood = mood; this.moodUntil = performance.now() + 4000; }
  activeMood() { return performance.now() < this.moodUntil ? this.mood : null; }

  // ทำ "ท่าเดียว" ตามชื่อที่สมองสั่ง — เฉพาะการขยับหุ่น ไม่มีคำพูด (คำพูดมาทางช่อง say)
  // ชื่อท่าต้องตรงกับตาราง ACTIONS ใน brain.js (ที่ ready: true)
  doAction(action) {
    const { robot, driver } = this;
    const now = performance.now() / 1000;
    const move = (dir, seconds) => { driver.stop(); driver.until[dir] = now + seconds; };
    switch (action) {
      case 'forward': move('up', MOVE_SECONDS.forward); break;
      case 'back': move('down', MOVE_SECONDS.back); break;
      case 'left': move('left', MOVE_SECONDS.left); break;
      case 'right': move('right', MOVE_SECONDS.right); break;
      case 'spin': move('left', MOVE_SECONDS.spin); break;
      case 'stop': driver.stop(); break;
      case 'sit': if (!robot.sitMode) { driver.stop(); robot.toggleSit(); } break;
      case 'stand': if (robot.sitMode) { robot.toggleSit(); driver.busyUntil = now + 2; } break;
      case 'roll': driver.stop(); robot.triggerBehavior('roulade'); break;
      case 'reset': robot.reset(); driver.stop(); break;
    }
  }

  // รับข้อความ (จากไมค์หรือช่องพิมพ์) → ตัดสินใจ → พูด + ขยับหุ่น
  // เป็น async เพราะสมองอาจต้องรอ AI ตอบ 1–3 วิ (หุ่นยังทรงตัว/เดินต่อได้ปกติระหว่างรอ)
  async handle(text) {
    // ด่านฉุกเฉิน:「停」「重來」ทำทันที ไม่ส่งไปให้สมองคิด (จะช้าเกินไปถ้าจะชนแล้วสั่งหยุด)
    const kw = parseCommand(text);
    if (this.emergency.has(kw)) {
      this.doAction(kw);
      const reply = kw === 'stop' ? '好，我停下來了。' : '重新開始！';
      this.setMood('happy');
      this.onState('reply', reply);
      this.say(reply);
      return { action: kw, reply, say: reply, do: [kw], mood: 'happy' };
    }
    // ถามสมอง — ระหว่างรอโชว์ว่า "กำลังคิด"
    this.thinking = true;
    this.onState('thinking', '嗯……');
    let res;
    try {
      res = await this.brain.ask(text);
    } finally {
      this.thinking = false;
    }
    // พูดตอบก่อนเสมอ (ไม่ให้เงียบระหว่างลุก) แล้วค่อยลงมือทำท่า
    this.setMood(res.mood);
    this.onState('reply', res.say);
    this.say(res.say);
    await this.runActions(res.do);
    return { action: res.do[0] || null, reply: res.say, ...res };
  }

  // ทำท่าทั้งหมดที่สมองสั่ง — ถ้ากำลังนั่งอยู่แล้วมีท่าที่ต้องยืน (เตะ/ตีลังกา/เก็บของ)
  // ให้ลุกขึ้นก่อนแล้วรอจนยืนมั่นคง ค่อยทำ (ไม่งั้นหุ่นรับปากแต่ไม่ขยับเพราะนั่งอยู่)
  async runActions(list) {
    const NEEDS_STANDING = new Set(['roll']);
    if (this.robot.sitMode && list.some((a) => NEEDS_STANDING.has(a))) {
      this.robot.toggleSit();                                  // ลุกขึ้น
      this.driver.busyUntil = performance.now() / 1000 + 2;    // กันสั่งเดินระหว่างลุก
      await new Promise((r) => setTimeout(r, 2100));           // รอลุกให้เสร็จ (~2 วิ)
    }
    for (const a of list) this.doAction(a);
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
    // เว้น 1 จังหวะก่อนสั่งพูด: บน iOS ถ้า cancel() กับ speak() ติดกันเลย
    // ประโยคใหม่จะถูกยกเลิกไปด้วยเป็นบางครั้ง
    setTimeout(() => {
      // บางครั้ง iOS ค้างสถานะ "หยุดพูดชั่วคราว" ไว้ (เช่นหลังสลับแอป) ต้องปลุกก่อน
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(u);
    }, 0);
  }
}
