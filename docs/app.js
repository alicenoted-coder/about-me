import {
  TYPES, BOOK_STATUS, parseNote, serializeNote, noteTitle, snippet, nowStamp, today, makePath,
  sortKey, youtubeId, parseTimestamps, splitQuotes, searchText, normTags,
} from './notes.js';
import {
  getConfig, saveConfig, isConfigured, testConnection, listNoteFiles, readBlob, putFile,
  deleteFile, githubFileUrl,
} from './github.js';

const CACHE_KEY = 'notes-app:cache';
const LAST_TYPE_KEY = 'notes-app:last-type';
const draftKey = (type) => `notes-app:draft:${type}`;

const view = document.getElementById('view');

// ---------- 小工具 ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// 換掉元素內容；陣列會攤平，null／false 會略過
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 無法使用 localStorage 時就不暫存
  }
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

let toastTimer;
function toast(message, { kind = 'info', href, label } = {}) {
  const el = document.getElementById('toast');
  fill(el, message, href ? h('a', { href }, label) : '');
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 6000 : 3500);
}

function setSync(text) {
  document.getElementById('sync').textContent = text;
}

function noteHref(path) {
  return `#/note/${encodeURIComponent(path)}`;
}

function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || ''));
}

function hideBroken(e) {
  e.target.style.display = 'none';
}

function stars(n) {
  n = Number(n) || 0;
  return n > 0 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
}

// ---------- 筆記資料（記在本機，背景和 GitHub 同步）----------

let notes = [];
let syncedOnce = false;
let syncing = null;

function readCache() {
  return load(CACHE_KEY, {});
}

function rebuildFromCache(cache = readCache()) {
  notes = Object.entries(cache)
    .map(([path, v]) => ({ ...parseNote(path, v.text), sha: v.sha }))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

function upsertLocal(path, sha, text) {
  const cache = readCache();
  cache[path] = { sha, text };
  store(CACHE_KEY, cache);
  rebuildFromCache(cache);
}

function removeLocal(path) {
  const cache = readCache();
  delete cache[path];
  store(CACHE_KEY, cache);
  rebuildFromCache(cache);
}

async function syncNotes({ force = false } = {}) {
  if (!isConfigured()) return notes;
  if (syncing) return syncing;
  if (syncedOnce && !force) return notes;
  syncing = (async () => {
    setSync('同步中…');
    try {
      const files = await listNoteFiles();
      const cache = readCache();
      const missing = files.filter((f) => !cache[f.path] || cache[f.path].sha !== f.sha);
      const fetched = {};
      let i = 0;
      const worker = async () => {
        while (i < missing.length) {
          const f = missing[i++];
          fetched[f.path] = await readBlob(f.sha);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, missing.length) }, worker));
      const next = {};
      for (const f of files) next[f.path] = { sha: f.sha, text: fetched[f.path] ?? cache[f.path].text };
      store(CACHE_KEY, next);
      rebuildFromCache(next);
      syncedOnce = true;
      setSync('');
    } catch (e) {
      setSync('⚠️ 未同步');
      toast(e.message, { kind: 'error' });
    } finally {
      syncing = null;
    }
    onNotesChanged();
    return notes;
  })();
  return syncing;
}

let refreshCurrent = null;
function onNotesChanged() {
  if (refreshCurrent) refreshCurrent();
}

// ---------- 路由 ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  const [name, ...rest] = p.split('/');
  return { name: name || 'new', arg: decodeURIComponent(rest.join('/')), query: new URLSearchParams(q) };
}

function route() {
  const { name, arg, query } = parseHash();
  refreshCurrent = null;
  const navName = { note: 'browse', edit: 'new' }[name] || name;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navName));
  const views = { new: viewNew, edit: viewEdit, browse: viewBrowse, note: viewNote, search: viewSearch, tags: viewTags, settings: viewSettings };
  (views[name] || viewNew)(arg, query);
  window.scrollTo(0, 0);
}

// ---------- ✏️ 輸入頁 ----------

function viewNew(arg) {
  const last = load(LAST_TYPE_KEY, 'youtube');
  renderForm({ type: TYPES[arg] ? arg : TYPES[last] ? last : 'youtube' });
}

