// Turns a photo into a sticker:
//  - "body":   the main subject cut out along its outline (transparent PNG)
//  - "circle": a round crop, used when the subject runs off the edge of the photo
//              or when the cut-out can't be made
// The cut-out runs entirely in the browser; the photo never leaves the device.
// Cut-out library: @imgly/background-removal (AGPL-3.0), bundled in vendor/.

const INPUT_MAX = 1024;   // longest side fed to the model
const BODY_MAX = 640;     // longest side of the saved cut-out
const CIRCLE_SIZE = 480;  // side of the saved round crop

let libPromise = null;
function lib() {
  if (!libPromise) libPromise = import("./vendor/background-removal.js");
  return libPromise;
}
function config(progress) {
  const c = { model: "isnet_quint8", output: { format: "image/png" } };
  if (window.MY365_MODEL_PATH) c.publicPath = window.MY365_MODEL_PATH; // for local testing only
  if (progress) c.progress = progress;
  return c;
}

let ready = false;
/** Downloads the cut-out model once (about 45MB). Reports progress 0..1. */
export async function prepareCutout(onProgress) {
  if (ready) return;
  const l = await lib();
  await l.preload(config((key, cur, total) => {
    if (onProgress && key.includes("models") && total) onProgress(cur / total);
  }));
  ready = true;
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
function toBlob(canvas, type, q) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("encode failed")), type, q));
}

async function decode(file) {
  // createImageBitmap honours the EXIF orientation in current browsers
  return await createImageBitmap(file, { imageOrientation: "from-image" });
}

function scaled(bitmap, max) {
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = canvasOf(bitmap.width * s, bitmap.height * s);
  c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

// Keep only the biggest connected blob of the mask, fill small holes, sharpen the edge.
function cleanMask(alpha, w, h) {
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = alpha[i] > 110 ? 1 : 0;
  const label = new Int32Array(w * h).fill(0);
  let best = 0, bestSize = 0, cur = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!on[i] || label[i]) continue;
    cur++; let sp = 0, size = 0; stack[sp++] = i; label[i] = cur;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && on[p - 1] && !label[p - 1]) { label[p - 1] = cur; stack[sp++] = p - 1; }
      if (x < w - 1 && on[p + 1] && !label[p + 1]) { label[p + 1] = cur; stack[sp++] = p + 1; }
      if (y > 0 && on[p - w] && !label[p - w]) { label[p - w] = cur; stack[sp++] = p - w; }
      if (y < h - 1 && on[p + w] && !label[p + w]) { label[p + w] = cur; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
  }
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) keep[i] = label[i] === best ? 1 : 0;
  return { keep, size: bestSize };
}

function bbox(keep, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (keep[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function touchesEdge(keep, w, h) {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (let x = 0; x < w; x++) { top += keep[x]; bottom += keep[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { left += keep[y * w]; right += keep[y * w + w - 1]; }
  return Math.max(top / w, bottom / w, left / h, right / h) > 0.03;
}

async function roundCrop(source, box) {
  const W = source.width, H = source.height;
  let cx = W / 2, cy = H / 2, side = Math.min(W, H);
  if (box) {
    cx = (box.x0 + box.x1) / 2;
    cy = box.y0 + (box.y1 - box.y0) * 0.45;          // lean toward the top (faces)
    side = Math.min(Math.max(box.x1 - box.x0, box.y1 - box.y0) * 1.05, W, H);
  }
  const L = Math.min(Math.max(cx - side / 2, 0), W - side);
  const T = Math.min(Math.max(cy - side / 2, 0), H - side);
  const c = canvasOf(CIRCLE_SIZE, CIRCLE_SIZE);
  c.getContext("2d").drawImage(source, L, T, side, side, 0, 0, CIRCLE_SIZE, CIRCLE_SIZE);
  return { kind: "circle", blob: await toBlob(c, "image/jpeg", 0.86) };
}

/** Returns {kind:"body"|"circle", blob}. Throws only if the file can't be read as an image. */
export async function makeSticker(file) {
  const bitmap = await decode(file);
  const src = scaled(bitmap, INPUT_MAX);
  bitmap.close && bitmap.close();
  try {
    const l = await lib();
    const inBlob = await toBlob(src, "image/jpeg", 0.92);
    const cutBlob = await l.removeBackground(inBlob, config());
    const cutBmp = await createImageBitmap(cutBlob);
    const w = src.width, h = src.height;
    const mc = canvasOf(w, h), mg = mc.getContext("2d");
    mg.drawImage(cutBmp, 0, 0, w, h);
    const id = mg.getImageData(0, 0, w, h);
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = id.data[i * 4 + 3];
    const { keep, size } = cleanMask(alpha, w, h);
    const box = bbox(keep, w, h);
    if (!box || size < w * h * 0.01) return roundCrop(src, null);   // nothing clear to cut out
    if (touchesEdge(keep, w, h)) return roundCrop(src, box);         // subject runs off the photo

    // Build the cut-out: original pixels + cleaned, slightly softened alpha
    const out = mg.createImageData(w, h);
    const sd = src.getContext("2d").getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) {
      const a = keep[i] ? Math.max(alpha[i], 200) : 0;
      out.data[i * 4] = sd[i * 4]; out.data[i * 4 + 1] = sd[i * 4 + 1]; out.data[i * 4 + 2] = sd[i * 4 + 2];
      out.data[i * 4 + 3] = a;
    }
    mg.clearRect(0, 0, w, h); mg.putImageData(out, 0, 0);
    const pad = 2, bw = box.x1 - box.x0 + 1 + pad * 2, bh = box.y1 - box.y0 + 1 + pad * 2;
    const s = Math.min(1, BODY_MAX / Math.max(bw, bh));
    const oc = canvasOf(bw * s, bh * s);
    oc.getContext("2d").drawImage(mc, box.x0 - pad, box.y0 - pad, bw, bh, 0, 0, oc.width, oc.height);
    return { kind: "body", blob: await toBlob(oc, "image/png") };
  } catch (err) {
    console.warn("cut-out failed, using a round crop", err);
    return roundCrop(src, null);
  }
}
