// Draws the current month as an A3 portrait PNG (1754 x 2480 px, 150dpi)
// and hands it to the share sheet (phones) or downloads it (computers).
const OUT_W = 1754, OUT_H = 2480;

function cssFont(el, k) { const cs = getComputedStyle(el); return `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * k}px ${cs.fontFamily}`; }
function letterSpacing(el, k) { const v = getComputedStyle(el).letterSpacing; return v === "normal" ? "0px" : (parseFloat(v) * k) + "px"; }
function noise(size, alpha) {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d");
  const im = g.createImageData(size, size);
  for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = alpha; }
  g.putImageData(im, 0, 0); return c;
}
function silhouette(img, w, h, color) {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-in"; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return c;
}
function fit(iw, ih, bw, bh, mode) { const s = mode === "contain" ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih); const w = iw * s, h = ih * s; return { x: (bw - w) / 2, y: (bh - h) / 2, w, h }; }
function wrap(ctx, text, maxW) {
  const out = []; let cur = "";
  for (const w of text.split(" ")) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}

async function renderSheet(sheet) {
  await document.fonts.ready;
  const base = sheet.getBoundingClientRect();
  const rel = el => { const b = el.getBoundingClientRect(); return { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height }; };
  const k = OUT_W / base.width;
  const c = document.createElement("canvas"); c.width = OUT_W; c.height = OUT_H;
  const ctx = c.getContext("2d");
  const ink = "#232322", inkSoft = "#6b6b68";
  const text = (el, color) => {
    const r = rel(el), t = el.textContent.trim(); if (!t) return;
    ctx.save(); ctx.font = cssFont(el, k); try { ctx.letterSpacing = letterSpacing(el, k); } catch (e) {}
    ctx.fillStyle = color; ctx.textBaseline = "middle";
    if (getComputedStyle(el).textAlign === "center") { ctx.textAlign = "center"; ctx.fillText(t, (r.x + r.w / 2) * k, (r.y + r.h / 2) * k); }
    else { ctx.textAlign = "left"; ctx.fillText(t, r.x * k, (r.y + r.h / 2) * k); }
    ctx.restore();
  };
  const path = (svg, color) => {
    const p = svg.querySelector("path"); if (!p) return; const r = rel(svg);
    ctx.save(); ctx.translate(r.x * k, r.y * k); ctx.scale(r.w * k / 100, r.h * k / 100);
    ctx.fillStyle = color; ctx.fill(new Path2D(p.getAttribute("d"))); ctx.restore();
  };

  // paper
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.save(); ctx.globalAlpha = .05; ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = ctx.createPattern(noise(256, 255), "repeat"); ctx.fillRect(0, 0, OUT_W, OUT_H); ctx.restore();

  // header
  ["yearNum", "monthName", "monthNum"].forEach(id => text(document.getElementById(id), ink));

  // grid
  const cells = [...sheet.querySelectorAll(".grid .cell")];
  for (const cell of cells) if (cell.classList.contains("blank")) { const r = rel(cell); ctx.fillStyle = "rgba(0,0,0,.025)"; ctx.fillRect(r.x * k, r.y * k, r.w * k, r.h * k); }
  ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.5, .5 * k);
  for (const cell of cells) { const r = rel(cell); ctx.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k); }
  ctx.restore();

  // numbers, notes, stars (under the photos)
  for (const cell of cells) {
    const num = cell.querySelector(".num");
    if (num) { ctx.save(); ctx.globalAlpha = cell.classList.contains("future") ? .45 : 1; text(num, ink); ctx.restore(); }
    const love = cell.querySelector(".love");
    if (love) {
      const r = rel(love); ctx.save(); ctx.font = cssFont(love, k); try { ctx.letterSpacing = letterSpacing(love, k); } catch (e) {}
      ctx.fillStyle = inkSoft; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const lh = parseFloat(getComputedStyle(love).fontSize) * k * 1.2;
      const lines = wrap(ctx, love.textContent, r.w * k);
      const top = (r.y + r.h / 2) * k - lh * (lines.length - 1) / 2;
      lines.forEach((t, i) => ctx.fillText(t, (r.x + r.w / 2) * k, top + i * lh)); ctx.restore();
    }
    cell.querySelectorAll(".sticker svg").forEach(s => path(s, ink));
  }

  // photos
  const grain = noise(160, 255);
  for (const cell of cells) {
    const cut = cell.querySelector(".cut"); if (!cut) continue;
    const img = cut.querySelector("img"); if (!img || !img.naturalWidth) continue;
    const cr = rel(cell);
    const W = cut.offsetWidth * k, H = cut.offsetHeight * k;
    const cx = (cr.x + cut.offsetLeft + cut.offsetWidth / 2) * k, cy = (cr.y + cut.offsetTop + cut.offsetHeight / 2) * k;
    const m = /rotate\(([-\d.]+)deg\)/.exec(cut.style.transform || ""); const rot = m ? parseFloat(m[1]) : 0;
    const ring = 1.6 * k;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot * Math.PI / 180); ctx.translate(-W / 2, -H / 2);
    if (!cut.classList.contains("circle")) {
      const f = fit(img.naturalWidth, img.naturalHeight, W, H, "contain");
      const sh = silhouette(img, f.w, f.h, "rgba(58,64,48,.12)"), wh = silhouette(img, f.w, f.h, "#ffffff");
      ctx.drawImage(sh, f.x + .5 * k, f.y + .7 * k, f.w, f.h);
      for (let a = 0; a < 16; a++) { const t = a / 16 * Math.PI * 2; ctx.drawImage(wh, f.x + Math.cos(t) * ring, f.y + Math.sin(t) * ring, f.w, f.h); }
      const pc = document.createElement("canvas"); pc.width = Math.round(f.w); pc.height = Math.round(f.h); const g = pc.getContext("2d");
      g.filter = "brightness(1.13) contrast(1.03) saturate(1.04)"; g.drawImage(img, 0, 0, pc.width, pc.height); g.filter = "none";
      g.globalCompositeOperation = "source-atop"; g.globalAlpha = .1; g.fillStyle = g.createPattern(grain, "repeat"); g.fillRect(0, 0, pc.width, pc.height);
      ctx.drawImage(pc, f.x, f.y, f.w, f.h);
    } else {
      const circle = new Path2D(); circle.arc(W / 2, H / 2, Math.min(W, H) / 2, 0, Math.PI * 2);
      ctx.save(); ctx.translate(.5 * k, .7 * k); ctx.fillStyle = "rgba(58,64,48,.12)"; ctx.fill(circle); ctx.restore();
      ctx.lineWidth = ring * 2; ctx.strokeStyle = "#ffffff"; ctx.stroke(circle);
      ctx.save(); ctx.clip(circle); const f = fit(img.naturalWidth, img.naturalHeight, W, H, "cover");
      ctx.filter = "brightness(1.13) contrast(1.03) saturate(1.04)"; ctx.drawImage(img, f.x, f.y, f.w, f.h); ctx.filter = "none";
      ctx.globalAlpha = .1; ctx.fillStyle = ctx.createPattern(grain, "repeat"); ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    ctx.restore();
    cell.querySelectorAll(".cstars svg").forEach(s => path(s, ink));
  }
  return new Promise(res => c.toBlob(res, "image/png"));
}