function viewEdit(path) {
  const note = notes.find((n) => n.path === path);
  if (!note) {
    fill(view, h('p', { class: 'empty' }, '找不到這篇筆記。'));
    refreshCurrent = () => notes.some((n) => n.path === path) && viewEdit(path);
    return;
  }
  renderForm({ type: note.type, note });
}

function stateFromNote(note) {
  const m = note.meta;
  return {
    ...m,
    title: m.title || '',
    body: note.body,
    tags: note.tags.map((t) => '#' + t).join(' '),
    quotes: (m.quotes || []).join('\n\n'),
    rating: Number(m.rating) || 0,
  };
}

function defaultState() {
  return { watched: today(), status: '在讀', rating: 0 };
}

function metaFromState(type, s, existing = {}) {
  const meta = { ...existing, type, title: (s.title || '').trim(), date: existing.date || nowStamp(), tags: normTags(s.tags) };
  if (type === 'youtube') {
    Object.assign(meta, {
      url: (s.url || '').trim(), channel: (s.channel || '').trim(), watched: s.watched,
      rating: s.rating || undefined, timestamps: (s.timestamps || '').trim(),
    });
  } else if (type === 'book') {
    Object.assign(meta, {
      author: (s.author || '').trim(), status: s.status, cover: (s.cover || '').trim(),
      rating: s.rating || undefined, started: s.started, finished: s.finished, quotes: splitQuotes(s.quotes),
    });
  } else {
    Object.assign(meta, { source: s.source || undefined });
  }
  return meta;
}

function validate(type, s) {
  if (type === 'youtube') {
    if (!youtubeId(s.url)) return '請貼上正確的 YouTube 影片網址。';
    if (!(s.body || '').trim()) return '請寫一點心得。';
  } else if (type === 'book') {
    if (!(s.title || '').trim()) return '請填書名。';
  } else if (!(s.body || '').trim()) {
    return '靈感內容不能空白。';
  }
  return null;
}

