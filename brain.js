// =============================================================================
// brain.js — "สมอง" ที่ตัดสินใจว่า 小慈 จะพูดอะไรและทำท่าอะไร
// =============================================================================
//
// ไฟล์นี้ต่างจาก voice.js ยังไง
//   voice.js = หู + ปาก (ฟังเสียง → ข้อความ, ข้อความ → เสียง)  ← ไม่คิดอะไร
//   brain.js = สมอง      (ข้อความ → จะพูดอะไร + จะทำท่าอะไร)   ← ไฟล์นี้
//   app.js   = ร่างกาย   (รับท่า → ขยับจริงด้วยฟิสิกส์)
//
// ทำงานยังไง
//   1. voice.js ได้ข้อความจากไมค์ แล้วเรียก brain.ask('你好')
//   2. สมองคิด แล้วตอบกลับเป็นวัตถุ 3 ช่อง:
//        { say: '你好！我是小慈！',  do: ['stand'],  mood: 'happy' }
//          ↑ ข้อความที่จะพูด        ↑ ท่าที่จะทำ    ↑ สีหน้า
//   3. voice.js เอา say ไปพูด, เอา do ไปสั่งหุ่น, เอา mood ไปเปลี่ยนสีหน้า
//
// สมองมี 3 แบบ สลับได้ (เพราะตอนนี้ยังไม่มี AI จริง ต้องทดสอบด้วยของปลอมก่อน)
//   'mock'     สมองปลอม ตอบตามสคริปต์ที่เราเขียนไว้ + แกล้งคิดช้า 0.8 วิ  ← ใช้ตอนนี้
//   'keywords' ใช้ตารางคำของ voice.js (เร็วที่สุด ไม่ต้องต่อเน็ต)
//   'llm'      ของจริง ต่อ AI ของรุ่นพี่ (ยังไม่ได้ URL เลยยังใช้ไม่ได้)
//
// ไฟล์นี้แบ่งเป็น 5 ส่วน
//   ส่วนที่ 1  ACTIONS + MOODS = "หุ่นทำท่าอะไรได้ / มีสีหน้าอะไร"   ← เพิ่มท่าใหม่ตรงนี้
//   ส่วนที่ 2  systemPrompt() สร้างคำสั่งสอน AI จากตารางในส่วนที่ 1 (ไม่ต้องเขียนซ้ำ)
//   ส่วนที่ 3  sanitize() กรองคำตอบ ← ด่านความปลอดภัย สำคัญมาก
//   ส่วนที่ 4  สมอง 3 แบบ (mockBrain / keywordBrain / llmBrain)
//   ส่วนที่ 5  class Brain ตัวห่อ: เลือกโหมด + จำบทสนทนา
//
// ต่อกับไฟล์อื่นยังไง
//   voice.js  สร้าง new Brain({...}) แล้วเรียก brain.ask(ข้อความ)
//   face.js   รับค่า mood ไปวาดสีหน้า (ชื่อสีหน้าต้องตรงกับที่ face.js รู้จัก)
//   app.js    รับค่า do ไปสั่งหุ่นผ่าน handle() ของ voice.js
//
// ไม่ใช้ไลบรารีอะไรเลย และไม่เรียกใช้ของเบราว์เซอร์ (window, document) แม้แต่ตัวเดียว
// → ทดสอบด้วย node ได้ตรงๆ ไม่ต้องเปิดเบราว์เซอร์ (ดู tools/test_brain.mjs)