export function setupExport({ snack }) {
  const btn = document.getElementById("saveImg");
  const prev = document.getElementById("imgPreview");
  const close = prev.querySelector(".p-close");
  close.addEventListener("click", () => { prev.hidden = true; document.querySelector("main").inert = false; btn.focus(); });
  prev.addEventListener("click", e => { if (e.target === prev) close.click(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !prev.hidden) close.click(); });

  btn.addEventListener("click", async () => {
    const lbl = btn.querySelector(".lbl"); btn.disabled = true; const label = lbl.textContent; lbl.textContent = "画像を作っています…";
    try {
      const blob = await renderSheet(document.querySelector(".sheet"));
      const name = `MY365-${document.getElementById("yearNum").textContent}-${document.getElementById("monthName").textContent}.png`;
      const file = new File([blob], name, { type: "image/png" });
      const isTouch = matchMedia("(pointer:coarse)").matches;
      if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "MY 365 DIARY" }); snack("画像を書き出しました"); }
        catch (err) { if (err && err.name !== "AbortError") showPreview(blob); }
      } else if (!isTouch) {
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        snack("画像を保存しました");
      } else showPreview(blob);
    } catch (e) {
      console.error(e); snack("画像を作れませんでした。もう一度お試しください");
    } finally { btn.disabled = false; lbl.textContent = label; }
  });

  function showPreview(blob) {
    prev.querySelector("img").src = URL.createObjectURL(blob);
    prev.hidden = false; document.querySelector("main").inert = true; close.focus();
  }
}