function renderForm({ type, note }) {
  const editing = Boolean(note);
  if (!editing) store(LAST_TYPE_KEY, type);
  const s = editing ? stateFromNote(note) : { ...defaultState(), ...load(draftKey(type), {}) };
  const saveDraft = () => !editing && store(draftKey(type), s);

  const bind = (key, attrs = {}) => {
    const tag = attrs.rows ? 'textarea' : 'input';
    return h(tag, {
      ...attrs,
      name: key,
      value: s[key] ?? '',
      oninput: (e) => {
        s[key] = e.target.value;
        saveDraft();
        attrs.after && attrs.after(e);
      },
    });
  };
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('small', { class: 'hint' }, hint) : null);

  const rating = () => {
    const wrap = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': '評分' });
    const paint = () => [...wrap.children].forEach((b, i) => b.classList.toggle('on', i < s.rating));
    for (let i = 1; i <= 5; i++) {
      wrap.append(h('button', {
        type: 'button', 'aria-label': `${i} 顆星`,
        onclick: () => { s.rating = s.rating === i ? 0 : i; paint(); saveDraft(); },
      }, '★'));
    }
    paint();
    return h('div', { class: 'field' }, h('span', { class: 'label' }, '評分'), wrap);
  };

  const tagsField = () => {
    const list = h('datalist', { id: 'tag-suggest' }, allTags().map(([t]) => h('option', { value: '#' + t })));
    return field('標籤', [bind('tags', { placeholder: '#理財 #心理學', list: 'tag-suggest', autocomplete: 'off' }), list], '用空白或逗號分開');
  };

  const fields = [];
  const more = [];

  if (type === 'youtube') {
    const preview = h('div', { class: 'yt-preview' });
    const showPreview = () => {
      const id = youtubeId(s.url);
      fill(preview, id ? h('img', { src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, alt: '' }) : '');
    };
    let lookupTimer;
    const titleInput = bind('title', { placeholder: '貼網址後會自動帶入' });
    const channelInput = bind('channel', { placeholder: '貼網址後會自動帶入' });
    const urlInput = bind('url', {
      type: 'url', inputmode: 'url', placeholder: 'https://youtu.be/…', autocomplete: 'off',
      after: () => {
        showPreview();
        clearTimeout(lookupTimer);
        lookupTimer = setTimeout(async () => {
          const info = await lookupYouTube(s.url);
          if (!info) return;
          if (!s.title) { s.title = titleInput.value = info.title || ''; }
          if (!s.channel) { s.channel = channelInput.value = info.author_name || ''; }
          saveDraft();
        }, 400);
      },
    });
    showPreview();
    fields.push(
      field('影片連結 *', urlInput), preview,
      field('影片標題', titleInput),
      field('頻道', channelInput),
      field('心得 *', bind('body', { rows: 7, placeholder: '看完想到什麼就寫……' })),
      tagsField(),
    );
    more.push(
      field('時間戳筆記', bind('timestamps', { rows: 4, placeholder: '12:30 這段在講……\n1:05:10 這裡很重要' }), '一行一則，開頭寫時間，之後點時間就會從那裡開始播'),
      rating(),
      field('觀看日期', bind('watched', { type: 'date' })),
    );
  } else if (type === 'book') {
    const authorInput = bind('author', { placeholder: '作者' });
    const coverInput = bind('cover', { type: 'url', placeholder: '書封圖片網址（可以用下面的「查書」自動帶入）' });
    const results = h('div', { class: 'book-results' });
    const lookupBtn = h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        if (!(s.title || '').trim()) return toast('先輸入書名再查。');
        fill(results, h('small', { class: 'hint' }, '查詢中…'));
        const books = await lookupBooks(s.title, s.author);
        if (!books.length) return fill(results, h('small', { class: 'hint' }, '查不到，可以自己填。'));
        fill(results, ...books.map((b) => h('button', {
          type: 'button', class: 'book-pick',
          onclick: () => {
            if (b.authors && !s.author) s.author = authorInput.value = b.authors;
            if (b.cover) s.cover = coverInput.value = b.cover;
            saveDraft();
            fill(results, h('small', { class: 'hint' }, '已帶入 ✅'));
          },
        }, b.cover ? h('img', { src: b.cover, alt: '' }) : h('span', { class: 'no-cover' }, '📚'), h('span', null, h('b', null, b.title), h('br'), b.authors || ''))));
      },
    }, '🔍 查書（自動帶入作者、書封）');
    const status = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': '閱讀狀態' });
    const paintStatus = () => [...status.children].forEach((b) => b.classList.toggle('on', b.dataset.v === s.status));
    BOOK_STATUS.forEach((v) => status.append(h('button', { type: 'button', 'data-v': v, onclick: () => { s.status = v; paintStatus(); saveDraft(); } }, v)));
    paintStatus();
    fields.push(
      field('書名 *', bind('title', { placeholder: '書名' })),
      field('作者', authorInput),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '閱讀狀態'), status),
      field('心得', bind('body', { rows: 7, placeholder: '這本書讓我想到……' })),
      tagsField(),
    );
    more.push(
      h('div', { class: 'field' }, lookupBtn, results),
      field('書封', coverInput),
      rating(),
      field('金句摘錄', bind('quotes', { rows: 5, placeholder: '一段金句……（p.42）\n\n另一段金句……' }), '每段金句之間空一行'),
      h('div', { class: 'row2' }, field('開始讀', bind('started', { type: 'date' })), field('讀完', bind('finished', { type: 'date' }))),
    );
  } else {
    const sourceSelect = h('select', { name: 'source', onchange: (e) => { s.source = e.target.value; saveDraft(); } });
    const fillSources = () => {
      const opts = [h('option', { value: '' }, '（沒有，純粹自己想到的）')];
      for (const t of ['youtube', 'book']) {
        const group = h('optgroup', { label: `${TYPES[t].icon} ${TYPES[t].label}` });
        notes.filter((n) => n.type === t).forEach((n) => group.append(h('option', { value: n.path, selected: n.path === s.source }, noteTitle(n))));
        if (group.children.length) opts.push(group);
      }
      if (s.source && !notes.some((n) => n.path === s.source)) opts.push(h('option', { value: s.source, selected: true }, s.source));
      fill(sourceSelect, ...opts);
    };
    fillSources();
    refreshCurrent = fillSources;
    fields.push(
      field('靈感 *', bind('body', { rows: 6, placeholder: '突然想到……', autofocus: !editing })),
      tagsField(),
    );
    more.push(
      field('標題', bind('title', { placeholder: '不填就用內容開頭當標題' })),
      field('靈感來源', sourceSelect, '來自哪支影片或哪本書？那篇心得底下也會出現這則靈感'),
    );
  }

  const hasMore = editing && more.length;
  const saveBtn = h('button', { type: 'submit', class: 'btn primary save' }, editing ? '💾 儲存修改' : '💾 儲存');

  const form = h('form', {
    class: `note-form type-${type}`,
    onsubmit: async (e) => {
      e.preventDefault();
      const formEl = e.currentTarget;
      const err = validate(type, s);
      if (err) return toast(err, { kind: 'error' });
      if (!isConfigured()) {
        toast('還沒連接 GitHub，內容已暫存在這台裝置。', { kind: 'error', href: '#/settings', label: '去設定' });
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '儲存中…';
      const meta = metaFromState(type, s, editing ? note.meta : {});
      const text = serializeNote(meta, s.body);
      const path = editing ? note.path : makePath(type, meta.title || s.body);
      const title = noteTitle(parseNote(path, text));
      try {
        const sha = await putFile(path, text, editing ? note.sha : undefined, `${editing ? '更新' : '新增'}${TYPES[type].label}：${title}`);
        upsertLocal(path, sha, text);
        // 儲存期間如果已經切到別頁，就不要把畫面拉回來
        const stillHere = formEl.isConnected;
        if (editing) {
          toast('已儲存修改 ✅');
          if (stillHere) location.hash = noteHref(path);
        } else {
          store(draftKey(type), undefined);
          if (stillHere) renderForm({ type });
          toast('已儲存 ✅ ', { href: noteHref(path), label: '看剛剛那篇' });
        }
        onNotesChanged();
      } catch (e2) {
        if (e2.status === 409 && editing) {
          // 別台裝置改過這篇：抓最新版本號，畫面上剛寫的內容保留，讓使用者確認後再存一次
          await syncNotes({ force: true });
          const latest = notes.find((n) => n.path === note.path);
          if (latest) note.sha = latest.sha;
          toast('這篇剛在別的裝置被改過。你寫的內容還在畫面上，確認沒問題再按一次儲存就會蓋過去。', { kind: 'error' });
        } else {
          toast(e2.message, { kind: 'error' });
        }
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? '💾 儲存修改' : '💾 儲存';
      }
    },
  },
  fields,
  more.length ? h('details', { class: 'more', open: hasMore }, h('summary', null, '更多（選填）'), more) : null,
  saveBtn,
  !editing && hasDraftContent(s) ? h('button', {
    type: 'button', class: 'btn ghost',
    onclick: () => { if (confirm('確定清空這張表單？')) { store(draftKey(type), undefined); renderForm({ type }); } },
  }, '清空重寫') : null,
  editing ? h('a', { class: 'btn ghost', href: noteHref(note.path) }, '取消') : null,
  );

  const tabs = editing
    ? h('h2', { class: 'edit-title' }, `編輯${TYPES[type].icon} ${TYPES[type].label}`)
    : h('div', { class: 'type-tabs', role: 'tablist' }, Object.entries(TYPES).map(([t, info]) =>
      h('a', { href: `#/new/${t}`, role: 'tab', class: `tab-${t}${t === type ? ' on' : ''}`, 'aria-selected': t === type ? 'true' : 'false' }, `${info.icon} ${info.label}`)));

  const banner = isConfigured() ? null : h('p', { class: 'banner' }, '還沒連接 GitHub：可以先寫，內容會暫存在這台裝置。', h('a', { href: '#/settings' }, '去設定 →'));

  fill(view, tabs, banner, form);
  const focus = form.querySelector('[autofocus]');
  if (focus) focus.focus();
}

