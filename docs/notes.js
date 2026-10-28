// 筆記格式：每篇筆記是一個 Markdown 檔，開頭用 YAML front matter 存欄位
// 例如：
// ---
// type: youtube
// title: 影片標題
// tags: [理財, 心理學]
// ---
// 心得內文……

export const TYPES = {
  youtube: { label: 'YouTube', icon: '📺', dir: 'notes/youtube' },
  book: { label: '書', icon: '📚', dir: 'notes/books' },
  idea: { label: '靈感', icon: '💡', dir: 'notes/ideas' },
};

export const BOOK_STATUS = ['想讀', '在讀', '讀完'];

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

export function typeFromPath(path) {
  for (const [type, t] of Object.entries(TYPES)) {
    if (path.startsWith(t.dir + '/')) return type;
  }
  return 'idea';
}

export function normTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,，\s]+/);
  return [...new Set(list.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean))];
}

export function parseNote(path, text) {
  let meta = {};
  let body = text;
  const m = text.match(FRONT_MATTER);
  if (m) {
    try {
      const loaded = jsyaml.load(m[1], { schema: jsyaml.CORE_SCHEMA });
      if (loaded && typeof loaded === 'object') meta = loaded;
    } catch {
      meta = {};
    }
    body = m[2];
  }
  const type = TYPES[meta.type] ? meta.type : typeFromPath(path);
  return { path, type, meta, body: body.trim(), tags: normTags(meta.tags) };
}

function isEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

export function serializeNote(meta, body) {
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!isEmpty(v)) clean[k] = v;
  }
  const yaml = jsyaml.dump(clean, { schema: jsyaml.CORE_SCHEMA, lineWidth: -1 });
  return `---\n${yaml}---\n\n${(body || '').trim()}\n`;
}

export function noteTitle(note) {
  if (note.meta.title) return String(note.meta.title);
  const first = note.body.split('\n').find((l) => l.trim()) || '（沒有內容）';
  const plain = first.replace(/^[#>*\-\s]+/, '').trim();
  return plain.length > 40 ? plain.slice(0, 40) + '…' : plain;
}

export function snippet(note, len = 80) {
  const plain = note.body.replace(/[#>*_`\[\]()!-]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > len ? plain.slice(0, len) + '…' : plain;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function nowStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function today(d = new Date()) {
  return nowStamp(d).slice(0, 10);
}

export function makePath(type, title, d = new Date()) {
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const slug = String(title || '')
    .replace(/[\\/:*?"<>|#%&{}^~`'.,，。！？!?\[\]()（）「」『』、；;：～【】《》〈〉]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 30)
    .replace(/-+$/, '');
  return `${TYPES[type].dir}/${stamp}${slug ? '-' + slug : ''}.md`;
}

export function sortKey(note) {
  return String(note.meta.date || '') + note.path;
}

export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/,
  );
  return m ? m[1] : null;
}

// 「12:30 這段在講……」或「1:02:03 ……」→ { seconds, label, text }
export function parseTimestamps(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:：]?\s*(.*)$/);
      if (!m) return { seconds: null, label: '', text: line };
      const seconds = (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3];
      return { seconds, label: line.slice(0, line.length - m[4].length).trim().replace(/[-–—:：]$/, '').trim(), text: m[4] };
    });
}

// 書的金句：用空白行分隔
export function splitQuotes(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((q) => q.trim())
    .filter(Boolean);
}

export function searchText(note) {
  const m = note.meta;
  return [m.title, m.channel, m.author, note.body, note.tags.join(' '), (m.quotes || []).join(' '), m.timestamps]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}