// ---- ส่วนที่ 1: หุ่นทำอะไรได้ -------------------------------------------------------
// ตารางนี้คือ "ความจริง" ที่ทุกส่วนอ้างอิง: คำสั่งสอน AI สร้างจากตารางนี้
// และด่านกรองก็ใช้ตารางนี้ตัดสินว่าคำสั่งไหนของปลอม
//
// ready: true  = ทำได้จริงแล้ว (มีโค้ดใน handle() ของ voice.js)
// ready: false = วางแผนไว้แต่ยังไม่ได้เขียน → ด่านกรองจะตัดออก และไม่บอก AI ว่ามีท่านี้
//                (พอเขียนเสร็จค่อยเปลี่ยนเป็น true ที่เดียว ทุกส่วนอัปเดตตาม)
export const ACTIONS = [
  { name: 'forward',   ready: true,  desc: '往前走' },
  { name: 'back',      ready: true,  desc: '往後退' },
  { name: 'left',      ready: true,  desc: '向左轉' },
  { name: 'right',     ready: true,  desc: '向右轉' },
  { name: 'spin',      ready: true,  desc: '轉一整圈' },
  { name: 'stop',      ready: true,  desc: '停下來不動' },
  { name: 'sit',       ready: true,  desc: '坐下' },
  { name: 'stand',     ready: true,  desc: '站起來' },
  { name: 'pick',      ready: true,  desc: '低頭撿地上的東西' },
  { name: 'kick',      ready: true,  desc: '踢球' },
  { name: 'roll',      ready: true,  desc: '前滾翻（很厲害的特技）' },
  { name: 'reset',     ready: true,  desc: '回到起點重新開始' },
  { name: 'challenge', ready: true,  desc: '開始六十秒射門挑戰' },
  // ท่าหลายขั้นตอน — ยังไม่ได้เขียน (เฟส A ขั้นถัดไป ดู docs/INTEGRATION.md หัวข้อ 4)
  { name: 'come',      ready: false, desc: '走到說話的人面前' },
  { name: 'fetch',     ready: false, desc: '去撿東西再帶回來' },
];

// สีหน้าที่ face.js วาดได้ (ชื่อต้องตรงกันเป๊ะ ไม่งั้นหน้าจะไม่เปลี่ยน)
export const MOODS = ['happy', 'curious', 'determined', 'dizzy', 'down', 'love', 'sleepy', 'surprised'];

// ท่าที่ใช้ได้จริงตอนนี้ (คำนวณจากตารางข้างบน ไม่ต้องพิมพ์ซ้ำ)
const READY = ACTIONS.filter((a) => a.ready).map((a) => a.name);

// คำตอบสำรอง ใช้เมื่อสมองพัง/เน็ตล่ม/คำตอบอ่านไม่ออก — หุ่นต้องไม่เงียบหายไปเฉยๆ
const FALLBACK = { say: '我沒聽清楚，可以再說一次嗎？', do: [], mood: 'curious' };