function hasDraftContent(s) {
  return ['url', 'title', 'body', 'tags', 'author', 'quotes', 'timestamps', 'cover'].some((k) => (s[k] || '').trim && (s[k] || '').trim());
}

async function lookupYouTube(url) {
  if (!youtubeId(url)) return null;
  const sources = [
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
  ];
  for (const src of sources) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.title) return data;
    } catch {
      // 換下一個來源
    }
  }
  return null;
}

async function lookupBooks(title, author) {
  const q = `intitle:${title}${author ? ` inauthor:${author}` : ''}`;
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((it) => {
      const v = it.volumeInfo || {};
      const img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
      return { title: v.title || '', authors: (v.authors || []).join('、'), cover: img ? img.replace(/^http:/, 'https:') : '' };
    });
  } catch {
    return [];
  }
}

// ---------- 📋 瀏覽 ----------

function card(note) {
  const t = TYPES[note.type];
  const m = note.meta;
  let thumb = null;
  if (note.type === 'youtube' && youtubeId(m.url)) thumb = h('img', { class: 'thumb', src: `https://i.ytimg.com/vi/${youtubeId(m.url)}/mqdefault.jpg`, alt: '', loading: 'lazy', onerror: hideBroken });
  if (note.type === 'book' && m.cover) thumb = h('img', { class: 'thumb cover', src: m.cover, alt: '', loading: 'lazy', onerror: hideBroken });
  const sub = [
    note.type === 'youtube' && m.channel,
    note.type === 'book' && m.author,
    note.type === 'book' && m.status && h('span', { class: `badge status-${m.status}` }, m.status),
    stars(m.rating) && h('span', { class: 'rating' }, stars(m.rating)),
  ].filter(Boolean);
  return h('a', { class: `card type-${note.type}`, href: noteHref(note.path) },
    thumb,
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, h('span', { class: 'icon' }, t.icon), noteTitle(note)),
      sub.length ? h('div', { class: 'card-sub' }, sub) : null,
      (note.type === 'idea' ? note.meta.title : !thumb) ? h('p', { class: 'card-snippet' }, snippet(note)) : null,
      h('div', { class: 'card-meta' }, h('span', null, String(m.date || '').slice(0, 10)), note.tags.map((tg) => h('span', { class: 'tag' }, '#' + tg))),
    ));
}

