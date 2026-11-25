import { store, askPersistentStorage } from "./db.js";
import { prepareCutout, makeSticker } from "./cutout.js";
import { setupExport } from "./export.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SPARKLE = "M50 6C54 34 66 46 94 50C66 54 54 66 50 94C46 66 34 54 6 50C34 46 46 34 50 6Z";
const STAR8 = "M50.0 4.0 L54.2 39.8 L74.0 26.0 L60.2 45.8 L96.0 50.0 L60.2 54.2 L74.0 74.0 L54.2 60.2 L50.0 96.0 L45.8 60.2 L26.0 74.0 L39.8 54.2 L4.0 50.0 L39.8 45.8 L26.0 26.0 L45.8 39.8Z";
const SWAP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M8 21l-4-4 4-4M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H4"/></svg>`;
const svgOf = d => `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;

const LOVE_NOTES = [
  "a quiet little day","little by little","here and now","soft light, slow hours",
  "the ordinary is precious","growing quietly","just being here","breathe in, breathe out",
  "small things, kept close","a day like no other","nothing special, everything dear","time, gently passing",
  "warm and still","the days we keep"
];
const SKIP = ["to","the","for","you","us","so","are","a","of","at","your","our","is","be","being"];

const pad = n => String(n).padStart(2, "0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function hash(str){ let h = 2166136261; for (const c of str){ h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed){ let s = seed || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }

// day -> { photos: [{id, kind, url}], pickId }
const days = new Map();
const dayData = k => { if (!days.has(k)) days.set(k, { photos: [], pickId: null }); return days.get(k); };
const picked = d => d.photos.find(p => p.id === d.pickId) || d.photos[d.photos.length - 1];

const today = new Date(); today.setHours(23, 59, 59, 999);
let view = { y: today.getFullYear(), m: today.getMonth() };

const $ = id => document.getElementById(id);
const grid = $("grid");
const statusEl = $("status");
/** Circular progress: p = 0..1, "spin" for unknown progress, null to hide. */
function setRing(p) {
  const ring = $("ring");
  if (p === null) { ring.hidden = true; return; }
  ring.hidden = false;
  ring.classList.toggle("spin", p === "spin");
  $("ringFg").style.strokeDashoffset = p === "spin" ? "" : String(100 - Math.round(p * 100));
  $("ringPct").textContent = p === "spin" ? "" : `${Math.round(p * 100)}%`;
}

/* ---------- snackbar ---------- */
let snackTimer = null;
export function snack(text) {
  const el = $("snackbar"); el.textContent = text; el.classList.add("show");
  clearTimeout(snackTimer); snackTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ---------- load saved photos ---------- */
async function load() {
  try {
    const [photos, picks] = await Promise.all([store.allPhotos(), store.allPicks()]);
    photos.sort((a, b) => a.created - b.created);
    for (const p of photos) dayData(p.day).photos.push({ id: p.id, kind: p.kind, url: URL.createObjectURL(p.blob) });
    for (const pk of picks) if (days.has(pk.day)) days.get(pk.day).pickId = pk.id;
  } catch (e) {
    console.error(e);
    statusEl.textContent = "保存した写真を読み込めませんでした。プライベートブラウズでは写真を保存できません。";
  }
}

/* ---------- render ---------- */
function render() {
  const { y, m } = view;
  $("monthName").textContent = MONTHS[m];
  $("yearNum").textContent = y;
  $("monthNum").textContent = m + 1;
  $("navMonth").textContent = `${m + 1}月`;
  $("navYear").textContent = y;
  const first = new Date(y, m, 1), total = new Date(y, m + 1, 0).getDate();
  grid.innerHTML = "";
  for (let i = 0; i < first.getDay(); i++) grid.appendChild(Object.assign(document.createElement("div"), { className: "cell blank" }));
  for (let d = 1; d <= total; d++) {
    const date = new Date(y, m, d), k = keyOf(date), data = days.get(k);
    const future = date > today;
    const cell = document.createElement("div");
    cell.className = "cell" + (future ? " future" : "") + (keyOf(today) === k ? " today" : "");
    cell.innerHTML = `<span class="num">${d}</span>`;
    const r = rng(hash(k));
    const rot = (r() * 16 - 8).toFixed(1);
    if (data && data.photos.length) {
      const p = picked(data);
      const cut = document.createElement("div");
      cut.className = "cut" + (p.kind === "circle" ? " circle" : "");
      cut.style.transform = `rotate(${rot}deg)`; cut.style.setProperty("--r", rot + "deg");
      cut.style.setProperty("--m", `url("${p.url}")`);
      const img = new Image(); img.src = p.url; img.alt = "";
      cut.appendChild(img); cell.appendChild(cut);
      if (p.kind === "circle") {
        const cs = document.createElement("div"); cs.className = "cstars"; cs.setAttribute("aria-hidden", "true");
        const cr = rng(hash(k + "-cstar"));
        const shape = cr() < .5 ? SPARKLE : STAR8, pos = cr() < .5 || data.photos.length > 1 ? "tl" : "br"; // keep clear of the switch icon
        cs.innerHTML = `<span class="${pos}">${svgOf(shape)}</span>`; cell.appendChild(cs);
      }
      if (data.photos.length > 1) {
        // switch icon: shows this day has more photos; tapping the cell opens the picker
        const sw = document.createElement("span"); sw.className = "swap"; sw.setAttribute("aria-hidden", "true");
        sw.innerHTML = SWAP_ICON;
        cell.appendChild(sw);
      }
    } else {
      const mr = rng(hash(k + "-note"));
      if (mr() < .5) {
        const t = document.createElement("span"); t.className = "love";
        const words = LOVE_NOTES[Math.floor(mr() * LOVE_NOTES.length)].split(" ");
        const cand = words.map((w, i) => i).filter(i => !SKIP.includes(words[i].replace(/[^a-z]/g, "")));
        if (cand.length && mr() < .6) { const i = cand[Math.floor(mr() * cand.length)]; words[i] = `(${words[i].replace(/,$/, "")})` + (words[i].endsWith(",") ? "," : ""); }
        const msg = words.join(" ").replace(/[a-z]/, c => c.toUpperCase());
        if (mr() < .5) t.classList.add("it");
        t.textContent = msg; cell.appendChild(t);
      } else {
        const st = document.createElement("div"); st.className = "sticker";
        st.innerHTML = svgOf(r() < .5 ? SPARKLE : STAR8); cell.appendChild(st);
      }
    }
    if (!future) {
      cell.tabIndex = 0; cell.setAttribute("role", "button"); cell.dataset.k = k;
      cell.setAttribute("aria-label", `${m + 1}月${d}日を開く` + (data && data.photos.length > 1 ? `（写真${data.photos.length}枚から選べます）` : ""));
      cell.addEventListener("click", () => openDay(date));
      cell.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDay(date); } });
    }
    grid.appendChild(cell);
  }
  const trailing = (7 - (first.getDay() + total) % 7) % 7;
  for (let i = 0; i < trailing; i++) grid.appendChild(Object.assign(document.createElement("div"), { className: "cell blank" }));
}

/* ---------- day panel ---------- */
const overlay = $("overlay"), pConfirm = $("pConfirm");
let current = null, lastKey = null;
function openDay(date) {
  pConfirm.hidden = true;
  current = date; lastKey = keyOf(date);
  const data = dayData(lastKey);
  $("pDate").textContent = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  const box = $("pCands"); box.innerHTML = "";
  if (!data.photos.length) box.innerHTML = `<span class="empty-c">この日の写真はまだありません。</span>`;
  const sel = picked(data);
  data.photos.forEach((p, i) => {
    const b = document.createElement("button"); b.className = "cand";
    b.setAttribute("aria-pressed", String(sel && p.id === sel.id));
    b.setAttribute("aria-label", `候補${i + 1}を使う`);
    b.innerHTML = `<img src="${p.url}" alt="">`;
    b.addEventListener("click", async () => { data.pickId = p.id; render(); openDay(date); try { await store.setPick(lastKey, p.id); } catch (e) {} });
    box.appendChild(b);
  });
  $("pRemove").hidden = !data.photos.length;
  overlay.hidden = false; document.querySelector("main").inert = true;
  $("pClose").focus({ preventScroll: true });
}
function closeDay() {
  overlay.hidden = true; current = null; document.querySelector("main").inert = false;
  const c = document.querySelector(`.cell[data-k="${lastKey}"]`); if (c) c.focus({ preventScroll: true });
}
$("pClose").addEventListener("click", closeDay);
overlay.addEventListener("click", e => { if (e.target === overlay) closeDay(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeDay(); });
$("pRemove").addEventListener("click", () => { pConfirm.hidden = false; $("pRemoveNo").focus(); });
$("pRemoveNo").addEventListener("click", () => { pConfirm.hidden = true; $("pRemove").focus(); });
$("pRemoveYes").addEventListener("click", async () => {
  if (!current) return;
  const k = keyOf(current), d = dayData(k), p = picked(d);
  if (!p) return;
  try { await store.deletePhoto(p.id); } catch (e) { snack("写真を外せませんでした"); return; }
  URL.revokeObjectURL(p.url);
  d.photos = d.photos.filter(x => x.id !== p.id); d.pickId = null;
  pConfirm.hidden = true; render(); openDay(current); snack("写真を外しました");
});

/* ---------- add photos ---------- */
async function takenDate(file) {
  try {
    if (window.exifr) {
      const ex = await exifr.parse(file);
      const d = ex && (ex.DateTimeOriginal || ex.CreateDate);
      if (d instanceof Date && !isNaN(d)) return { date: d, fromExif: true };
    }
  } catch (e) {}
  return { date: new Date(file.lastModified || Date.now()), fromExif: false };
}

let busy = false;
$("addBtn").addEventListener("click", () => { if (!busy) $("files").click(); });
$("files").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = "";
  if (!files.length || busy) return;
  busy = true; const btn = $("addBtn"); btn.disabled = true;
  askPersistentStorage();
  let modelOk = true;
  try {
    setRing("spin");
    await prepareCutout(p => { setRing(p); statusEl.textContent = "切り抜き用のデータを読み込んでいます（初回のみ）"; });
  } catch (err) { console.warn(err); modelOk = false; }
  let ok = 0, noDate = 0, failed = 0, latest = null;
  for (let i = 0; i < files.length; i++) {
    setRing(i / files.length);
    statusEl.textContent = `写真を切り抜いています… ${i + 1} / ${files.length}`;
    try {
      const { date, fromExif } = await takenDate(files[i]);
      if (!fromExif) noDate++;
      const { kind, blob } = await makeSticker(files[i]);
      const day = keyOf(date);
      const id = await store.addPhoto({ day, kind, blob, created: Date.now() });
      const d = dayData(day);
      d.photos.push({ id, kind, url: URL.createObjectURL(blob) });
      d.pickId = id; store.setPick(day, id).catch(() => {});
      ok++; if (!latest || date > latest) latest = date;
    } catch (err) { console.warn(err); failed++; }
  }
  if (latest) view = { y: latest.getFullYear(), m: latest.getMonth() };
  render();
  const notes = [];
  if (noDate) notes.push(`${noDate}枚は撮影日が読み取れなかったので、ファイルの日付で置いています。`);
  if (failed) notes.push(`${failed}枚は読み込めませんでした（HEIC形式などは、このブラウザでは開けないことがあります）。`);
  if (!modelOk && ok) notes.push("切り抜き用のデータを読み込めなかったため、丸く切り抜いて貼りました。");
  setRing(null);
  statusEl.textContent = notes.join(" ");
  if (ok) snack(`${ok}枚を撮影日のマスに貼りました`);
  else if (failed) snack("写真を読み込めませんでした");
  busy = false; btn.disabled = false;
});

/* ---------- month navigation ---------- */
$("prev").addEventListener("click", () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } render(); });
$("next").addEventListener("click", () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } render(); });

/* ---------- start ---------- */
setupExport({ snack });
await load();
render();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