// เอา markdown ออกจากข้อความที่จะพูด — บาง AI (เช่น gemma) ชอบใส่ **ตัวหนา** * # `
// ซึ่งพออ่านออกเสียง เครื่องจะอ่านสัญลักษณ์พวกนี้ออกมาด้วย ("ดอกจัน...") ฟังไม่รู้เรื่อง
function stripMarkup(s) {
  return String(s)
    .replace(/\*\*(.+?)\*\*/gs, '$1')   // **ตัวหนา** → ตัวหนา
    .replace(/\*(.+?)\*/gs, '$1')       // *เอียง* → เอียง
    .replace(/`(.+?)`/gs, '$1')         // `โค้ด` → โค้ด
    .replace(/^#{1,6}\s*/gm, '')        // # หัวข้อ
    .replace(/^\s*[-*]\s+/gm, '')       // - รายการ / * รายการ
    .replace(/[*_`#]/g, '')             // สัญลักษณ์ที่หลงเหลือ
    .replace(/\s+/g, ' ')               // ยุบช่องว่าง/ขึ้นบรรทัดหลายอันให้เหลืออันเดียว
    .trim();
}

// ---- ส่วนที่ 2: คำสั่งสอน AI --------------------------------------------------------
// สร้างข้อความยาวๆ ที่บอก AI ว่า "เธอคือหุ่นชื่อ 小慈 ทำท่าได้เท่านี้ ตอบเป็น JSON นะ"
// สร้างจากตาราง ACTIONS อัตโนมัติ → เพิ่มท่าใหม่ในตาราง คำสั่งนี้อัปเดตเอง ไม่ลืม
export function systemPrompt(name = '小慈') {
  const list = ACTIONS.filter((a) => a.ready).map((a) => `  "${a.name}" = ${a.desc}`).join('\n');
  return `你是一個小機器人，名字叫${name}。你住在一個 3D 模擬世界裡，有兩隻腳和一個會轉的頭（沒有手）。
你的個性：像小孩子一樣好奇、友善、有精神。回答要短，最多兩句話，用繁體中文口語。
你的話會被念出來，所以 say 必須是純口語：不可以有 markdown、星號 *、井號 #、條列、程式碼、表情符號或英文標籤。

你只能做這些動作，不可以自己發明新動作：
${list}

回覆格式必須是 JSON，不要加任何其他文字、不要加 markdown 標記：
{"say": "要說的話", "do": ["動作名稱"], "mood": "表情"}

- say：你要說的話（繁體中文）
- do：要做的動作陣列。只聊天不動就給空陣列 []。最多 3 個動作。
- mood：表情，只能選 ${MOODS.join(' / ')}

例子：
使用者說「過來」→ {"say": "好，我走過去！", "do": ["forward"], "mood": "happy"}
使用者說「你好呀」→ {"say": "你好！我是${name}！", "do": [], "mood": "happy"}
使用者說「你會什麼」→ {"say": "我會走路、踢球，還會前滾翻喔！", "do": [], "mood": "determined"}`;
}

// ---- ส่วนที่ 3: ด่านกรองคำตอบ -------------------------------------------------------
// ทำไมต้องมี: AI ไม่เชื่อฟัง 100% มันอาจตอบเป็นข้อความเปล่า ใส่ ```json ครอบ
// หรือแต่งชื่อท่าที่ไม่มีจริงขึ้นมา ("jump", "dance") ถ้าปล่อยเข้าไปหุ่นจะทำงานเพี้ยน
// กฎ: อะไรที่ไม่รู้จัก → "ทิ้ง" ไม่ใช่ "ลองทำดู"
export function sanitize(raw) {
  // 3.1 หา JSON ให้เจอก่อน — AI ชอบใส่ ```json ... ``` ครอบ หรือพูดนำหน้า
  let obj = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { obj = JSON.parse(text.slice(start, end + 1)); } catch { obj = null; }
    } else {
      obj = null;
    }
    // อ่านเป็น JSON ไม่ได้เลย → ถือว่า AI พูดเปล่าๆ เอาข้อความไปพูดแต่ไม่สั่งท่าอะไร
    if (!obj) { const clean = stripMarkup(text); return clean ? { say: clean.slice(0, 200), do: [], mood: 'happy' } : { ...FALLBACK }; }
  }
  if (!obj || typeof obj !== 'object') return { ...FALLBACK };

  // 3.2 say: ต้องเป็นข้อความ เอา markdown ออก ไม่ยาวเกิน 200 ตัว (พูดยาวกว่านี้คนฟังเบื่อ)
  const sayRaw = typeof obj.say === 'string' ? stripMarkup(obj.say) : '';
  const say = sayRaw ? sayRaw.slice(0, 200) : FALLBACK.say;

  // 3.3 do: เก็บแต่ท่าที่มีในตารางและ ready เท่านั้น สูงสุด 3 ท่า
  const list = Array.isArray(obj.do) ? obj.do : (typeof obj.do === 'string' ? [obj.do] : []);
  const dropped = [];
  const actions = [];
  for (const a of list) {
    if (typeof a !== 'string') continue;
    const k = a.trim().toLowerCase();
    if (READY.includes(k)) { if (!actions.includes(k)) actions.push(k); }
    else if (k) dropped.push(k);
  }
  // บอกใน console ว่าตัดอะไรออก — เวลาดีบักจะรู้ทันทีว่า AI สั่งท่าที่ไม่มี
  if (dropped.length) console.warn('[brain] ทิ้งท่าที่หุ่นทำไม่ได้:', dropped.join(', '));

  // 3.4 mood: ต้องเป็นชื่อที่ face.js รู้จัก ไม่ใช่ก็ใช้ happy
  const mood = MOODS.includes(obj.mood) ? obj.mood : 'happy';

  return { say, do: actions.slice(0, 3), mood };
}

// ---- ส่วนที่ 4: สมอง 3 แบบ ----------------------------------------------------------
// ทุกแบบมีหน้าตาเหมือนกัน: รับข้อความ → คืน { say, do, mood }
// เลยสลับกันได้โดยส่วนอื่นของโปรแกรมไม่รู้ตัว (เรียกวิธีนี้ว่า adapter)

// 4.1 สมองปลอม — ไม่ต้องต่อเน็ต ไม่ต้องมีรหัส API ใช้ทดสอบว่าสายส่งข้อมูลครบ
// ตั้งใจ "แกล้งคิดช้า" 0.8 วินาที เพื่อให้เจอปัญหาเดียวกับ AI จริงตั้งแต่ตอนนี้
// (เช่น ถ้าหุ่นค้างระหว่างรอ = โค้ดเราผิด ต้องแก้ก่อนต่อของจริง)
const MOCK_SCRIPT = [
  { words: ['你好', '哈囉', '嗨', '您好'], say: '你好！我是小慈，很高興認識你！', do: [], mood: 'happy' },
  { words: ['你是誰', '你叫什麼', '名字'], say: '我是小慈，一個會走路的小機器人！', do: [], mood: 'happy' },
  { words: ['過來', '來這裡', '到我這'], say: '好，我走過去！', do: ['forward'], mood: 'happy' },
  { words: ['你會什麼', '會做什麼', '厲害'], say: '我會走路、踢球，還會前滾翻喔！', do: [], mood: 'determined' },
  { words: ['表演', '特技', '翻'], say: '看我前滾翻！', do: ['roll'], mood: 'determined' },
  { words: ['踢球', '射門'], say: '看我射門！', do: ['kick'], mood: 'determined' },
  { words: ['累', '休息', '坐'], say: '好，我坐下休息一下。', do: ['sit'], mood: 'sleepy' },
  { words: ['撿', '幫我拿'], say: '我來撿撿看！', do: ['pick'], mood: 'curious' },
  { words: ['謝謝', '感謝'], say: '不客氣！', do: [], mood: 'love' },
  { words: ['再見', '掰掰'], say: '掰掰！下次再來玩！', do: [], mood: 'happy' },
];

function mockBrain(delayMs = 800) {
  return async function ask(text) {
    await new Promise((r) => setTimeout(r, delayMs));  // แกล้งคิดช้าเหมือน AI จริง
    const t = String(text).replace(/[\s，。！？,.!?]/g, '');
    for (const row of MOCK_SCRIPT) {
      if (row.words.some((w) => t.includes(w))) return sanitize(row);
    }
    return sanitize({ say: `你說「${text}」，我還在學這句話的意思！`, do: [], mood: 'curious' });
  };
}

// 4.2 สมองตารางคำ — ใช้ parseCommand ของ voice.js (ตอบทันที 0 วินาที)
// ใช้เป็นของสำรองเวลาเน็ตล่ม หรือเวลาเว็บสาธารณะไม่มีรหัส API ให้ใช้
function keywordBrain(parseCommand, name) {
  return async function ask(text) {
    const action = parseCommand(text);
    if (!action) return { ...FALLBACK };
    if (action === 'hello') return sanitize({ say: `你好！我是${name}！`, do: [], mood: 'happy' });
    if (action === 'who') return sanitize({ say: `我是${name}，一個會走路、會踢球的機器人！`, do: [], mood: 'happy' });
    return sanitize({ say: '好！', do: [action], mood: 'happy' });
  };
}

// 4.3 สมองจริง — ส่งข้อความไปให้ AI ของรุ่นพี่ตอบ
//
// ⚠️ ยังใช้ไม่ได้ ต้องรอ 2 อย่างจากรุ่นพี่ (ดู docs/INTEGRATION.md หัวข้อ 9)
//      ① URL ที่จะยิงไป   ② รูปแบบข้อมูลที่เขารับ/ส่งกลับ
//    ตอนได้มาแล้ว แก้แค่ฟังก์ชันนี้ฟังก์ชันเดียว ส่วนอื่นของโปรเจกต์ไม่ต้องแตะ
//
// ⚠️ ห้ามใส่รหัส API (key) ลงในไฟล์นี้เด็ดขาด — เว็บเราเปิดให้ทุกคนกด View Source ดูได้
//    รหัสต้องอยู่ที่ server เท่านั้น (เหตุผลเต็มๆ ใน docs/INTEGRATION.md หัวข้อ 8)
function llmBrain({ endpoint, timeoutMs = 12000, name }) {
  const system = systemPrompt(name);
  return async function ask(text, history = []) {
    if (!endpoint) throw new Error('ยังไม่ได้ตั้งค่า endpoint ของ AI');
    // AbortController = "ถ้าเกินเวลานี้ให้ยกเลิก" กันกรณี server ไม่ตอบแล้วหุ่นค้างตลอดกาล
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        // ▼▼▼ ตรงนี้ต้องแก้ตามรูปแบบของรุ่นพี่ ▼▼▼
        body: JSON.stringify({
          messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: text }],
        }),
      });
      if (!res.ok) throw new Error(`AI ตอบกลับมาเป็น error ${res.status}`);
      const data = await res.json();
      // ▼▼▼ ดึงข้อความออกจากคำตอบ — รองรับ 3 รูปแบบที่เจอบ่อย ▼▼▼
      const content = data?.choices?.[0]?.message?.content   // แบบ OpenAI
        ?? data?.content?.[0]?.text                          // แบบ Claude
        ?? data?.reply ?? data?.text ?? data;                // แบบง่ายๆ ที่คนทำเอง
      return sanitize(content);
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---- ส่วนที่ 5: ตัวห่อ — เลือกโหมด + จำบทสนทนา ------------------------------------
export class Brain {
  // ตัวเลือก: { mode, name, endpoint, parseCommand, mockDelayMs, historyTurns }
  constructor(opts = {}) {
    this.mode = opts.mode || 'mock';
    this.name = opts.name || '小慈';
    this.endpoint = opts.endpoint || null;
    this.parseCommand = opts.parseCommand || null;  // ตัวสำรองเวลา AI ต่อไม่ได้
    this.historyTurns = opts.historyTurns ?? 6;  // จำย้อนหลังกี่ตา (มากไปเปลืองเงิน+ช้า)
    this.history = [];
    this.thinking = false;                        // voice.js ใช้ค่านี้โชว์ "กำลังคิด"
    this._impl = {
      mock: () => mockBrain(opts.mockDelayMs ?? 800),
      keywords: () => keywordBrain(opts.parseCommand, this.name),
      llm: () => llmBrain({ endpoint: this.endpoint, name: this.name }),
    }[this.mode];
    if (!this._impl) throw new Error(`ไม่รู้จักโหมดสมอง '${this.mode}'`);
    this.ask_ = this._impl();
  }