function emptyState() {
  return h('div', { class: 'empty' },
    h('p', null, notes.length ? '沒有符合的筆記。' : '還沒有任何筆記。'),
    notes.length ? null : h('a', { class: 'btn primary', href: '#/new' }, '✏️ 寫第一篇'));
}

function viewBrowse(_arg, query) {
  const type = query.get('type') || '';
  const tag = query.get('tag') || '';
  const status = query.get('status') || '';
  const link = (params) => {
    const q = new URLSearchParams({ type, tag, status, ...params });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    const qs = q.toString();
    return `#/browse${qs ? '?' + qs : ''}`;
  };
  const render = () => {
    const list = notes.filter((n) => (!type || n.type === type) && (!tag || n.tags.includes(tag)) && (!status || n.meta.status === status));
    fill(view, 
      h('div', { class: 'chips' },
        h('a', { href: link({ type: '', status: '' }), class: !type ? 'on' : '' }, `全部 ${notes.length}`),
        Object.entries(TYPES).map(([t, info]) => h('a', { href: link({ type: t, status: '' }), class: `chip-${t}${type === t ? ' on' : ''}` }, `${info.icon} ${info.label} ${notes.filter((n) => n.type === t).length}`))),
      type === 'book' ? h('div', { class: 'chips sub' },
        h('a', { href: link({ status: '' }), class: !status ? 'on' : '' }, '全部狀態'),
        BOOK_STATUS.map((st) => h('a', { href: link({ status: st }), class: status === st ? 'on' : '' }, st))) : null,
      tag ? h('p', { class: 'filter' }, '標籤：', h('span', { class: 'tag' }, '#' + tag), h('a', { href: link({ tag: '' }) }, '✕ 取消')) : null,
      list.length ? h('div', { class: 'cards' }, list.map(card)) : emptyState(),
    );
  };
  render();
  refreshCurrent = render;
}

// ---------- 單篇筆記 ----------

function viewNote(path) {
  const render = () => {
    const note = notes.find((n) => n.path === path);
    if (!note) {
      fill(view, h('p', { class: 'empty' }, syncing ? '載入中…' : '找不到這篇筆記。'));
      return;
    }
    const m = note.meta;
    const t = TYPES[note.type];
    const parts = [];

    if (note.type === 'youtube') {
      const id = youtubeId(m.url);
      const iframe = id ? h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${id}`, title: noteTitle(note),
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: true,
      }) : null;
      if (iframe) parts.push(h('div', { class: 'video' }, iframe));
      parts.push(h('p', { class: 'sub' }, [m.channel, m.watched && `看於 ${m.watched}`].filter(Boolean).join('・'), m.url ? h('a', { href: m.url, target: '_blank', rel: 'noopener' }, ' ↗ 在 YouTube 開啟') : null));
      const ts = parseTimestamps(m.timestamps);
      if (ts.length) {
        parts.push(h('h3', null, '⏱ 時間戳筆記'), h('ul', { class: 'timestamps' }, ts.map((x) => h('li', null,
          x.seconds !== null && iframe ? h('button', {
            type: 'button', class: 'ts',
            onclick: () => { iframe.src = `https://www.youtube-nocookie.com/embed/${id}?start=${x.seconds}&autoplay=1`; iframe.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
          }, x.label) : (x.label ? h('b', null, x.label + ' ') : null),
          ' ', x.text))));
      }
    } else if (note.type === 'book') {
      parts.push(h('div', { class: 'book-head' },
        m.cover ? h('img', { class: 'cover', src: m.cover, alt: '', onerror: hideBroken }) : null,
        h('div', null,
          m.author ? h('p', null, '作者：', m.author) : null,
          m.status ? h('p', null, h('span', { class: `badge status-${m.status}` }, m.status)) : null,
          m.started || m.finished ? h('p', { class: 'sub' }, [m.started && `開始 ${m.started}`, m.finished && `讀完 ${m.finished}`].filter(Boolean).join('・')) : null)));
      const quotes = m.quotes || [];
      if (quotes.length) parts.push(h('h3', null, '✍️ 金句摘錄'), quotes.map((q) => h('blockquote', null, q)));
    } else if (m.source) {
      const src = notes.find((n) => n.path === m.source);
      parts.push(h('p', { class: 'source' }, '靈感來源：', src ? h('a', { href: noteHref(src.path) }, `${TYPES[src.type].icon} ${noteTitle(src)}`) : m.source));
    }

    if (stars(m.rating)) parts.push(h('p', { class: 'rating big' }, stars(m.rating)));
    if (note.body) parts.push(h('div', { class: 'markdown', html: renderMarkdown(note.body) }));

    const sparks = notes.filter((n) => n.type === 'idea' && n.meta.source === note.path);
    if (sparks.length) parts.push(h('h3', null, '💡 由此產生的靈感'), h('div', { class: 'cards' }, sparks.map(card)));

    fill(view, h('article', { class: `note type-${note.type}` },
      h('p', { class: 'kind' }, `${t.icon} ${t.label}`),
      h('h1', null, noteTitle(note)),
      h('div', { class: 'card-meta' }, h('span', null, String(m.date || '')), note.tags.map((tg) => h('a', { class: 'tag', href: `#/browse?tag=${encodeURIComponent(tg)}` }, '#' + tg))),
      parts,
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: `#/edit/${encodeURIComponent(note.path)}` }, '✏️ 編輯'),
        h('button', {
          type: 'button', class: 'btn danger',
          onclick: async (e) => {
            if (!confirm(`確定刪除「${noteTitle(note)}」？`)) return;
            e.target.disabled = true;
            try {
              await deleteFile(note.path, note.sha, `刪除${t.label}：${noteTitle(note)}`);
              removeLocal(note.path);
              toast('已刪除');
              location.hash = '#/browse';
            } catch (err) {
              toast(err.message, { kind: 'error' });
              e.target.disabled = false;
            }
          },
        }, '🗑 刪除'),
        h('a', { class: 'btn ghost', href: githubFileUrl(note.path), target: '_blank', rel: 'noopener' }, '在 GitHub 看原始檔'))));
  };
  render();
  refreshCurrent = render;
}

// ---------- 🔍 搜尋 ----------