  get ready() { return this.mode !== 'llm' || Boolean(this.endpoint); }

  // ถามสมอง — คืน { say, do, mood } เสมอ ไม่เคย throw
  // (ถ้าพังจะคืนคำตอบสำรอง เพราะหุ่นเงียบหายไปเฉยๆ คนเล่นจะคิดว่าเว็บเสีย)
  async ask(text) {
    if (!text || !String(text).trim()) return { ...FALLBACK };
    this.thinking = true;
    try {
      const out = await this.ask_(String(text), this.history);
      this.remember(text, out);
      return out;
    } catch (err) {
      console.warn('[brain] สมองมีปัญหา:', err.message);
      // ต่อ AI ไม่ได้ (เน็ตล่ม/นอกโดเมนที่อนุญาต) → ถ้าเป็นคำสั่งพื้นฐานก็ยังทำให้ได้จากตารางคำ
      const kw = this.parseCommand?.(String(text));
      if (kw === 'hello') return sanitize({ say: `你好！我是${this.name}！`, do: [], mood: 'happy' });
      if (kw === 'who') return sanitize({ say: `我是${this.name}，一個會走路的機器人！`, do: [], mood: 'happy' });
      if (kw) return sanitize({ say: '好！', do: [kw], mood: 'happy' });
      const offline = err.name === 'AbortError' ? '我想太久了，再說一次好嗎？' : '我的腦袋有點怪怪的，等一下再試？';
      return { say: offline, do: [], mood: 'dizzy' };
    } finally {
      this.thinking = false;
    }
  }