let lastQuery = '';
function viewSearch() {
  const results = h('div', { class: 'cards' });
  const run = () => {
    const words = lastQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return fill(results, h('p', { class: 'hint' }, `輸入關鍵字，搜尋全部 ${notes.length} 篇筆記的標題、內容、標籤、金句。`));
    const list = notes.filter((n) => { const text = searchText(n); return words.every((w) => text.includes(w)); });
    fill(results, h('p', { class: 'hint' }, `找到 ${list.length} 篇`), list.map(card));
  };
  const input = h('input', { type: 'search', class: 'search', placeholder: '搜尋…', value: lastQuery, autofocus: true, oninput: (e) => { lastQuery = e.target.value; run(); } });
  fill(view, input, results);
  run();
  input.focus();
  refreshCurrent = run;
}

// ---------- 🏷 標籤 ----------

function allTags() {
  const count = new Map();
  for (const n of notes) for (const t of n.tags) count.set(t, (count.get(t) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
}

function viewTags() {
  const render = () => {
    const tags = allTags();
    fill(view, 
      h('h2', null, `🏷 標籤（${tags.length}）`),
      tags.length
        ? h('div', { class: 'tag-cloud' }, tags.map(([t, c]) => h('a', { class: 'tag', href: `#/browse?tag=${encodeURIComponent(t)}` }, `#${t}`, h('span', { class: 'count' }, c))))
        : h('p', { class: 'empty' }, '還沒有標籤。寫筆記時在「標籤」欄填 #理財 這類關鍵字就會出現在這裡。'));
  };
  render();
  refreshCurrent = render;
}

// ---------- ⚙️ 設定 ----------

function viewSettings() {
  const cfg = getConfig();
  const input = (key, attrs) => h('input', { ...attrs, name: key, value: cfg[key] || '', oninput: (e) => (cfg[key] = e.target.value.trim()) });
  const status = h('p', { class: 'hint' }, isConfigured() ? '✅ 已設定' : '尚未設定');
  fill(view, 
    h('h2', null, '⚙️ 設定'),
    h('form', {
      class: 'settings',
      onsubmit: async (e) => {
        e.preventDefault();
        saveConfig(cfg);
        status.textContent = '測試連線中…';
        try {
          await testConnection(cfg);
          status.textContent = '✅ 連線成功，可以開始寫了！';
          toast('連線成功 ✅', { href: '#/new', label: '去寫筆記' });
          syncNotes({ force: true });
        } catch (err) {
          status.textContent = '❌ ' + err.message;
        }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'GitHub 金鑰（Token）'), input('token', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' })),
    h('details', { class: 'more' }, h('summary', null, '進階：repo 和分支'),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'GitHub 帳號'), input('owner', {})),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Repo 名稱'), input('repo', {})),
      h('label', { class: 'field' }, h('span', { class: 'label' }, '分支'), input('branch', {}))),
    h('button', { type: 'submit', class: 'btn primary' }, '儲存並測試連線'),
    status),
    h('div', { class: 'help' },
      h('h3', null, '怎麼拿到 GitHub 金鑰？'),
      h('ol', null,
        h('li', null, '打開 ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'GitHub 建立金鑰頁面'), '（Fine-grained token）'),
        h('li', null, 'Token name 隨便取，例如「心得筆記」；Expiration 選你要的期限'),
        h('li', null, 'Repository access 選「Only select repositories」，只勾 ', h('b', null, cfg.repo || 'about-me')),
        h('li', null, 'Permissions → Repository permissions → ', h('b', null, 'Contents'), ' 改成 ', h('b', null, 'Read and write')),
        h('li', null, '按 Generate token，把 github_pat_ 開頭的那串貼到上面')),
      h('p', { class: 'hint' }, '金鑰只會存在這台裝置的瀏覽器裡。每台手機、電腦都要貼一次。不要把金鑰給別人。')),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => syncNotes({ force: true }) }, '🔄 重新同步'),
      h('button', {
        type: 'button', class: 'btn ghost',
        onclick: () => { if (confirm('清除這台裝置上的筆記快取？（GitHub 上的筆記不會被刪）')) { store(CACHE_KEY, undefined); rebuildFromCache({}); syncNotes({ force: true }); toast('已清除快取'); } },
      }, '清除本機快取')),
  );
}

// ---------- 啟動 ----------

rebuildFromCache();
window.addEventListener('hashchange', route);
route();
syncNotes();

window.addEventListener('focus', () => {
  if (syncedOnce && !syncing) syncNotes({ force: true });
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