  // เก็บบทสนทนาไว้เท่าที่กำหนด (เก่าสุดหลุดออกไป) เพื่อให้ AI คุยต่อเนื่องได้
  //
  // สำคัญ: ฝั่ง assistant ต้องเก็บเป็น "JSON เต็ม" {say,do,mood} ไม่ใช่แค่ข้อความที่พูด
  // เพราะ AI จะเลียนแบบรูปแบบคำตอบก่อนหน้าของตัวเอง ถ้าเก็บแค่ข้อความเปล่า
  // พอตาที่ 2 มันจะตอบเป็นข้อความเปล่า (ไม่ใช่ JSON) → sanitize หา do ไม่เจอ → หุ่นไม่ขยับ
  // (บั๊กนี้เจอจริง 2026-09-14: ตาแรกเดินได้ ตาต่อไปพูดได้แต่ไม่ทำท่า)
  remember(userText, out) {
    const reply = typeof out === 'string' ? out : JSON.stringify({ say: out.say, do: out.do, mood: out.mood });
    this.history.push({ role: 'user', content: String(userText) });
    this.history.push({ role: 'assistant', content: reply });
    const max = this.historyTurns * 2;
    if (this.history.length > max) this.history = this.history.slice(-max);
  }

  forget() { this.history = []; }
}
